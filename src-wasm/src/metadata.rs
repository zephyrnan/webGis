use std::collections::HashMap;
use std::io::{Cursor, Read};
use geojson::GeoJson;
use serde_json::Value;
use zip::ZipArchive;
use encoding_rs::Encoding;
use crate::types::*;

const MAX_FIELDS: usize = 50;
const MAX_SAMPLES: usize = 3;

pub fn extract(input: &[u8], file_name: &str, file_size: f64) -> Result<String, JsError> {
    let meta = match sniff_format(input, file_name) {
        InputFormat::Zip => extract_zip_metadata(input, file_name, file_size),
        InputFormat::Shapefile => extract_shp_metadata(input, file_name, file_size),
        InputFormat::GeoJson => extract_geojson_metadata(input, file_name, file_size),
        InputFormat::Unknown => Ok(build_lossy_binary_metadata(input, file_name, file_size, "unknown binary format")),
    }?;

    serde_json::to_string(&meta).map_err(|e| JsError::new(&e.to_string()))
}

#[derive(Debug, Clone, Copy)]
enum InputFormat {
    Zip,
    Shapefile,
    GeoJson,
    Unknown,
}

fn sniff_format(input: &[u8], file_name: &str) -> InputFormat {
    let lower = file_name.to_lowercase();

    if input.starts_with(&[0x50, 0x4B]) || lower.ends_with(".zip") {
        return InputFormat::Zip;
    }

    if lower.ends_with(".shp") || is_probably_shp(input) {
        return InputFormat::Shapefile;
    }

    let leading = input.iter().copied().find(|byte| !byte.is_ascii_whitespace());
    if matches!(leading, Some(b'{') | Some(b'[')) {
        return InputFormat::GeoJson;
    }

    let prefix_len = input.len().min(2048);
    let prefix = String::from_utf8_lossy(&input[..prefix_len]).to_lowercase();
    if prefix.contains("\"type\"") && (prefix.contains("featurecollection") || prefix.contains("feature")) {
        return InputFormat::GeoJson;
    }

    InputFormat::Unknown
}

fn is_probably_shp(input: &[u8]) -> bool {
    if input.len() < 100 {
        return false;
    }

    let file_code = i32::from_be_bytes([input[0], input[1], input[2], input[3]]);
    let version = i32::from_le_bytes([input[28], input[29], input[30], input[31]]);
    file_code == 9994 && version == 1000
}

fn extract_geojson_metadata(input: &[u8], file_name: &str, file_size: f64) -> Result<GeoSurgicalMetadata, JsError> {
    let text = String::from_utf8_lossy(input);

    let geojson: GeoJson = text.parse::<GeoJson>()
        .map_err(|e| JsError::new(&format!("GeoJSON 解析失败: {}", e)))?;

    let features = match &geojson {
        GeoJson::FeatureCollection(fc) => &fc.features,
        GeoJson::Feature(f) => return Ok(build_single_feature_metadata(f, file_name, file_size)),
        _ => return Err(JsError::new("不支持的 GeoJSON 类型")),
    };

    let feature_count = features.len();
    let mut field_samples: HashMap<String, Vec<Value>> = HashMap::new();
    let mut null_counts: HashMap<String, usize> = HashMap::new();

    for feature in features {
        if let Some(ref props) = feature.properties {
            for (key, value) in props {
                let lossy_key = key.to_string();
                let entry = field_samples.entry(lossy_key.clone()).or_default();
                if entry.len() < MAX_SAMPLES && is_sample_value(value) {
                    entry.push(value.clone());
                }
                if value.is_null() || *value == Value::String(String::new()) {
                    *null_counts.entry(lossy_key).or_insert(0) += 1;
                }
            }
        }
    }

    let total_field_count = field_samples.len();
    let mut fields: Vec<GeoField> = field_samples
        .into_iter()
        .map(|(name, sample)| {
            let null_count = null_counts.get(&name).copied().unwrap_or(0);
            let null_rate = if feature_count == 0 { 0.0 } else { null_count as f64 / feature_count as f64 };
            GeoField {
                field_type: infer_field_type(&sample),
                name,
                sample,
                null_rate_estimate: null_rate,
            }
        })
        .collect();

    fields.sort_by(|a, b| {
        field_priority(&b.name).cmp(&field_priority(&a.name))
            .then(a.null_rate_estimate.partial_cmp(&b.null_rate_estimate).unwrap_or(std::cmp::Ordering::Equal))
    });

    let truncated = fields.len() > MAX_FIELDS;
    fields.truncate(MAX_FIELDS);
    let bbox = calculate_bbox(features);

    let (crs, crs_confidence) = detect_crs(bbox);

    Ok(GeoSurgicalMetadata {
        file_type: "geojson".to_string(),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: Some(feature_count),
        fields,
        bbox,
        crs,
        crs_confidence,
        encoding: Some("UTF-8".to_string()),
        field_policy: FieldPolicy {
            total_field_count,
            included_field_count: if truncated { MAX_FIELDS } else { total_field_count },
            truncated,
        },
        warnings: vec![],
        layers: None,
    })
}

fn extract_zip_metadata(input: &[u8], file_name: &str, file_size: f64) -> Result<GeoSurgicalMetadata, JsError> {
    let cursor = Cursor::new(input);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| JsError::new(&format!("ZIP 解析失败: {}", e)))?;

    // Collect .shp/.dbf/.prj/.cpg by stem name
    let mut shp_bytes: HashMap<String, Vec<u8>> = HashMap::new();
    let mut dbf_bytes: HashMap<String, Vec<u8>> = HashMap::new();
    let mut prj_bytes: HashMap<String, Vec<u8>> = HashMap::new();
    let mut cpg_bytes: HashMap<String, Vec<u8>> = HashMap::new();
    let mut warnings = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_string();
        let lower = entry_name.to_lowercase();
        let stem = stem_name(&entry_name);

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

        if lower.ends_with(".shp") {
            shp_bytes.insert(stem, bytes);
        } else if lower.ends_with(".dbf") {
            dbf_bytes.insert(stem, bytes);
        } else if lower.ends_with(".prj") {
            prj_bytes.insert(stem, bytes);
        } else if lower.ends_with(".cpg") {
            cpg_bytes.insert(stem, bytes);
        }
    }

    // Build layer info for each .shp found
    let mut layers: Vec<LayerInfo> = Vec::new();
    let mut any_missing_prj = false;
    let mut any_missing_cpg = false;

    for (stem, shp) in &shp_bytes {
        let dbf = dbf_bytes.get(stem).map(|v| v.as_slice());
        let prj = prj_bytes.get(stem).map(|v| v.as_slice());
        let cpg = cpg_bytes.get(stem).map(|v| v.as_slice());

        if prj.is_none() { any_missing_prj = true; }
        if cpg.is_none() && dbf.is_some() { any_missing_cpg = true; }

        layers.push(extract_layer_info(shp, dbf, prj, cpg, stem));
    }

    if layers.is_empty() {
        warnings.push(GeoWarning {
            code: "SHP_NOT_FOUND".to_string(),
            message: "ZIP 中未找到 .shp 主文件，BBox 和要素数量未知。".to_string(),
            recoverable: true,
            suggested_user_input: None,
        });
    }

    if layers.iter().all(|l| l.fields.is_empty()) {
        warnings.push(GeoWarning {
            code: "DBF_NOT_FOUND".to_string(),
            message: "ZIP 中未找到 .dbf 属性表，字段摘要为空。".to_string(),
            recoverable: true,
            suggested_user_input: None,
        });
    }

    if any_missing_prj {
        warnings.push(GeoWarning {
            code: "MISSING_PRJ".to_string(),
            message: "ZIP 中未找到 .prj 投影文件，坐标系无法自动识别。".to_string(),
            recoverable: true,
            suggested_user_input: Some("请确认坐标系（如 EPSG:4326），或提供 .prj 文件。".to_string()),
        });
    }

    if any_missing_cpg {
        warnings.push(GeoWarning {
            code: "MISSING_CPG".to_string(),
            message: "ZIP 中未找到 .cpg 编码文件，已尝试从 DBF 头部 LDID 推断编码。如仍有乱码请手动指定。".to_string(),
            recoverable: true,
            suggested_user_input: Some("如果字段名乱码，请手动指定编码（如 GBK、windows-1256）。".to_string()),
        });
    }

    // Use first layer's data for top-level metadata (backward compatibility)
    let first_layer = layers.first();
    let first_feature_count = first_layer.and_then(|l| l.feature_count);
    let first_bbox = first_layer.and_then(|l| l.bbox);
    let first_crs = first_layer.and_then(|l| l.crs.clone());
    let first_crs_confidence = first_layer.and_then(|l| l.crs_confidence.clone());
    let first_encoding = first_layer.and_then(|l| l.encoding.clone());
    let fields = first_layer.map(|l| l.fields.clone()).unwrap_or_default();
    let total_field_count = fields.len();
    let truncated = total_field_count > MAX_FIELDS;
    let layer_list = if !layers.is_empty() { Some(layers) } else { None };

    Ok(GeoSurgicalMetadata {
        file_type: "shapefile_zip".to_string(),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: first_feature_count,
        fields,
        bbox: first_bbox,
        crs: first_crs,
        crs_confidence: first_crs_confidence,
        encoding: first_encoding.or_else(|| Some("lossy-utf8".to_string())),
        field_policy: FieldPolicy {
            total_field_count,
            included_field_count: total_field_count.min(MAX_FIELDS),
            truncated,
        },
        warnings,
        layers: layer_list,
    })
}

fn stem_name(entry_name: &str) -> String {
    let base = entry_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(entry_name);
    base.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(base).to_string()
}

fn extract_layer_info(
    shp_bytes: &[u8],
    dbf_bytes: Option<&[u8]>,
    prj_bytes: Option<&[u8]>,
    cpg_bytes: Option<&[u8]>,
    name: &str,
) -> LayerInfo {
    let shp_meta = parse_shp_header(shp_bytes);
    let (crs, crs_confidence) = prj_bytes
        .map(|prj| parse_crs_from_prj(prj))
        .unwrap_or((None, None));
    let encoding = resolve_encoding(cpg_bytes, dbf_bytes);
    let dbf_encoding = cpg_bytes.and_then(|cpg| resolve_encoding_for_label(cpg));

    let dbf_meta = dbf_bytes.map(|dbf| parse_dbf_with_encoding(dbf, dbf_encoding));

    let mut fields = dbf_meta.as_ref().map(|m| m.fields.clone()).unwrap_or_default();
    fields.truncate(MAX_FIELDS);

    LayerInfo {
        name: name.to_string(),
        feature_count: dbf_meta.as_ref().map(|m| m.record_count).or(shp_meta.feature_count),
        fields,
        bbox: shp_meta.bbox,
        crs,
        crs_confidence,
        encoding,
    }
}

fn extract_shp_metadata(input: &[u8], file_name: &str, file_size: f64) -> Result<GeoSurgicalMetadata, JsError> {
    let shp = parse_shp_header(input);

    Ok(GeoSurgicalMetadata {
        file_type: "shapefile".to_string(),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: shp.feature_count,
        fields: vec![],
        bbox: shp.bbox,
        crs: None,
        crs_confidence: None,
        encoding: None,
        field_policy: FieldPolicy {
            total_field_count: 0,
            included_field_count: 0,
            truncated: false,
        },
        warnings: vec![GeoWarning {
            code: "DBF_NOT_AVAILABLE".to_string(),
            message: "单独上传 .shp 无法读取 DBF 字段，请上传包含 .shp/.dbf 的 ZIP。".to_string(),
            recoverable: true,
            suggested_user_input: None,
        }],
        layers: None,
    })
}

struct DbfMetadata {
    fields: Vec<GeoField>,
    record_count: usize,
}

fn parse_dbf_with_encoding(input: &[u8], encoding: Option<&'static Encoding>) -> DbfMetadata {
    if input.len() < 32 {
        return DbfMetadata { fields: vec![], record_count: 0 };
    }

    let record_count = u32::from_le_bytes([input[4], input[5], input[6], input[7]]) as usize;
    let header_len = u16::from_le_bytes([input[8], input[9]]) as usize;
    let record_len = u16::from_le_bytes([input[10], input[11]]) as usize;
    let descriptor_end = header_len.saturating_sub(1).min(input.len());
    let mut descriptors = Vec::new();
    let mut offset = 32;

    while offset + 32 <= descriptor_end && input[offset] != 0x0D {
        let descriptor = &input[offset..offset + 32];
        let raw_name_end = descriptor[..11].iter().position(|byte| *byte == 0).unwrap_or(11);
        let name = decode_bytes(&descriptor[..raw_name_end], encoding);
        let field_type = match descriptor[11] as char {
            'N' | 'F' | 'B' | 'Y' | 'O' => "number",
            'L' => "boolean",
            'D' | 'T' => "date",
            'C' | 'M' => "string",
            _ => "unknown",
        }.to_string();
        let length = descriptor[16] as usize;

        if !name.is_empty() {
            descriptors.push((name, field_type, length));
        }

        offset += 32;
    }

    let mut fields = descriptors
        .iter()
        .map(|(name, field_type, _)| GeoField {
            name: name.clone(),
            field_type: field_type.clone(),
            sample: Vec::new(),
            null_rate_estimate: 0.0,
        })
        .collect::<Vec<_>>();

    let sample_count = record_count.min(MAX_SAMPLES);
    for row_index in 0..sample_count {
        let row_start = header_len + row_index * record_len;
        if row_start >= input.len() {
            break;
        }

        let mut field_offset = row_start + 1;
        for (field_index, (_, _, length)) in descriptors.iter().enumerate().take(fields.len()) {
            let field_end = (field_offset + *length).min(input.len());
            if field_offset < field_end {
                let sample = decode_bytes(&input[field_offset..field_end], encoding);
                if !sample.is_empty() && fields[field_index].sample.len() < MAX_SAMPLES {
                    fields[field_index].sample.push(Value::String(sample));
                }
            }
            field_offset += *length;
        }
    }

    fields.truncate(MAX_FIELDS);

    DbfMetadata { fields, record_count }
}

fn decode_bytes(bytes: &[u8], encoding: Option<&'static Encoding>) -> String {
    match encoding {
        Some(enc) => {
            let (decoded, _, _) = enc.decode(bytes);
            decoded.trim().to_string()
        }
        None => String::from_utf8_lossy(bytes).trim().to_string(),
    }
}

struct ShpHeaderMetadata {
    bbox: Option<[f64; 4]>,
    feature_count: Option<usize>,
}

fn parse_shp_header(input: &[u8]) -> ShpHeaderMetadata {
    if input.len() < 100 || !is_probably_shp(input) {
        return ShpHeaderMetadata { bbox: None, feature_count: None };
    }

    let bbox = Some([
        f64::from_le_bytes(input[36..44].try_into().unwrap()),
        f64::from_le_bytes(input[44..52].try_into().unwrap()),
        f64::from_le_bytes(input[52..60].try_into().unwrap()),
        f64::from_le_bytes(input[60..68].try_into().unwrap()),
    ]);

    let mut count = 0usize;
    let mut offset = 100usize;
    while offset + 8 <= input.len() {
        let content_words = i32::from_be_bytes([input[offset + 4], input[offset + 5], input[offset + 6], input[offset + 7]]);
        if content_words <= 0 {
            break;
        }
        let record_size = 8usize.saturating_add((content_words as usize).saturating_mul(2));
        if offset + record_size > input.len() {
            break;
        }
        count += 1;
        offset += record_size;
    }

    ShpHeaderMetadata { bbox, feature_count: Some(count) }
}

fn build_single_feature_metadata(feature: &geojson::Feature, file_name: &str, file_size: f64) -> GeoSurgicalMetadata {
    let mut fields = Vec::new();
    if let Some(ref props) = feature.properties {
        for (key, value) in props {
            let sample = if is_sample_value(value) { vec![value.clone()] } else { vec![] };
            fields.push(GeoField {
                name: key.clone(),
                field_type: infer_field_type(&sample),
                sample,
                null_rate_estimate: if value.is_null() { 1.0 } else { 0.0 },
            });
        }
    }

    let bbox = calculate_bbox_from_geometry(feature.geometry.as_ref());
    let (crs, crs_confidence) = detect_crs(bbox);

    GeoSurgicalMetadata {
        file_type: "geojson".to_string(),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: Some(1),
        field_policy: FieldPolicy {
            total_field_count: fields.len(),
            included_field_count: fields.len(),
            truncated: false,
        },
        crs,
        crs_confidence,
        encoding: Some("UTF-8".to_string()),
        bbox,
        fields,
        warnings: vec![],
        layers: None,
    }
}

fn build_lossy_binary_metadata(input: &[u8], file_name: &str, file_size: f64, parse_error: &str) -> GeoSurgicalMetadata {
    let fields = extract_lossy_field_names(input)
        .into_iter()
        .take(MAX_FIELDS)
        .map(|name| GeoField {
            name,
            field_type: "unknown".to_string(),
            sample: vec![],
            null_rate_estimate: 0.0,
        })
        .collect::<Vec<_>>();
    let total_field_count = fields.len();

    GeoSurgicalMetadata {
        file_type: infer_file_type(file_name),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: None,
        fields,
        bbox: None,
        crs: None,
        crs_confidence: None,
        encoding: Some("lossy-utf8".to_string()),
        field_policy: FieldPolicy {
            total_field_count,
            included_field_count: total_field_count,
            truncated: false,
        },
        warnings: vec![
            GeoWarning {
                code: "LOSSY_TEXT_DECODE".to_string(),
                message: "文件包含非 UTF-8 字节，已使用 UTF-8 lossy fallback 继续提取，乱码会以 � 显示。".to_string(),
                recoverable: true,
                suggested_user_input: None,
            },
            GeoWarning {
                code: "METADATA_PARSE_LOSSY".to_string(),
                message: format!("无法完整解析，已返回 lossy 元数据摘要: {}", parse_error),
                recoverable: true,
                suggested_user_input: None,
            },
        ],
        layers: None,
    }
}

fn infer_file_type(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".geojson") || lower.ends_with(".json") { "geojson".to_string() }
    else if lower.ends_with(".zip") { "shapefile_zip".to_string() }
    else if lower.ends_with(".shp") { "shapefile".to_string() }
    else { "unknown".to_string() }
}

fn extract_lossy_field_names(input: &[u8]) -> Vec<String> {
    input
        .split(|byte| *byte == 0 || *byte == b'\n' || *byte == b'\r' || *byte == b',' || *byte == b'\t')
        .filter_map(|chunk| {
            let value = String::from_utf8_lossy(chunk).trim().trim_matches('"').to_string();
            if value.len() >= 2 && value.len() <= 64 && value.chars().any(|ch| ch.is_alphabetic() || ch == '�') {
                Some(value)
            } else {
                None
            }
        })
        .take(MAX_FIELDS)
        .collect()
}

fn is_sample_value(value: &Value) -> bool {
    matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_) | Value::Null)
}

fn infer_field_type(samples: &[Value]) -> String {
    for sample in samples {
        match sample {
            Value::Number(_) => return "number".to_string(),
            Value::Bool(_) => return "boolean".to_string(),
            Value::String(s) => {
                if s.len() >= 10 && s.chars().nth(4) == Some('-') && s.chars().nth(7) == Some('-') {
                    return "date".to_string();
                }
                return "string".to_string();
            }
            _ => continue,
        }
    }
    "unknown".to_string()
}

fn field_priority(name: &str) -> u32 {
    let lower = name.to_lowercase();
    if lower.contains("geom") || lower.contains("shape") || lower.contains("coord") { 100 }
    else if lower == "id" || lower == "fid" || lower == "objectid" { 90 }
    else if lower == "name" || lower.contains("title") || lower.contains("label") { 80 }
    else if lower.contains("area") || lower.contains("length") || lower.contains("perimeter") { 70 }
    else { 50 }
}

fn calculate_bbox(features: &[geojson::Feature]) -> Option<[f64; 4]> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut found = false;

    for feature in features {
        if let Some(ref geom) = feature.geometry {
            visit_coords(geom, &mut |x, y| {
                found = true;
                if x < min_x { min_x = x; }
                if y < min_y { min_y = y; }
                if x > max_x { max_x = x; }
                if y > max_y { max_y = y; }
            });
        }
    }

    if found { Some([min_x, min_y, max_x, max_y]) } else { None }
}

fn calculate_bbox_from_geometry(geom: Option<&geojson::Geometry>) -> Option<[f64; 4]> {
    let geom = geom?;
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut found = false;

    visit_coords(geom, &mut |x, y| {
        found = true;
        if x < min_x { min_x = x; }
        if y < min_y { min_y = y; }
        if x > max_x { max_x = x; }
        if y > max_y { max_y = y; }
    });

    if found { Some([min_x, min_y, max_x, max_y]) } else { None }
}

fn visit_coords(geom: &geojson::Geometry, visitor: &mut dyn FnMut(f64, f64)) {
    match &geom.value {
        geojson::Value::Point(coords) => visitor(coords[0], coords[1]),
        geojson::Value::MultiPoint(coords) | geojson::Value::LineString(coords) => {
            for c in coords { visitor(c[0], c[1]); }
        }
        geojson::Value::MultiLineString(rings) | geojson::Value::Polygon(rings) => {
            for ring in rings { for c in ring { visitor(c[0], c[1]); } }
        }
        geojson::Value::MultiPolygon(polygons) => {
            for polygon in polygons { for ring in polygon { for c in ring { visitor(c[0], c[1]); } } }
        }
        geojson::Value::GeometryCollection(geometries) => {
            for g in geometries { visit_coords(g, visitor); }
        }
    }
}

fn detect_crs(bbox: Option<[f64; 4]>) -> (Option<String>, Option<String>) {
    let Some([min_x, min_y, max_x, max_y]) = bbox else {
        return (None, None);
    };
    if min_x >= -180.0 && max_x <= 180.0 && min_y >= -90.0 && max_y <= 90.0 {
        (Some("EPSG:4326".to_string()), Some("heuristic".to_string()))
    } else {
        (None, None)
    }
}

fn parse_crs_from_prj(prj_bytes: &[u8]) -> (Option<String>, Option<String>) {
    let wkt = String::from_utf8_lossy(prj_bytes);
    // AUTHORITY tag = authoritative
    if let Some(epsg) = extract_authority_epsg(&wkt) {
        return (Some(format!("EPSG:{}", epsg)), Some("authoritative".to_string()));
    }
    // WKT name pattern = heuristic
    if let Some(epsg) = extract_epsg_from_wkt_name(&wkt) {
        return (Some(epsg), Some("heuristic".to_string()));
    }
    (None, None)
}

fn extract_epsg_from_wkt_name(wkt: &str) -> Option<String> {
    let upper = wkt.to_uppercase();

    // GEOGCS name patterns
    let known_mappings: &[(&str, &str)] = &[
        ("GCS_WGS_1984", "EPSG:4326"),
        ("WGS_84", "EPSG:4326"),
        ("GCS_CHINA_GEODETIC_COORDINATE_SYSTEM_2000", "EPSG:4490"),
        ("CGCS_2000", "EPSG:4490"),
        ("GCS_BEIJING_1954", "EPSG:4214"),
        ("BEIJING_1954", "EPSG:4214"),
        ("GCS_XIAN_1980", "EPSG:4610"),
        ("XIAN_1980", "EPSG:4610"),
        ("GCS_WGS_1972", "EPSG:4322"),
        ("WGS_1972", "EPSG:4322"),
        ("GCS_NORTH_AMERICAN_1983", "EPSG:4269"),
        ("NAD_1983", "EPSG:4269"),
        ("GCS_ETRS_1989", "EPSG:4258"),
        ("ETRS_1989", "EPSG:4258"),
        ("GCS_JGD2000", "EPSG:4612"),
        ("JGD_2000", "EPSG:4612"),
        ("GCS_JGD2011", "EPSG:6668"),
        ("JGD_2011", "EPSG:6668"),
        ("GCS_PULKOVO_1942", "EPSG:4284"),
        ("PULKOVO_1942", "EPSG:4284"),
        ("GCS_PULKOVO_1995", "EPSG:4200"),
        ("PULKOVO_1995", "EPSG:4200"),
        ("GCS_KOREAN_1985", "EPSG:4162"),
        ("KOREA_1985", "EPSG:4162"),
        ("GCS_TOKYO", "EPSG:4301"),
        ("TOKYO", "EPSG:4301"),
        ("GCS_HONG_KONG_1980", "EPSG:4611"),
        ("HONG_KONG_1980", "EPSG:4611"),
    ];

    for (name, epsg) in known_mappings {
        if upper.contains(name) {
            return Some(epsg.to_string());
        }
    }

    // PROJCS patterns: UTM zone detection
    if let Some(epsg) = extract_utm_zone(&upper) {
        return Some(epsg);
    }

    // PROJCS patterns: Chinese Gauss-Kruger zone detection
    if let Some(epsg) = extract_chinese_gk_zone(&upper) {
        return Some(epsg);
    }

    // Web Mercator
    if upper.contains("WEB_MERCATOR") || upper.contains("WEB MERCATOR") {
        return Some("EPSG:3857".to_string());
    }

    None
}

/// Extract EPSG from UTM zone patterns in PROJCS name.
/// Matches "UTM_ZONE_51N", "UTM Zone 51", etc.
fn extract_utm_zone(upper_wkt: &str) -> Option<String> {
    let patterns = ["UTM_ZONE_", "UTM ZONE "];
    for pat in patterns {
        if let Some(pos) = upper_wkt.find(pat) {
            let after = &upper_wkt[pos + pat.len()..];
            let zone_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(zone) = zone_str.parse::<u32>() {
                if (1..=60).contains(&zone) {
                    let is_south = upper_wkt.contains("SOUTH") || upper_wkt.ends_with("_S");
                    let base: u32 = if is_south { 32700 } else { 32600 };
                    return Some(format!("EPSG:{}", base + zone));
                }
            }
        }
    }
    None
}

/// Extract EPSG from Chinese Gauss-Kruger zone patterns.
/// CGCS2000 3-degree GK zones: EPSG 4547-4553 (zones 25-31)
/// CGCS2000 6-degree GK zones: EPSG 4526-4533 (zones 13-20)
fn extract_chinese_gk_zone(upper_wkt: &str) -> Option<String> {
    // CGCS2000 3-degree GK zone
    if upper_wkt.contains("CGCS_2000") && upper_wkt.contains("3_DEGREE") {
        if let Some(zone) = extract_zone_number(upper_wkt) {
            if (25..=45).contains(&zone) {
                return Some(format!("EPSG:{}", 4524 + zone));
            }
        }
    }
    // CGCS2000 6-degree GK zone
    if upper_wkt.contains("CGCS_2000") && (upper_wkt.contains("GK_ZONE") || upper_wkt.contains("GK ZONE")) {
        if let Some(zone) = extract_zone_number(upper_wkt) {
            if (13..=23).contains(&zone) {
                return Some(format!("EPSG:{}", 4513 + zone));
            }
        }
    }
    // Beijing 1954 3-degree GK zone
    if upper_wkt.contains("BEIJING_1954") && upper_wkt.contains("3_DEGREE") {
        if let Some(zone) = extract_zone_number(upper_wkt) {
            if (25..=45).contains(&zone) {
                return Some(format!("EPSG:{}", 2421 + zone));
            }
        }
    }
    // Xian 1980 3-degree GK zone
    if upper_wkt.contains("XIAN_1980") && upper_wkt.contains("3_DEGREE") {
        if let Some(zone) = extract_zone_number(upper_wkt) {
            if (25..=45).contains(&zone) {
                return Some(format!("EPSG:{}", 2380 + zone));
            }
        }
    }
    None
}

/// Extract a zone number from a WKT name (last sequence of digits).
fn extract_zone_number(wkt: &str) -> Option<u32> {
    // Find the last sequence of digits in the string
    let mut last_num = String::new();
    let mut in_num = false;
    for c in wkt.chars() {
        if c.is_ascii_digit() {
            last_num.push(c);
            in_num = true;
        } else if in_num {
            break;
        }
    }
    last_num.parse().ok()
}

fn extract_authority_epsg(wkt: &str) -> Option<String> {
    // Find AUTHORITY["EPSG","XXXX"] or AUTHORITY["epsg","XXXX"]
    let upper = wkt.to_uppercase();
    let marker = "AUTHORITY[\"EPSG\"";
    let pos = upper.find(marker)?;
    let after = &wkt[pos + marker.len()..];
    // Skip whitespace and comma
    let after = after.trim_start().strip_prefix(',')?;
    let after = after.trim_start();
    // Expect "XXXX"
    let after = after.strip_prefix('"')?;
    let end = after.find('"')?;
    let code = &after[..end];
    // Validate it's a number
    if code.chars().all(|c| c.is_ascii_digit()) && !code.is_empty() {
        Some(code.to_string())
    } else {
        None
    }
}

fn resolve_encoding(cpg_bytes: Option<&[u8]>, dbf_bytes: Option<&[u8]>) -> Option<String> {
    // 1. .cpg file takes priority
    if let Some(cpg) = cpg_bytes {
        let label = String::from_utf8_lossy(cpg).trim().to_string();
        if !label.is_empty() {
            return Some(label);
        }
    }
    // 2. DBF header Language Driver ID (byte 29) fallback
    if let Some(dbf) = dbf_bytes {
        if let Some(enc) = infer_encoding_from_dbf_header(dbf) {
            return Some(enc.name().to_lowercase());
        }
    }
    // 3. Lossy fallback when DBF exists
    if dbf_bytes.is_some() {
        return Some("lossy-utf8".to_string());
    }
    None
}

fn resolve_encoding_for_label(cpg_bytes: &[u8]) -> Option<&'static Encoding> {
    let binding = String::from_utf8_lossy(cpg_bytes);
    let label = binding.trim();
    if label.is_empty() {
        return None;
    }
    Encoding::for_label(label.as_bytes())
}

/// Infer encoding from DBF header byte 29 (Language Driver ID / code page).
/// Reference: dBASE Level 7 LDID specification.
fn infer_encoding_from_dbf_header(dbf_bytes: &[u8]) -> Option<&'static Encoding> {
    if dbf_bytes.len() < 32 {
        return None;
    }
    let ldid = dbf_bytes[29];
    let label = match ldid {
        0x01 => "cp437",        // DOS US
        0x02 => "cp850",        // DOS Multilingual
        0x03 => "windows-1252", // Windows ANSI
        0x04 => "windows-1252", // Windows ANSI (alternate)
        0x20 => "gbk",          // GBK / CP936 (Chinese)
        0x57 => "windows-1252", // Windows ANSI (some DBF7)
        0x58 => "big5",         // Windows-950 (Traditional Chinese)
        0x59 => "euc-kr",       // Windows-949 (Korean)
        0x63 => "shift_jis",    // Shift_JIS (Japanese)
        0x64 => "euc-jp",       // EUC-JP (Japanese)
        0x6A => "utf-8",        // UTF-8
        0x7B => "macintosh",    // Macintosh CP10000
        0xC8 => "windows-1250", // Windows-1250 (Central European)
        0xC9 => "windows-1251", // Windows-1251 (Cyrillic)
        0xCA => "windows-1253", // Windows-1253 (Greek)
        0xCB => "windows-1254", // Windows-1254 (Turkish)
        0xCC => "windows-1255", // Windows-1255 (Hebrew)
        0xCD => "windows-1256", // Windows-1256 (Arabic)
        0xCE => "windows-1257", // Windows-1257 (Baltic)
        0xCF => "windows-1258", // Windows-1258 (Vietnamese)
        0xD3 => "gbk",          // GBK (Chinese, alternate)
        0xD4 => "big5",         // Big5 (Chinese, alternate)
        0xD5 => "euc-kr",       // EUC-KR (Korean, alternate)
        0xD6 => "shift_jis",    // Shift_JIS (Japanese, alternate)
        _ => return None,
    };
    Encoding::for_label(label.as_bytes())
}

use wasm_bindgen::JsError;
