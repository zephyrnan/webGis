use super::*;

pub(crate) fn parse_input_feature_collection(input: &[u8], file_name: &str, target_layer: Option<&str>) -> Result<geojson::FeatureCollection, JsError> {
    if is_zip_input(input, file_name) {
        return parse_zipped_feature_collection(input, target_layer);
    }

    parse_geojson_feature_collection(input)
}

pub(crate) fn parse_geojson_feature_collection(input: &[u8]) -> Result<geojson::FeatureCollection, JsError> {
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

pub(crate) fn parse_zipped_feature_collection(input: &[u8], target_layer: Option<&str>) -> Result<geojson::FeatureCollection, JsError> {
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

pub(crate) fn stem_name(entry_name: &str) -> String {
    let base = entry_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(entry_name);
    base.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(base).to_string()
}

pub(crate) fn parse_shapefile_feature_collection(shp_bytes: &[u8], dbf_bytes: Option<&[u8]>) -> Result<geojson::FeatureCollection, JsError> {
    let mut reader = shapefile::ShapeReader::new(Cursor::new(shp_bytes))
        .map_err(|e| JsError::new(&format!("SHP 解析失败: {}", e)))?;
    // Parse DBF once, then move (not clone) each record into its feature
    let mut properties: Vec<serde_json::Map<String, serde_json::Value>> = dbf_bytes.map(parse_dbf_records_lossy).unwrap_or_default();
    let mut features = Vec::with_capacity(properties.len());

    for (index, shape_result) in reader.iter_shapes().enumerate() {
        let shape = shape_result.map_err(|e| JsError::new(&format!("SHP 几何读取失败: {}", e)))?;
        let Some(geometry) = shape_to_geometry(shape) else { continue };
        // Move (not clone) the property map — avoids 794k deep copies
        let props = if index < properties.len() {
            std::mem::take(&mut properties[index])
        } else {
            serde_json::Map::new()
        };
        features.push(geojson::Feature {
            bbox: None,
            geometry: Some(geometry),
            id: None,
            properties: Some(props),
            foreign_members: None,
        });
    }

    Ok(geojson::FeatureCollection {
        bbox: None,
        features,
        foreign_members: None,
    })
}

pub(crate) fn parse_dbf_records_lossy(input: &[u8]) -> Vec<serde_json::Map<String, serde_json::Value>> {
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

pub(crate) fn parse_dbf_value_lossy(bytes: &[u8], field_type: char) -> serde_json::Value {
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

pub(crate) fn shape_to_geometry(shape: shapefile::Shape) -> Option<geojson::Geometry> {
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

pub(crate) fn is_zip_input(input: &[u8], file_name: &str) -> bool {
    input.starts_with(&[0x50, 0x4B]) || file_name.to_lowercase().ends_with(".zip")
}

pub(crate) fn count_shp_features(shp_bytes: &[u8]) -> Option<usize> {
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

pub(crate) fn count_dbf_records(dbf_bytes: &[u8]) -> Option<usize> {
    if dbf_bytes.len() < 12 { return None; }
    Some(u32::from_le_bytes([dbf_bytes[4], dbf_bytes[5], dbf_bytes[6], dbf_bytes[7]]) as usize)
}
