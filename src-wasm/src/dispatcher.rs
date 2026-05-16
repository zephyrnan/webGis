use std::io::{Cursor, Read};
use geojson::GeoJson;
use js_sys::Function;
use wasm_bindgen::JsError;
use zip::ZipArchive;
use crate::types::*;

pub fn execute(
    input: &[u8],
    ast: &GeoSurgicalAst,
    file_name: &str,
    file_size: f64,
    progress_callback: &Option<Function>,
) -> Result<Vec<u8>, JsError> {
    let mut fc = parse_input_feature_collection(input, file_name)?;

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
                } else {
                    warnings.push(format!("UNSUPPORTED_CRS_TRANSFORM: {} -> {}", from, to));
                    logs.push(format!("operation:transform_crs (跳过: {} -> {})", from, to));
                }
            }
            Operation::FixEncoding { from, to } => {
                logs.push(format!("operation:fix_encoding ({} → {})", from, to));
            }
            Operation::Export { format } => {
                logs.push(format!("operation:export ({})", format));
            }
            Operation::Noop { reason } => {
                logs.push(format!("operation:noop ({})", reason));
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

fn parse_input_feature_collection(input: &[u8], file_name: &str) -> Result<geojson::FeatureCollection, JsError> {
    if is_zip_input(input, file_name) {
        return parse_zipped_feature_collection(input);
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

fn parse_zipped_feature_collection(input: &[u8]) -> Result<geojson::FeatureCollection, JsError> {
    let cursor = Cursor::new(input);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| JsError::new(&format!("ZIP 解析失败: {}", e)))?;

    let mut shp_bytes: Option<Vec<u8>> = None;
    let mut dbf_bytes: Option<Vec<u8>> = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_lowercase();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

        if entry_name.ends_with(".geojson") || entry_name.ends_with(".json") {
            if let Ok(fc) = parse_geojson_feature_collection(&bytes) {
                return Ok(fc);
            }
        } else if entry_name.ends_with(".shp") {
            shp_bytes = Some(bytes);
        } else if entry_name.ends_with(".dbf") {
            dbf_bytes = Some(bytes);
        }
    }

    let shp_bytes = shp_bytes.ok_or_else(|| JsError::new("ZIP 中未找到 .shp 主文件，无法执行导出。"))?;
    parse_shapefile_feature_collection(&shp_bytes, dbf_bytes.as_deref())
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
        Operation::Export { .. } => "export",
        Operation::Noop { .. } => "noop",
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
