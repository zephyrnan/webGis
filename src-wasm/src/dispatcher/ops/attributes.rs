use super::super::*;

pub(crate) fn get_numeric_property(feature: &geojson::Feature, field: &str) -> f64 {
    feature.properties.as_ref()
        .and_then(|p| p.get(field))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
}

pub(crate) fn get_text_property(feature: &geojson::Feature, field: &str) -> Option<String> {
    feature.properties.as_ref()
        .and_then(|p| p.get(field))
        .and_then(|v| match v {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
        })
}

pub(crate) fn compare_numeric(left: f64, operator: &str, right: f64) -> bool {
    match operator {
        ">=" => left >= right,
        ">" => left > right,
        "<=" => left <= right,
        "<" => left < right,
        "=" => (left - right).abs() <= f64::EPSILON * left.abs().max(right.abs()).max(1.0),
        _ => false,
    }
}

pub(crate) fn fix_encoding_inplace(
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
            "operation:fix_encoding|from={}|encoding={}|cleaned={}|total={}|fallback=true",
            from, enc.name(), cleaned_count, total_strings
        )
    } else {
        format!(
            "operation:fix_encoding|from={}|encoding=unknown|cleaned={}|total={}|fallback=true",
            from, cleaned_count, total_strings
        )
    };

    (cleaned_count, log)
}

pub(crate) fn clean_encoded_string(s: &str, encoding: Option<&'static encoding_rs::Encoding>) -> String {
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

pub(crate) fn reencode_zip_dbf(
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
        "operation:fix_encoding|reencoded={}|encoding={}",
        count, enc.name()
    );

    Ok((fc, log))
}

pub(crate) fn parse_dbf_records_with_encoding(
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

pub(crate) fn parse_dbf_typed_value(value: &str, field_type: char) -> serde_json::Value {
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

pub(crate) fn resolve_operand(feature: &geojson::Feature, operand: &str) -> Option<f64> {
    // Try as field name first
    if let Some(val) = feature.properties.as_ref().and_then(|p| p.get(operand)) {
        if let Some(n) = val.as_f64() {
            return Some(n);
        }
    }
    // Try as numeric literal
    operand.parse::<f64>().ok()
}
