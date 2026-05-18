use std::io::{Cursor, Read};
use geojson::GeoJson;
use js_sys::Function;
use wasm_bindgen::JsError;
use zip::ZipArchive;
use geo::Simplify;
use crate::types::*;

pub fn execute(
    input: &[u8],
    ast: &GeoSurgicalAst,
    file_name: &str,
    file_size: f64,
    progress_callback: &Option<Function>,
) -> Result<Vec<u8>, JsError> {
    let mut fc = parse_input_feature_collection(input, file_name, ast.target_layer.as_deref())?;

    let input_count = fc.features.len();
    let total_ops = ast.operations.len();
    let mut logs = Vec::new();
    let mut warnings = Vec::new();

    for (i, op) in ast.operations.iter().enumerate() {
        let progress = 15 + ((i as f64 / total_ops as f64) * 70.0) as u32;
        let op_name = operation_name(op);
        emit_progress(progress_callback, "executing", &format!("正在执行: {}", op_name), progress);

        match op {
            Operation::FilterArea { field, operator, value } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    let prop_val = get_numeric_property(f, field);
                    compare_numeric(prop_val, operator, *value)
                });
                let removed = before - fc.features.len();
                logs.push(format!("operation:filter_area (移除了 {} 个要素)", removed));
            }
            Operation::DropEmpty { field } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    match f.properties.as_ref().and_then(|p| p.get(field)) {
                        Some(v) if !v.is_null() => {
                            if let Some(s) = v.as_str() { !s.is_empty() } else { true }
                        }
                        _ => false,
                    }
                });
                let removed = before - fc.features.len();
                logs.push(format!("operation:drop_empty (移除了 {} 个要素)", removed));
            }
            Operation::RenameField { from, to } => {
                for feature in &mut fc.features {
                    if let Some(ref mut props) = feature.properties {
                        if let Some(val) = props.remove(from) {
                            props.insert(to.clone(), val);
                        }
                    }
                }
                logs.push("operation:rename_field".to_string());
            }
            Operation::TransformCrs { from, to } => {
                if to == "GCJ-02" && from == "EPSG:4326" {
                    apply_gcj02_transform(&mut fc);
                    logs.push("operation:transform_crs (WGS-84 → GCJ-02)".to_string());
                } else if to == "EPSG:3857" && from == "EPSG:4326" {
                    apply_wgs84_to_mercator(&mut fc);
                    logs.push("operation:transform_crs (WGS-84 → Web Mercator)".to_string());
                } else if to == "EPSG:4326" && from == "GCJ-02" {
                    apply_gcj02_to_wgs84(&mut fc);
                    logs.push("operation:transform_crs (GCJ-02 → WGS-84)".to_string());
                } else {
                    warnings.push(format!("UNSUPPORTED_CRS_TRANSFORM: {} -> {}", from, to));
                    logs.push(format!("operation:transform_crs (跳过: {} -> {})", from, to));
                }
            }
            Operation::FixEncoding { from, to } => {
                let encoding = encoding_rs::Encoding::for_label(from.as_bytes());

                // If input is a ZIP, re-read raw DBF bytes for real byte-level transcoding
                if is_zip_input(input, file_name) {
                    match reencode_zip_dbf(input, ast.target_layer.as_deref(), encoding, to) {
                        Ok((reencoded_fc, transcode_log)) => {
                            fc = reencoded_fc;
                            logs.push(transcode_log);
                        }
                        Err(e) => {
                            warnings.push(format!("FIX_ENCODING_FAILED: {:?}", e));
                            // Fall back to in-place string cleanup
                            let (cleaned, log) = fix_encoding_inplace(&mut fc, encoding, from, to);
                            logs.push(log);
                            if cleaned > 0 {
                                warnings.push("FALLBACK_STRING_CLEANUP".to_string());
                            }
                        }
                    }
                } else {
                    // Non-ZIP: do in-place string cleanup
                    let (_cleaned, log) = fix_encoding_inplace(&mut fc, encoding, from, to);
                    logs.push(log);
                    if encoding.is_none() {
                        warnings.push(format!("ENCODING_NOT_RECOGNIZED: {}", from));
                    }
                }
            }
            Operation::Simplify { tolerance, preserve_topology: _ } => {
                let mut simplified_count = 0u32;
                let mut total_before = 0usize;
                let mut total_after = 0usize;

                for feature in &mut fc.features {
                    if let Some(ref mut geom) = feature.geometry {
                        let before = count_geojson_coords(geom);
                        total_before += before;
                        if let Some(simplified) = simplify_geojson_geometry(geom, *tolerance) {
                            let after = count_geojson_coords(&simplified);
                            total_after += after;
                            simplified_count += 1;
                            *geom = simplified;
                        } else {
                            total_after += before;
                        }
                    }
                }

                logs.push(format!(
                    "operation:simplify (tolerance={}, {} geometries, vertices {} → {})",
                    tolerance, simplified_count, total_before, total_after
                ));
            }
            Operation::FieldCalculate { target_field, operation, operands } => {
                let mut calculated = 0u32;
                let mut errors = 0u32;

                for feature in &mut fc.features {
                    let a = resolve_operand(feature, &operands[0]);
                    let b = resolve_operand(feature, &operands[1]);

                    match (a, b) {
                        (Some(va), Some(vb)) => {
                            let result = match operation.as_str() {
                                "add" => Some(va + vb),
                                "subtract" => Some(va - vb),
                                "multiply" => Some(va * vb),
                                "divide" => if vb.abs() > f64::EPSILON { Some(va / vb) } else { None },
                                _ => None,
                            };
                            if let Some(val) = result {
                                if let Some(ref mut props) = feature.properties {
                                    props.insert(target_field.clone(), serde_json::json!(val));
                                    calculated += 1;
                                }
                            } else {
                                errors += 1;
                            }
                        }
                        _ => errors += 1,
                    }
                }

                logs.push(format!(
                    "operation:field_calculate ({} = {} {} {}, calculated: {}, errors: {})",
                    target_field, operands[0], operation, operands[1], calculated, errors
                ));
                if errors > 0 {
                    warnings.push(format!("FIELD_CALCULATE_ERRORS: {} features had missing/invalid operands", errors));
                }
            }
            Operation::ValidateGeometry { mode } => {
                let mut invalid_count = 0u32;
                let mut fixed_count = 0u32;

                for feature in &mut fc.features {
                    if let Some(ref geom) = feature.geometry {
                        if !is_valid_geojson_geometry(geom) {
                            invalid_count += 1;
                            if mode == "check_and_fix" {
                                if let Some(fixed) = try_fix_geometry(geom) {
                                    feature.geometry = Some(fixed);
                                    fixed_count += 1;
                                }
                            }
                        }
                    }
                }

                logs.push(format!(
                    "operation:validate_geometry (mode={}, invalid: {}, fixed: {})",
                    mode, invalid_count, fixed_count
                ));
                if invalid_count > 0 && mode == "check" {
                    warnings.push(format!("INVALID_GEOMETRY: {} features have invalid geometry", invalid_count));
                }
            }
            Operation::Export { format } => {
                logs.push(format!("operation:export ({})", format));
            }
            Operation::Noop { reason } => {
                logs.push(format!("operation:noop ({})", reason));
            }
            Operation::NeedClarification { reason } => {
                logs.push(format!("operation:need_clarification ({})", reason));
                warnings.push(format!("NEED_CLARIFICATION: {}", reason));
            }
        }
    }

    warnings.push("WASM_REAL_MODE".to_string());

    let envelope = SurgeryEnvelope {
        result: SurgeryResult {
            kind: "geojson".to_string(),
            file_name: to_output_filename(file_name),
            content: Some(serde_json::to_value(&fc).unwrap_or_default()),
            summary: SurgerySummary {
                input_feature_count: Some(input_count),
                output_feature_count: Some(fc.features.len()),
                operations: ast.operations.iter().map(|o| operation_name(o).to_string()).collect(),
                mock_mode: false,
            },
            logs,
            warnings,
        },
        undo: UndoCapability {
            available: file_size <= 50.0 * 1024.0 * 1024.0,
            reason: if file_size > 50.0 * 1024.0 * 1024.0 { Some("file_too_large".to_string()) } else { None },
            strategy: if file_size <= 50.0 * 1024.0 * 1024.0 { "snapshot".to_string() } else { "replay_from_original".to_string() },
        },
    };

    let json = serde_json::to_string(&envelope)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(json.into_bytes())
}

fn parse_input_feature_collection(input: &[u8], file_name: &str, target_layer: Option<&str>) -> Result<geojson::FeatureCollection, JsError> {
    if is_zip_input(input, file_name) {
        return parse_zipped_feature_collection(input, target_layer);
    }

    parse_geojson_feature_collection(input)
}

fn parse_geojson_feature_collection(input: &[u8]) -> Result<geojson::FeatureCollection, JsError> {
    let text = String::from_utf8_lossy(input);
    let geojson: GeoJson = text.parse::<GeoJson>()
        .map_err(|e| JsError::new(&format!("GeoJSON 解析失败: {}", e)))?;

    match geojson {
        GeoJson::FeatureCollection(fc) => Ok(fc),
        GeoJson::Feature(f) => Ok(geojson::FeatureCollection {
            bbox: None,
            features: vec![f],
            foreign_members: None,
        }),
        _ => Err(JsError::new("不支持的 GeoJSON 类型")),
    }
}

fn parse_zipped_feature_collection(input: &[u8], target_layer: Option<&str>) -> Result<geojson::FeatureCollection, JsError> {
    let cursor = Cursor::new(input);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| JsError::new(&format!("ZIP 解析失败: {}", e)))?;

    // Collect all shp/dbf pairs by stem, plus any geojson files
    let mut layer_bytes: std::collections::HashMap<String, (Option<Vec<u8>>, Option<Vec<u8>>)> = std::collections::HashMap::new();
    let mut geojson_fc: Option<geojson::FeatureCollection> = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_string();
        let lower = entry_name.to_lowercase();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

        if lower.ends_with(".geojson") || lower.ends_with(".json") {
            if geojson_fc.is_none() {
                geojson_fc = parse_geojson_feature_collection(&bytes).ok();
            }
        } else if lower.ends_with(".shp") || lower.ends_with(".dbf") {
            let stem = stem_name(&entry_name);
            let entry = layer_bytes.entry(stem).or_insert((None, None));
            if lower.ends_with(".shp") {
                entry.0 = Some(bytes);
            } else {
                entry.1 = Some(bytes);
            }
        }
    }

    // If we found GeoJSON, prefer that
    if let Some(fc) = geojson_fc {
        return Ok(fc);
    }

    // Find the target layer or fall back to the one with most features
    let matched = if let Some(target) = target_layer {
        layer_bytes.iter().find(|(stem, (shp, _))| stem.eq_ignore_ascii_case(target) && shp.is_some())
    } else {
        // No explicit target — pick the layer with the most features (deterministic fallback)
        layer_bytes.iter()
            .filter(|(_, (shp, _))| shp.is_some())
            .max_by_key(|(_, (shp, dbf))| {
                let shp_count = shp.as_ref().and_then(|s| count_shp_features(s)).unwrap_or(0);
                let dbf_count = dbf.as_ref().and_then(|d| count_dbf_records(d)).unwrap_or(0);
                shp_count.max(dbf_count)
            })
    };

    let (_, (shp_bytes, dbf_bytes)) = matched
        .ok_or_else(|| JsError::new("ZIP 中未找到匹配的 .shp 文件，无法执行导出。"))?;

    parse_shapefile_feature_collection(shp_bytes.as_ref().unwrap(), dbf_bytes.as_deref())
}

fn stem_name(entry_name: &str) -> String {
    let base = entry_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(entry_name);
    base.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(base).to_string()
}

fn parse_shapefile_feature_collection(shp_bytes: &[u8], dbf_bytes: Option<&[u8]>) -> Result<geojson::FeatureCollection, JsError> {
    let mut reader = shapefile::ShapeReader::new(Cursor::new(shp_bytes))
        .map_err(|e| JsError::new(&format!("SHP 解析失败: {}", e)))?;
    let properties = dbf_bytes.map(parse_dbf_records_lossy).unwrap_or_default();
    let mut features = Vec::new();

    for (index, shape_result) in reader.iter_shapes().enumerate() {
        let shape = shape_result.map_err(|e| JsError::new(&format!("SHP 几何读取失败: {}", e)))?;
        let Some(geometry) = shape_to_geometry(shape) else { continue };
        features.push(geojson::Feature {
            bbox: None,
            geometry: Some(geometry),
            id: None,
            properties: properties.get(index).cloned(),
            foreign_members: None,
        });
    }

    Ok(geojson::FeatureCollection {
        bbox: None,
        features,
        foreign_members: None,
    })
}

fn parse_dbf_records_lossy(input: &[u8]) -> Vec<serde_json::Map<String, serde_json::Value>> {
    if input.len() < 32 {
        return Vec::new();
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
        let field_type = descriptor[11] as char;
        let length = descriptor[16] as usize;
        if !name.is_empty() {
            descriptors.push((name, field_type, length));
        }
        offset += 32;
    }

    let mut records = Vec::with_capacity(record_count);
    for row_index in 0..record_count {
        let row_start = header_len + row_index * record_len;
        if row_start >= input.len() {
            break;
        }

        let mut props = serde_json::Map::new();
        let mut field_offset = row_start + 1;
        for (name, field_type, length) in &descriptors {
            let field_end = (field_offset + *length).min(input.len());
            if field_offset < field_end {
                props.insert(name.clone(), parse_dbf_value_lossy(&input[field_offset..field_end], *field_type));
            }
            field_offset += *length;
        }
        records.push(props);
    }

    records
}

fn parse_dbf_value_lossy(bytes: &[u8], field_type: char) -> serde_json::Value {
    let value = String::from_utf8_lossy(bytes).trim().to_string();
    if value.is_empty() {
        return serde_json::Value::Null;
    }

    match field_type {
        'N' | 'F' | 'B' | 'Y' | 'O' => value
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value)),
        'L' => match value.to_lowercase().as_str() {
            "t" | "true" | "y" | "yes" | "1" => serde_json::Value::Bool(true),
            "f" | "false" | "n" | "no" | "0" => serde_json::Value::Bool(false),
            _ => serde_json::Value::String(value),
        },
        _ => serde_json::Value::String(value),
    }
}

trait ToCoord {
    fn coord(&self) -> Vec<f64>;
}

impl ToCoord for shapefile::Point {
    fn coord(&self) -> Vec<f64> { vec![self.x, self.y] }
}

impl ToCoord for shapefile::PointM {
    fn coord(&self) -> Vec<f64> { vec![self.x, self.y] }
}

impl ToCoord for shapefile::PointZ {
    fn coord(&self) -> Vec<f64> { vec![self.x, self.y] }
}

fn coords_from_points<P: ToCoord>(points: &[P]) -> Vec<Vec<f64>> {
    points.iter().map(|point| point.coord()).collect()
}

fn line_value_from_parts<P: ToCoord>(parts: &[Vec<P>]) -> geojson::Value {
    let lines = parts.iter().map(|part| coords_from_points(part)).collect::<Vec<_>>();
    if lines.len() == 1 {
        geojson::Value::LineString(lines.into_iter().next().unwrap_or_default())
    } else {
        geojson::Value::MultiLineString(lines)
    }
}

fn polygon_value_from_rings<P: ToCoord>(rings: &[shapefile::PolygonRing<P>]) -> geojson::Value {
    let mut polygons: Vec<Vec<Vec<Vec<f64>>>> = Vec::new();
    for ring in rings {
        match ring {
            shapefile::PolygonRing::Outer(points) => polygons.push(vec![coords_from_points(points)]),
            shapefile::PolygonRing::Inner(points) => {
                if let Some(last) = polygons.last_mut() {
                    last.push(coords_from_points(points));
                } else {
                    polygons.push(vec![coords_from_points(points)]);
                }
            }
        }
    }

    if polygons.len() == 1 {
        geojson::Value::Polygon(polygons.into_iter().next().unwrap_or_default())
    } else {
        geojson::Value::MultiPolygon(polygons)
    }
}

fn shape_to_geometry(shape: shapefile::Shape) -> Option<geojson::Geometry> {
    let value = match shape {
        shapefile::Shape::NullShape => return None,
        shapefile::Shape::Point(point) => geojson::Value::Point(point.coord()),
        shapefile::Shape::PointM(point) => geojson::Value::Point(point.coord()),
        shapefile::Shape::PointZ(point) => geojson::Value::Point(point.coord()),
        shapefile::Shape::Multipoint(points) => geojson::Value::MultiPoint(coords_from_points(points.points())),
        shapefile::Shape::MultipointM(points) => geojson::Value::MultiPoint(coords_from_points(points.points())),
        shapefile::Shape::MultipointZ(points) => geojson::Value::MultiPoint(coords_from_points(points.points())),
        shapefile::Shape::Polyline(line) => line_value_from_parts(line.parts()),
        shapefile::Shape::PolylineM(line) => line_value_from_parts(line.parts()),
        shapefile::Shape::PolylineZ(line) => line_value_from_parts(line.parts()),
        shapefile::Shape::Polygon(polygon) => polygon_value_from_rings(polygon.rings()),
        shapefile::Shape::PolygonM(polygon) => polygon_value_from_rings(polygon.rings()),
        shapefile::Shape::PolygonZ(polygon) => polygon_value_from_rings(polygon.rings()),
        shapefile::Shape::Multipatch(_) => return None,
    };

    Some(geojson::Geometry::new(value))
}

fn is_zip_input(input: &[u8], file_name: &str) -> bool {
    input.starts_with(&[0x50, 0x4B]) || file_name.to_lowercase().ends_with(".zip")
}

fn operation_name(op: &Operation) -> &str {
    match op {
        Operation::FilterArea { .. } => "filter_area",
        Operation::DropEmpty { .. } => "drop_empty",
        Operation::RenameField { .. } => "rename_field",
        Operation::TransformCrs { .. } => "transform_crs",
        Operation::FixEncoding { .. } => "fix_encoding",
        Operation::Simplify { .. } => "simplify",
        Operation::FieldCalculate { .. } => "field_calculate",
        Operation::ValidateGeometry { .. } => "validate_geometry",
        Operation::Export { .. } => "export",
        Operation::Noop { .. } => "noop",
        Operation::NeedClarification { .. } => "need_clarification",
    }
}

fn get_numeric_property(feature: &geojson::Feature, field: &str) -> f64 {
    feature.properties.as_ref()
        .and_then(|p| p.get(field))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
}

fn compare_numeric(left: f64, operator: &str, right: f64) -> bool {
    match operator {
        ">=" => left >= right,
        ">" => left > right,
        "<=" => left <= right,
        "<" => left < right,
        "=" => (left - right).abs() < f64::EPSILON,
        _ => false,
    }
}

fn apply_gcj02_transform(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_gcj02(geom);
        }
    }
}

fn transform_geometry_gcj02(geom: &mut geojson::Geometry) {
    use geojson::Value;
    match &mut geom.value {
        Value::Point(ref mut coords) => {
            let (lat, lng) = wgs84_to_gcj02(coords[1], coords[0]);
            coords[0] = lng;
            coords[1] = lat;
        }
        Value::MultiPoint(ref mut coords) | Value::LineString(ref mut coords) => {
            for c in coords.iter_mut() {
                let (lat, lng) = wgs84_to_gcj02(c[1], c[0]);
                c[0] = lng;
                c[1] = lat;
            }
        }
        Value::MultiLineString(ref mut rings) | Value::Polygon(ref mut rings) => {
            for ring in rings.iter_mut() {
                for c in ring.iter_mut() {
                    let (lat, lng) = wgs84_to_gcj02(c[1], c[0]);
                    c[0] = lng;
                    c[1] = lat;
                }
            }
        }
        Value::MultiPolygon(ref mut polygons) => {
            for polygon in polygons.iter_mut() {
                for ring in polygon.iter_mut() {
                    for c in ring.iter_mut() {
                        let (lat, lng) = wgs84_to_gcj02(c[1], c[0]);
                        c[0] = lng;
                        c[1] = lat;
                    }
                }
            }
        }
        Value::GeometryCollection(ref mut geometries) => {
            for g in geometries.iter_mut() {
                transform_geometry_gcj02(g);
            }
        }
    }
}

// WGS-84 to GCJ-02 offset algorithm (simplified non-linear transformation)
fn wgs84_to_gcj02(lat: f64, lng: f64) -> (f64, f64) {
    let a = 6378245.0;
    let ee = 0.00669342162296594323;

    let dlat = transform_lat(lng - 105.0, lat - 35.0);
    let dlng = transform_lng(lng - 105.0, lat - 35.0);

    let radlat = lat / 180.0 * std::f64::consts::PI;
    let mut magic = radlat.sin();
    magic = 1.0 - ee * magic * magic;
    let sqrtmagic = magic.sqrt();

    let dlat = (dlat * 180.0) / ((a * (1.0 - ee)) / (magic * sqrtmagic) * std::f64::consts::PI);
    let dlng = (dlng * 180.0) / (a / sqrtmagic * radlat.cos() * std::f64::consts::PI);

    (lat + dlat, lng + dlng)
}

fn transform_lat(x: f64, y: f64) -> f64 {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * x.abs().sqrt();
    let ret = ret + (20.0 * (6.0 * x * std::f64::consts::PI).sin() + 20.0 * (2.0 * x * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    let ret = ret + (20.0 * (y * std::f64::consts::PI).sin() + 40.0 * (y / 3.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    ret + (160.0 * (y / 12.0 * std::f64::consts::PI).sin() + 320.0 * (y * std::f64::consts::PI).sin()) * 2.0 / 3.0
}

fn transform_lng(x: f64, y: f64) -> f64 {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * x.abs().sqrt();
    let ret = ret + (20.0 * (6.0 * x * std::f64::consts::PI).sin() + 20.0 * (2.0 * x * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    let ret = ret + (20.0 * (x * std::f64::consts::PI).sin() + 40.0 * (x / 3.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    ret + (150.0 * (x / 12.0 * std::f64::consts::PI).sin() + 300.0 * (x / 30.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0
}

// --- WGS-84 (EPSG:4326) → Web Mercator (EPSG:3857) ---

fn wgs84_to_mercator(lat: f64, lng: f64) -> (f64, f64) {
    let x = lng * 20037508.34 / 180.0;
    let y = ((90.0 + lat) * std::f64::consts::PI / 360.0).tan().ln() / std::f64::consts::PI * 20037508.34;
    (x, y)
}

fn apply_wgs84_to_mercator(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_wgs84_to_mercator(geom);
        }
    }
}

fn transform_geometry_wgs84_to_mercator(geom: &mut geojson::Geometry) {
    use geojson::Value;
    match &mut geom.value {
        Value::Point(ref mut coords) => {
            let (x, y) = wgs84_to_mercator(coords[1], coords[0]);
            coords[0] = x;
            coords[1] = y;
        }
        Value::MultiPoint(ref mut coords) | Value::LineString(ref mut coords) => {
            for c in coords.iter_mut() {
                let (x, y) = wgs84_to_mercator(c[1], c[0]);
                c[0] = x;
                c[1] = y;
            }
        }
        Value::MultiLineString(ref mut rings) | Value::Polygon(ref mut rings) => {
            for ring in rings.iter_mut() {
                for c in ring.iter_mut() {
                    let (x, y) = wgs84_to_mercator(c[1], c[0]);
                    c[0] = x;
                    c[1] = y;
                }
            }
        }
        Value::MultiPolygon(ref mut polygons) => {
            for polygon in polygons.iter_mut() {
                for ring in polygon.iter_mut() {
                    for c in ring.iter_mut() {
                        let (x, y) = wgs84_to_mercator(c[1], c[0]);
                        c[0] = x;
                        c[1] = y;
                    }
                }
            }
        }
        Value::GeometryCollection(ref mut geometries) => {
            for g in geometries.iter_mut() {
                transform_geometry_wgs84_to_mercator(g);
            }
        }
    }
}

// --- GCJ-02 → WGS-84 (iterative inverse) ---

fn gcj02_to_wgs84(lat: f64, lng: f64) -> (f64, f64) {
    // Iterative approximation: converge within ~6 iterations for <1m accuracy
    let mut wlat = lat;
    let mut wlng = lng;
    for _ in 0..6 {
        let (clat, clng) = wgs84_to_gcj02(wlat, wlng);
        wlat += lat - clat;
        wlng += lng - clng;
    }
    (wlat, wlng)
}

fn apply_gcj02_to_wgs84(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_gcj02_to_wgs84(geom);
        }
    }
}

fn transform_geometry_gcj02_to_wgs84(geom: &mut geojson::Geometry) {
    use geojson::Value;
    match &mut geom.value {
        Value::Point(ref mut coords) => {
            let (lat, lng) = gcj02_to_wgs84(coords[1], coords[0]);
            coords[0] = lng;
            coords[1] = lat;
        }
        Value::MultiPoint(ref mut coords) | Value::LineString(ref mut coords) => {
            for c in coords.iter_mut() {
                let (lat, lng) = gcj02_to_wgs84(c[1], c[0]);
                c[0] = lng;
                c[1] = lat;
            }
        }
        Value::MultiLineString(ref mut rings) | Value::Polygon(ref mut rings) => {
            for ring in rings.iter_mut() {
                for c in ring.iter_mut() {
                    let (lat, lng) = gcj02_to_wgs84(c[1], c[0]);
                    c[0] = lng;
                    c[1] = lat;
                }
            }
        }
        Value::MultiPolygon(ref mut polygons) => {
            for polygon in polygons.iter_mut() {
                for ring in polygon.iter_mut() {
                    for c in ring.iter_mut() {
                        let (lat, lng) = gcj02_to_wgs84(c[1], c[0]);
                        c[0] = lng;
                        c[1] = lat;
                    }
                }
            }
        }
        Value::GeometryCollection(ref mut geometries) => {
            for g in geometries.iter_mut() {
                transform_geometry_gcj02_to_wgs84(g);
            }
        }
    }
}

fn emit_progress(callback: &Option<Function>, phase: &str, message: &str, percent: u32) {
    if let Some(ref cb) = callback {
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(&obj, &"phase".into(), &phase.into()).ok();
        js_sys::Reflect::set(&obj, &"message".into(), &message.into()).ok();
        js_sys::Reflect::set(&obj, &"percent".into(), &percent.into()).ok();
        let _ = cb.call1(&wasm_bindgen::JsValue::NULL, &obj);
    }
}

fn to_output_filename(file_name: &str) -> String {
    let base = file_name.rsplit_once('.').map(|(b, _)| b).unwrap_or(file_name);
    format!("{}.geosurgical.geojson", base)
}

fn fix_encoding_inplace(
    fc: &mut geojson::FeatureCollection,
    encoding: Option<&'static encoding_rs::Encoding>,
    from: &str,
    _to: &str,
) -> (u32, String) {
    let mut cleaned_count = 0u32;
    let mut total_strings = 0u32;

    for feature in &mut fc.features {
        if let Some(ref mut props) = feature.properties {
            for (_key, val) in props.iter_mut() {
                if let Some(s) = val.as_str() {
                    total_strings += 1;
                    let cleaned = clean_encoded_string(s, encoding);
                    if cleaned != s {
                        cleaned_count += 1;
                        *val = serde_json::Value::String(cleaned);
                    }
                }
            }
        }
    }

    let log = if let Some(enc) = encoding {
        format!(
            "operation:fix_encoding ({} → utf-8, encoding: {}, cleaned {}/{} strings, in-place fallback)",
            from, enc.name(), cleaned_count, total_strings
        )
    } else {
        format!(
            "operation:fix_encoding ({} → utf-8, encoding not recognized, cleaned {}/{} strings, in-place fallback)",
            from, cleaned_count, total_strings
        )
    };

    (cleaned_count, log)
}

fn clean_encoded_string(s: &str, encoding: Option<&'static encoding_rs::Encoding>) -> String {
    if s.is_ascii() {
        return s.to_string();
    }

    let cleaned: String = s.chars().filter(|&c| c != '\u{FFFD}').collect();
    let cleaned = cleaned.trim().to_string();

    if let Some(_enc) = encoding {
        // Source bytes are already lost from lossy UTF-8 conversion;
        // we can only remove replacement characters here.
    }

    cleaned
}

fn reencode_zip_dbf(
    input: &[u8],
    target_layer: Option<&str>,
    encoding: Option<&'static encoding_rs::Encoding>,
    _to: &str,
) -> Result<(geojson::FeatureCollection, String), JsError> {
    let enc = encoding.ok_or_else(|| JsError::new("ENCODING_NOT_RECOGNIZED"))?;

    let cursor = Cursor::new(input);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| JsError::new(&format!("ZIP 解析失败: {}", e)))?;

    // Collect shp/dbf pairs
    let mut layer_bytes: std::collections::HashMap<String, (Option<Vec<u8>>, Option<Vec<u8>>)> = std::collections::HashMap::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_string();
        let lower = entry_name.to_lowercase();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

        if lower.ends_with(".shp") || lower.ends_with(".dbf") {
            let stem = stem_name(&entry_name);
            let entry = layer_bytes.entry(stem).or_insert((None, None));
            if lower.ends_with(".shp") {
                entry.0 = Some(bytes);
            } else {
                entry.1 = Some(bytes);
            }
        }
    }

    // Find target layer
    let matched = if let Some(target) = target_layer {
        layer_bytes.iter().find(|(stem, (shp, _))| stem.eq_ignore_ascii_case(target) && shp.is_some())
    } else {
        layer_bytes.iter()
            .filter(|(_, (shp, _))| shp.is_some())
            .max_by_key(|(_, (shp, dbf))| {
                let shp_count = shp.as_ref().and_then(|s| count_shp_features(s)).unwrap_or(0);
                let dbf_count = dbf.as_ref().and_then(|d| count_dbf_records(d)).unwrap_or(0);
                shp_count.max(dbf_count)
            })
    };

    let (_, (shp_bytes, dbf_bytes)) = matched
        .ok_or_else(|| JsError::new("ZIP 中未找到匹配的 .shp 文件"))?;

    let shp = shp_bytes.as_ref().unwrap();
    let dbf = dbf_bytes.as_deref();

    // Re-parse DBF with the correct encoding
    let mut fc = parse_shapefile_feature_collection(shp, dbf)?;

    // Re-parse DBF records with the specified encoding and overwrite properties
    if let Some(dbf_bytes) = dbf {
        let reencoded_records = parse_dbf_records_with_encoding(dbf_bytes, enc);
        for (i, feature) in fc.features.iter_mut().enumerate() {
            if let Some(record) = reencoded_records.get(i) {
                feature.properties = Some(record.clone());
            }
        }
    }

    let count = fc.features.len();
    let log = format!(
        "operation:fix_encoding (re-encoded {} features with {})",
        count, enc.name()
    );

    Ok((fc, log))
}

fn parse_dbf_records_with_encoding(
    input: &[u8],
    encoding: &'static encoding_rs::Encoding,
) -> Vec<serde_json::Map<String, serde_json::Value>> {
    if input.len() < 32 {
        return Vec::new();
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
        // Decode field name with specified encoding
        let (name, _, _) = encoding.decode(&descriptor[..raw_name_end]);
        let name = name.trim().to_string();
        let field_type = descriptor[11] as char;
        let length = descriptor[16] as usize;
        if !name.is_empty() {
            descriptors.push((name, field_type, length));
        }
        offset += 32;
    }

    let mut records = Vec::with_capacity(record_count);
    for row_index in 0..record_count {
        let row_start = header_len + row_index * record_len;
        if row_start >= input.len() {
            break;
        }

        let mut props = serde_json::Map::new();
        let mut field_offset = row_start + 1;
        for (name, field_type, length) in &descriptors {
            let field_end = (field_offset + *length).min(input.len());
            if field_offset < field_end {
                let raw_bytes = &input[field_offset..field_end];
                // Decode value with specified encoding
                let (decoded, _, _) = encoding.decode(raw_bytes);
                let value = decoded.trim().to_string();
                props.insert(name.clone(), parse_dbf_typed_value(&value, *field_type));
            }
            field_offset += *length;
        }
        records.push(props);
    }

    records
}

fn parse_dbf_typed_value(value: &str, field_type: char) -> serde_json::Value {
    if value.is_empty() {
        return serde_json::Value::Null;
    }

    match field_type {
        'N' | 'F' | 'B' | 'Y' | 'O' => value
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value.to_string())),
        'L' => match value.to_lowercase().as_str() {
            "t" | "true" | "y" | "yes" | "1" => serde_json::Value::Bool(true),
            "f" | "false" | "n" | "no" | "0" => serde_json::Value::Bool(false),
            _ => serde_json::Value::String(value.to_string()),
        },
        _ => serde_json::Value::String(value.to_string()),
    }
}

fn count_shp_features(shp_bytes: &[u8]) -> Option<usize> {
    if shp_bytes.len() < 100 { return None; }
    let mut count = 0usize;
    let mut offset = 100usize;
    while offset + 8 <= shp_bytes.len() {
        let content_words = i32::from_be_bytes([shp_bytes[offset + 4], shp_bytes[offset + 5], shp_bytes[offset + 6], shp_bytes[offset + 7]]);
        if content_words <= 0 { break; }
        let record_size = 8usize.saturating_add((content_words as usize).saturating_mul(2));
        if offset + record_size > shp_bytes.len() { break; }
        count += 1;
        offset += record_size;
    }
    Some(count)
}

fn count_dbf_records(dbf_bytes: &[u8]) -> Option<usize> {
    if dbf_bytes.len() < 12 { return None; }
    Some(u32::from_le_bytes([dbf_bytes[4], dbf_bytes[5], dbf_bytes[6], dbf_bytes[7]]) as usize)
}

fn resolve_operand(feature: &geojson::Feature, operand: &str) -> Option<f64> {
    // Try as field name first
    if let Some(val) = feature.properties.as_ref().and_then(|p| p.get(operand)) {
        if let Some(n) = val.as_f64() {
            return Some(n);
        }
    }
    // Try as numeric literal
    operand.parse::<f64>().ok()
}

fn count_geojson_coords(geom: &geojson::Geometry) -> usize {
    match &geom.value {
        geojson::Value::Point(_) => 1,
        geojson::Value::MultiPoint(c) | geojson::Value::LineString(c) => c.len(),
        geojson::Value::MultiLineString(rings) | geojson::Value::Polygon(rings) => {
            rings.iter().map(|r| r.len()).sum()
        }
        geojson::Value::MultiPolygon(polys) => {
            polys.iter().flat_map(|rings| rings.iter()).map(|r| r.len()).sum()
        }
        geojson::Value::GeometryCollection(geoms) => {
            geoms.iter().map(count_geojson_coords).sum()
        }
    }
}

fn simplify_geojson_geometry(geom: &geojson::Geometry, tolerance: f64) -> Option<geojson::Geometry> {
    let simplified_value = match &geom.value {
        geojson::Value::LineString(coords) => {
            let ls = geo_linestring_from_coords(coords);
            let simplified = ls.simplify(&tolerance);
            Some(geojson::Value::LineString(geo_ls_to_coords(&simplified)))
        }
        geojson::Value::MultiLineString(lines) => {
            let result: Vec<Vec<Vec<f64>>> = lines.iter().map(|coords| {
                let ls = geo_linestring_from_coords(coords);
                let simplified = ls.simplify(&tolerance);
                geo_ls_to_coords(&simplified)
            }).collect();
            Some(geojson::Value::MultiLineString(result))
        }
        geojson::Value::Polygon(rings) => {
            let poly = geo_polygon_from_rings(rings)?;
            let simplified = poly.simplify(&tolerance);
            Some(geojson::Value::Polygon(geo_poly_to_rings(&simplified)))
        }
        geojson::Value::MultiPolygon(polys) => {
            let result: Vec<Vec<Vec<Vec<f64>>>> = polys.iter().filter_map(|rings| {
                let poly = geo_polygon_from_rings(rings)?;
                let simplified = poly.simplify(&tolerance);
                Some(geo_poly_to_rings(&simplified))
            }).collect();
            Some(geojson::Value::MultiPolygon(result))
        }
        _ => None, // Point, MultiPoint, GeometryCollection: skip simplification
    };

    simplified_value.map(|value| geojson::Geometry { value, bbox: geom.bbox.clone(), foreign_members: geom.foreign_members.clone() })
}

fn geo_linestring_from_coords(coords: &[Vec<f64>]) -> geo::LineString<f64> {
    geo::LineString(coords.iter().filter(|c| c.len() >= 2).map(|c| geo::Coord { x: c[0], y: c[1] }).collect())
}

fn geo_ls_to_coords(ls: &geo::LineString<f64>) -> Vec<Vec<f64>> {
    ls.0.iter().map(|c| vec![c.x, c.y]).collect()
}

fn geo_polygon_from_rings(rings: &[Vec<Vec<f64>>]) -> Option<geo::Polygon<f64>> {
    if rings.is_empty() { return None; }
    let exterior = geo_linestring_from_coords(&rings[0]);
    let interiors: Vec<geo::LineString<f64>> = rings[1..].iter().map(|r| geo_linestring_from_coords(r)).collect();
    Some(geo::Polygon::new(exterior, interiors))
}

fn geo_poly_to_rings(poly: &geo::Polygon<f64>) -> Vec<Vec<Vec<f64>>> {
    let mut result = vec![geo_ls_to_coords(poly.exterior())];
    for interior in poly.interiors() {
        result.push(geo_ls_to_coords(interior));
    }
    result
}

fn is_valid_geojson_geometry(geom: &geojson::Geometry) -> bool {
    match &geom.value {
        geojson::Value::Point(c) => is_valid_coord_slice(c),
        geojson::Value::MultiPoint(pts) | geojson::Value::LineString(pts) => {
            pts.iter().all(|c| is_valid_coord_slice(c))
        }
        geojson::Value::MultiLineString(rings) | geojson::Value::Polygon(rings) => {
            rings.iter().all(|ring| ring.iter().all(|c| is_valid_coord_slice(c)))
        }
        geojson::Value::MultiPolygon(polys) => {
            polys.iter().flat_map(|rings| rings.iter()).all(|ring| ring.iter().all(|c| is_valid_coord_slice(c)))
        }
        geojson::Value::GeometryCollection(geoms) => {
            geoms.iter().all(is_valid_geojson_geometry)
        }
    }
}

fn is_valid_coord_slice(c: &[f64]) -> bool {
    c.len() >= 2 && c[0].is_finite() && c[1].is_finite()
}

fn try_fix_geometry(geom: &geojson::Geometry) -> Option<geojson::Geometry> {
    let mut fixed = geom.clone();
    let mut changed = false;

    match &mut fixed.value {
        geojson::Value::Polygon(rings) => {
            for ring in rings.iter_mut() {
                // Remove NaN/Infinity coords
                let before_len = ring.len();
                ring.retain(|c| c.len() >= 2 && c[0].is_finite() && c[1].is_finite());
                if ring.len() != before_len { changed = true; }
                // Remove duplicate adjacent points
                ring.dedup_by(|a, b| a.len() >= 2 && b.len() >= 2 && a[0] == b[0] && a[1] == b[1]);
                // Close ring if not closed
                if ring.len() >= 2 {
                    let first = ring.first().cloned();
                    let last = ring.last().cloned();
                    if let (Some(f), Some(l)) = (first, last) {
                        if f.len() >= 2 && l.len() >= 2 && (f[0] != l[0] || f[1] != l[1]) {
                            ring.push(f);
                            changed = true;
                        }
                    }
                }
            }
            // Remove degenerate rings (less than 4 points)
            rings.retain(|ring| ring.len() >= 4);
        }
        geojson::Value::LineString(coords) => {
            let before = coords.len();
            coords.retain(|c| c.len() >= 2 && c[0].is_finite() && c[1].is_finite());
            if coords.len() != before { changed = true; }
        }
        geojson::Value::MultiLineString(lines) => {
            for line in lines.iter_mut() {
                let before = line.len();
                line.retain(|c| c.len() >= 2 && c[0].is_finite() && c[1].is_finite());
                if line.len() != before { changed = true; }
            }
        }
        geojson::Value::MultiPolygon(polygons) => {
            for rings in polygons.iter_mut() {
                for ring in rings.iter_mut() {
                    let before = ring.len();
                    ring.retain(|c| c.len() >= 2 && c[0].is_finite() && c[1].is_finite());
                    if ring.len() != before { changed = true; }
                    ring.dedup_by(|a, b| a.len() >= 2 && b.len() >= 2 && a[0] == b[0] && a[1] == b[1]);
                    if ring.len() >= 2 {
                        let first = ring.first().cloned();
                        let last = ring.last().cloned();
                        if let (Some(f), Some(l)) = (first, last) {
                            if f.len() >= 2 && l.len() >= 2 && (f[0] != l[0] || f[1] != l[1]) {
                                ring.push(f);
                                changed = true;
                            }
                        }
                    }
                }
                rings.retain(|ring| ring.len() >= 4);
            }
        }
        geojson::Value::Point(coords) => {
            if coords.len() >= 2 && (!coords[0].is_finite() || !coords[1].is_finite()) {
                return None;
            }
        }
        geojson::Value::MultiPoint(points) => {
            let before = points.len();
            points.retain(|c| c.len() >= 2 && c[0].is_finite() && c[1].is_finite());
            if points.len() != before { changed = true; }
        }
        _ => {}
    }

    if changed { Some(fixed) } else { None }
}
