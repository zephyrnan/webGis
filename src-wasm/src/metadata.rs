use std::collections::HashMap;
use std::io::{Cursor, Read};
use geojson::GeoJson;
use serde_json::Value;
use zip::ZipArchive;
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

    Ok(GeoSurgicalMetadata {
        file_type: "geojson".to_string(),
        file_name: file_name.to_string(),
        file_size,
        feature_count_estimate: Some(feature_count),
        fields,
        bbox,
        crs: detect_crs(bbox),
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

    // Collect all .shp/.dbf pairs by stem name
    let mut layer_bytes: HashMap<String, (Option<Vec<u8>>, Option<Vec<u8>>)> = HashMap::new();
    let mut warnings = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_string();
        let lower = entry_name.to_lowercase();

        if lower.ends_with(".shp") || lower.ends_with(".dbf") {
            let stem = stem_name(&entry_name);
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

            let entry = layer_bytes.entry(stem).or_insert((None, None));
            if lower.ends_with(".shp") {
                entry.0 = Some(bytes);
            } else {
                entry.1 = Some(bytes);
            }
        }
    }

    // Build layer info for each .shp found
    let mut layers: Vec<LayerInfo> = Vec::new();
    for (stem, (shp_bytes, dbf_bytes)) in &layer_bytes {
        if shp_bytes.is_none() { continue; }
        layers.push(extract_layer_info(shp_bytes.as_ref().unwrap(), dbf_bytes.as_deref(), stem));
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

    warnings.push(GeoWarning {
        code: "LOSSY_DBF_DECODE".to_string(),
        message: "DBF 字段名和样本使用 UTF-8 lossy fallback 解码，非 UTF-8 字节会显示为 。".to_string(),
        recoverable: true,
        suggested_user_input: None,
    });

    // Use first layer's data for top-level metadata (backward compatibility)
    let first_feature_count = layers.first().and_then(|l| l.feature_count);
    let first_bbox = layers.first().and_then(|l| l.bbox);
    let fields = layers.first().map(|l| l.fields.clone()).unwrap_or_default();
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
        crs: None,
        encoding: Some("lossy-utf8".to_string()),
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

fn extract_layer_info(shp_bytes: &[u8], dbf_bytes: Option<&[u8]>, name: &str) -> LayerInfo {
    let shp_meta = parse_shp_header(shp_bytes);
    let dbf_meta = dbf_bytes.map(parse_dbf_lossy);

    let mut fields = dbf_meta.as_ref().map(|m| m.fields.clone()).unwrap_or_default();
    fields.truncate(MAX_FIELDS);

    LayerInfo {
        name: name.to_string(),
        feature_count: dbf_meta.as_ref().map(|m| m.record_count).or(shp_meta.feature_count),
        fields,
        bbox: shp_meta.bbox,
        encoding: if dbf_bytes.is_some() { Some("lossy-utf8".to_string()) } else { None },
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
    total_field_count: usize,
    record_count: usize,
}

fn parse_dbf_lossy(input: &[u8]) -> DbfMetadata {
    if input.len() < 32 {
        return DbfMetadata { fields: vec![], total_field_count: 0, record_count: 0 };
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
        let name = String::from_utf8_lossy(&descriptor[..raw_name_end]).trim().to_string();
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
                let sample = String::from_utf8_lossy(&input[field_offset..field_end]).trim().to_string();
                if !sample.is_empty() && fields[field_index].sample.len() < MAX_SAMPLES {
                    fields[field_index].sample.push(Value::String(sample));
                }
            }
            field_offset += *length;
        }
    }

    let total_field_count = fields.len();
    fields.truncate(MAX_FIELDS);

    DbfMetadata { fields, total_field_count, record_count }
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
        crs: detect_crs(bbox),
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

fn detect_crs(bbox: Option<[f64; 4]>) -> Option<String> {
    let [min_x, min_y, max_x, max_y] = bbox?;
    if min_x >= -180.0 && max_x <= 180.0 && min_y >= -90.0 && max_y <= 90.0 {
        Some("EPSG:4326".to_string())
    } else {
        None
    }
}

use wasm_bindgen::JsError;
