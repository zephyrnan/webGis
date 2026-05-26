use std::io::{Cursor, Read, Write};
use geojson::GeoJson;
use js_sys::Function;
use wasm_bindgen::JsError;
use zip::ZipArchive;
use geo::Simplify;
use geo::SimplifyVwPreserve;
use crate::types::*;

pub fn execute(
    input: &[u8],
    ast: &GeoSurgicalAst,
    file_name: &str,
    file_size: f64,
    progress_callback: &Option<Function>,
) -> Result<Vec<u8>, JsError> {
    // Fast path: pure export from ZIP — stream shapefile directly to GeoJSON bytes
    // without materializing the entire FeatureCollection in memory.
    if is_zip_input(input, file_name)
        && ast.operations.len() == 1
        && matches!(&ast.operations[0], Operation::Export { .. })
    {
        return stream_export_zip(input, ast, file_name, file_size, progress_callback);
    }

    let mut fc = parse_input_feature_collection(input, file_name, ast.target_layer.as_deref())?;

    let input_count = fc.features.len();
    let total_ops = ast.operations.len();
    let mut logs = Vec::new();
    let mut warnings = Vec::new();
    let mut export_format = "geojson";

    for (i, op) in ast.operations.iter().enumerate() {
        let progress = 15 + ((i as f64 / total_ops as f64) * 70.0) as u32;
        let op_name = operation_name(op);
        emit_progress(progress_callback, "executing", &format!("operation:{}", op_name), progress);

        match op {
            Operation::FilterArea { field, operator, value } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    let prop_val = get_numeric_property(f, field);
                    compare_numeric(prop_val, operator, *value)
                });
                let removed = before - fc.features.len();
                logs.push(format!("operation:filter_area|removed={}", removed));
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
                logs.push(format!("operation:drop_empty|removed={}", removed));
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
                    logs.push("operation:transform_crs|from=WGS-84|to=GCJ-02".to_string());
                } else if to == "EPSG:3857" && from == "EPSG:4326" {
                    apply_wgs84_to_mercator(&mut fc);
                    logs.push("operation:transform_crs|from=WGS-84|to=Web Mercator".to_string());
                } else if to == "EPSG:4326" && from == "GCJ-02" {
                    apply_gcj02_to_wgs84(&mut fc);
                    logs.push("operation:transform_crs|from=GCJ-02|to=WGS-84".to_string());
                } else {
                    warnings.push(format!("UNSUPPORTED_CRS_TRANSFORM: {} -> {}", from, to));
                    logs.push(format!("operation:transform_crs|skipped=true|from={}|to={}", from, to));
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
            Operation::Simplify { tolerance, preserve_topology } => {
                let preserve = preserve_topology.unwrap_or(true);
                let mut simplified_count = 0u32;
                let mut total_before = 0usize;
                let mut total_after = 0usize;

                for feature in &mut fc.features {
                    if let Some(ref mut geom) = feature.geometry {
                        let before = count_geojson_coords(geom);
                        total_before += before;
                        if let Some(simplified) = simplify_geojson_geometry(geom, *tolerance, preserve) {
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
                    "operation:simplify|tolerance={}|geometries={}|verticesBefore={}|verticesAfter={}",
                    tolerance, simplified_count, total_before, total_after
                ));
            }
            Operation::FieldCalculate { target_field, operation, operands } => {
                if operands.len() < 2 {
                    warnings.push("FIELD_CALCULATE_REQUIRES_2_OPERANDS".to_string());
                    continue;
                }
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
                    "operation:field_calculate|target={}|op={}|calculated={}|errors={}",
                    target_field, operation, calculated, errors
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
                    "operation:validate_geometry|mode={}|invalid={}|fixed={}",
                    mode, invalid_count, fixed_count
                ));
                if invalid_count > 0 && mode == "check" {
                    warnings.push(format!("INVALID_GEOMETRY: {} features have invalid geometry", invalid_count));
                }
            }
            Operation::Buffer { distance, segments } => {
                let segs = segments.unwrap_or(16);
                let mut buffered_count = 0u32;
                for feature in &mut fc.features {
                    if let Some(ref geom) = feature.geometry {
                        if let Some(buffered) = buffer_geojson_geometry(geom, *distance, segs) {
                            feature.geometry = Some(buffered);
                            buffered_count += 1;
                        }
                    }
                }
                logs.push(format!(
                    "operation:buffer|distance={}|segments={}|geometries={}",
                    distance, segs, buffered_count
                ));
            }
            Operation::Clip { bbox } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    if let Some(ref geom) = f.geometry {
                        geojson_bbox_intersects(geom, bbox)
                    } else {
                        false
                    }
                });
                let removed = before - fc.features.len();
                logs.push(format!(
                    "operation:clip|bbox={},{},{},{}|removed={}",
                    bbox[0], bbox[1], bbox[2], bbox[3], removed
                ));
            }
            Operation::Intersect { bbox } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    if let Some(ref geom) = f.geometry {
                        geojson_bbox_intersects(geom, bbox)
                    } else {
                        false
                    }
                });
                let removed = before - fc.features.len();
                logs.push(format!(
                    "operation:intersect|bbox={},{},{},{}|kept={}|removed={}",
                    bbox[0], bbox[1], bbox[2], bbox[3], fc.features.len(), removed
                ));
            }
            Operation::Dissolve { field } => {
                let before = fc.features.len();
                fc.features = dissolve_by_field(&fc, field);
                let after = fc.features.len();
                logs.push(format!(
                    "operation:dissolve|field={}|before={}|after={}",
                    field, before, after
                ));
            }
            Operation::Export { format } => {
                export_format = format.as_str();
                logs.push(format!("operation:export|format={}", format));
            }
            Operation::Noop { reason } => {
                logs.push(format!("operation:noop|reason={}", reason));
            }
            Operation::NeedClarification { reason } => {
                logs.push(format!("operation:need_clarification|reason={}", reason));
                warnings.push(format!("NEED_CLARIFICATION: {}", reason));
            }
        }
    }

    warnings.push("WASM_REAL_MODE".to_string());

    // Only compute convex hull preview when dataset is large enough to block the main thread.
    // Small datasets skip hull — frontend renders full geometry directly via blobUrl.
    const PREVIEW_HULL_THRESHOLD: usize = 50_000;
    let output_count = fc.features.len();
    let preview_fc = if output_count > PREVIEW_HULL_THRESHOLD {
        Some(compute_preview_hull_from_fc(&fc))
    } else {
        None
    };

    // Build output data bytes based on export format
    let (out_file_name, out_kind) = if export_format == "shapefile" {
        (to_output_filename_with_ext(file_name, "zip"), "shapefile".to_string())
    } else {
        (to_output_filename_with_ext(file_name, "geojson"), "geojson".to_string())
    };

    let full_data_bytes: Vec<u8> = if export_format == "shapefile" {
        write_shapefile_zip(&fc)?
    } else {
        // Streaming GeoJSON serialization
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(b"{\"type\":\"FeatureCollection\",\"features\":[");
        let mut first = true;
        for feature in &fc.features {
            if !first { buf.push(b','); }
            first = false;
            serde_json::to_writer(&mut buf, feature)
                .map_err(|e| JsError::new(&format!("Feature serialization failed: {}", e)))?;
        }
        buf.extend_from_slice(b"]}");
        buf
    };
    drop(fc); // Free FeatureCollection memory before building final buffer

    // Build envelope (lightweight — no data payload)
    let envelope = SurgeryEnvelope {
        result: SurgeryResult {
            kind: out_kind,
            file_name: out_file_name,
            content: None,
            preview_content: preview_fc,
            summary: SurgerySummary {
                input_feature_count: Some(input_count),
                output_feature_count: Some(output_count),
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
    let env_bytes = serde_json::to_vec(&envelope)
        .map_err(|e| JsError::new(&format!("Envelope serialization failed: {}", e)))?;

    // Binary hybrid protocol: [4-byte header length (u32 LE)] + [Envelope bytes] + [Data bytes]
    let mut final_buffer = Vec::with_capacity(4 + env_bytes.len() + full_data_bytes.len());
    final_buffer.extend_from_slice(&(env_bytes.len() as u32).to_le_bytes());
    final_buffer.extend_from_slice(&env_bytes);
    final_buffer.extend_from_slice(&full_data_bytes);

    Ok(final_buffer)
}

/// Streaming export: process shapefile directly to GeoJSON bytes without
/// creating a FeatureCollection. For 794k polygon features, this avoids
/// allocating 794k Feature objects in memory simultaneously.
fn stream_export_zip(
    input: &[u8],
    ast: &GeoSurgicalAst,
    file_name: &str,
    file_size: f64,
    progress_callback: &Option<Function>,
) -> Result<Vec<u8>, JsError> {
    let cursor = Cursor::new(input);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| JsError::new(&format!("ZIP 解析失败: {}", e)))?;

    // Find target layer's shp/dbf bytes
    let target = ast.target_layer.as_deref();
    let mut shp_bytes: Option<Vec<u8>> = None;
    let mut dbf_bytes: Option<Vec<u8>> = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;
        let entry_name = file.name().to_string();
        let lower = entry_name.to_lowercase();
        let stem = stem_name(&entry_name);

        if let Some(t) = target {
            if !stem.eq_ignore_ascii_case(t) {
                continue;
            }
        }

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| JsError::new(&format!("ZIP 条目读取失败: {}", e)))?;

        if lower.ends_with(".shp") {
            shp_bytes = Some(bytes);
        } else if lower.ends_with(".dbf") {
            dbf_bytes = Some(bytes);
        }
    }

    let shp_data = shp_bytes.ok_or_else(|| JsError::new("ZIP 中未找到 .shp 文件"))?;
    let mut properties: Vec<serde_json::Map<String, serde_json::Value>> = dbf_bytes.map(|d| parse_dbf_records_lossy(&d)).unwrap_or_default();

    let total_estimate = properties.len().max(1);
    emit_progress(progress_callback, "executing", "streamExport.start", 10);

    // Stream-process: read each shape, serialize to JSON, write to buffer
    let mut reader = shapefile::ShapeReader::new(Cursor::new(&shp_data))
        .map_err(|e| JsError::new(&format!("SHP 解析失败: {}", e)))?;

    let mut geojson_buf: Vec<u8> = Vec::new();
    geojson_buf.extend_from_slice(b"{\"type\":\"FeatureCollection\",\"features\":[");

    let mut count: usize = 0;
    let mut first = true;
    let mut all_points: Vec<geo::Coord<f64>> = Vec::new();
    for (index, shape_result) in reader.iter_shapes().enumerate() {
        let shape = shape_result.map_err(|e| JsError::new(&format!("SHP 几何读取失败: {}", e)))?;
        let Some(geometry) = shape_to_geometry(shape) else { continue };

        // Collect exterior vertices for convex hull preview
        extract_coords_from_geometry(&geometry, &mut all_points);

        if !first {
            geojson_buf.push(b',');
        }
        first = false;

        let props = if index < properties.len() {
            std::mem::take(&mut properties[index])
        } else {
            serde_json::Map::new()
        };

        let feature = geojson::Feature {
            bbox: None,
            geometry: Some(geometry),
            id: None,
            properties: Some(props),
            foreign_members: None,
        };

        serde_json::to_writer(&mut geojson_buf, &feature)
            .map_err(|e| JsError::new(&format!("Feature serialization failed: {}", e)))?;

        count += 1;
        if count % 10000 == 0 {
            let percent = (10 + (count * 80 / total_estimate)).min(90) as u32;
            emit_progress(progress_callback, "executing", &format!("streamExport.progress|count={}", count), percent);
        }
    }

    geojson_buf.extend_from_slice(b"]}");

    emit_progress(progress_callback, "exporting", "streamExport.done", 100);

    // Only compute convex hull preview when dataset is large enough to block the main thread.
    const PREVIEW_HULL_THRESHOLD: usize = 50_000;
    let preview_fc = if count > PREVIEW_HULL_THRESHOLD {
        Some(compute_preview_hull_from_points(&all_points))
    } else {
        None
    };

    // Build envelope
    let envelope = SurgeryEnvelope {
        result: SurgeryResult {
            kind: "geojson".to_string(),
            file_name: to_output_filename_with_ext(file_name, "geojson"),
            content: None,
            preview_content: preview_fc,
            summary: SurgerySummary {
                input_feature_count: Some(count),
                output_feature_count: Some(count),
                operations: vec!["export".to_string()],
                mock_mode: false,
            },
            logs: vec![format!("operation:export|format=geojson")],
            warnings: vec!["WASM_REAL_MODE".to_string()],
        },
        undo: UndoCapability {
            available: file_size <= 50.0 * 1024.0 * 1024.0,
            reason: if file_size > 50.0 * 1024.0 * 1024.0 { Some("file_too_large".to_string()) } else { None },
            strategy: if file_size <= 50.0 * 1024.0 * 1024.0 { "snapshot".to_string() } else { "replay_from_original".to_string() },
        },
    };
    let env_bytes = serde_json::to_vec(&envelope)
        .map_err(|e| JsError::new(&format!("Envelope serialization failed: {}", e)))?;

    // Binary hybrid protocol
    let mut final_buffer = Vec::with_capacity(4 + env_bytes.len() + geojson_buf.len());
    final_buffer.extend_from_slice(&(env_bytes.len() as u32).to_le_bytes());
    final_buffer.extend_from_slice(&env_bytes);
    final_buffer.extend_from_slice(&geojson_buf);

    Ok(final_buffer)
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
        Operation::Buffer { .. } => "buffer",
        Operation::Clip { .. } => "clip",
        Operation::Intersect { .. } => "intersect",
        Operation::Dissolve { .. } => "dissolve",
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
        "=" => (left - right).abs() <= f64::EPSILON * left.abs().max(right.abs()).max(1.0),
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
    let lat = lat.clamp(-85.05112878, 85.05112878);
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

// --- Buffer ---

fn buffer_geojson_geometry(geom: &geojson::Geometry, distance: f64, segments: u32) -> Option<geojson::Geometry> {
    use geojson::Value;
    match &geom.value {
        Value::Point(coords) => {
            Some(make_buffer_circle(coords[1], coords[0], distance, segments))
        }
        Value::MultiPoint(coords_list) => {
            let mut polygons = Vec::new();
            for coords in coords_list {
                polygons.push(geo_polygon_from_circle(coords[1], coords[0], distance, segments));
            }
            let merged = merge_geo_polygons(polygons);
            geo_to_geojson_polygon(&merged)
        }
        Value::LineString(coords) => {
            buffer_linestring(coords, distance, segments)
        }
        Value::Polygon(rings) => {
            buffer_polygon_rings(rings, distance, segments)
        }
        _ => None,
    }
}

fn make_buffer_circle(lat: f64, lng: f64, distance: f64, segments: u32) -> geojson::Geometry {
    let polygon = geo_polygon_from_circle(lat, lng, distance, segments);
    let mp = geo::MultiPolygon(vec![polygon]);
    geo_to_geojson_polygon(&mp).unwrap_or_else(|| {
        geojson::Geometry::new(geojson::Value::Polygon(vec![vec![]]))
    })
}

fn geo_polygon_from_circle(lat: f64, lng: f64, distance: f64, segments: u32) -> geo::Polygon<f64> {
    use geo::{Coord, LineString, Polygon};
    let mut coords = Vec::new();
    let segs = segments.max(8) as f64;
    // Approximate: 1 degree latitude ≈ 111320 meters
    let dlat = distance / 111320.0;
    let dlng = distance / (111320.0 * (lat * std::f64::consts::PI / 180.0).cos());
    for i in 0..=(segments.max(8)) {
        let angle = 2.0 * std::f64::consts::PI * (i as f64) / segs;
        coords.push(Coord {
            x: lng + dlng * angle.cos(),
            y: lat + dlat * angle.sin(),
        });
    }
    Polygon::new(LineString::new(coords), vec![])
}

fn merge_geo_polygons(mut polygons: Vec<geo::Polygon<f64>>) -> geo::MultiPolygon<f64> {
    use geo::BooleanOps;
    if polygons.is_empty() {
        return geo::MultiPolygon(vec![]);
    }
    let first = polygons.remove(0);
    let mut result = geo::MultiPolygon(vec![first]);
    for p in polygons {
        result = result.union(&geo::MultiPolygon(vec![p]));
    }
    result
}

fn geo_to_geojson_polygon(mp: &geo::MultiPolygon<f64>) -> Option<geojson::Geometry> {
    if mp.0.len() == 1 {
        let polygon = &mp.0[0];
        let exterior: Vec<Vec<f64>> = polygon.exterior().coords().map(|c| vec![c.x, c.y]).collect();
        let mut rings = vec![exterior];
        for interior in polygon.interiors() {
            rings.push(interior.coords().map(|c| vec![c.x, c.y]).collect());
        }
        return Some(geojson::Geometry::new(geojson::Value::Polygon(rings)));
    }
    let mut polygons = Vec::new();
    for polygon in &mp.0 {
        let exterior: Vec<Vec<f64>> = polygon.exterior().coords().map(|c| vec![c.x, c.y]).collect();
        let mut rings = vec![exterior];
        for interior in polygon.interiors() {
            rings.push(interior.coords().map(|c| vec![c.x, c.y]).collect());
        }
        polygons.push(rings);
    }
    Some(geojson::Geometry::new(geojson::Value::MultiPolygon(polygons)))
}

fn buffer_linestring(coords: &[Vec<f64>], distance: f64, segments: u32) -> Option<geojson::Geometry> {
    if coords.len() < 2 { return None; }
    let mut circles = Vec::new();
    for c in coords {
        circles.push(geo_polygon_from_circle(c[1], c[0], distance, segments));
    }
    let merged = merge_geo_polygons(circles);
    geo_to_geojson_polygon(&merged)
}

fn buffer_polygon_rings(rings: &[Vec<Vec<f64>>], distance: f64, segments: u32) -> Option<geojson::Geometry> {
    let Some(outer) = rings.first() else { return None; };
    let mut circles = Vec::new();
    for c in outer {
        circles.push(geo_polygon_from_circle(c[1], c[0], distance, segments));
    }
    let merged = merge_geo_polygons(circles);
    geo_to_geojson_polygon(&merged)
}

// --- Clip / Intersect bbox check ---

fn geojson_bbox_intersects(geom: &geojson::Geometry, bbox: &[f64; 4]) -> bool {
    let Some(geom_bbox) = geojson_geometry_bbox(geom) else { return false; };
    // Check if bounding boxes overlap
    !(geom_bbox[2] < bbox[0] || geom_bbox[0] > bbox[2] || geom_bbox[3] < bbox[1] || geom_bbox[1] > bbox[3])
}

fn geojson_geometry_bbox(geom: &geojson::Geometry) -> Option<[f64; 4]> {
    use geojson::Value;
    let coords = match &geom.value {
        Value::Point(c) => vec![c.as_slice()],
        Value::MultiPoint(cs) | Value::LineString(cs) => cs.iter().map(|c| c.as_slice()).collect(),
        Value::MultiLineString(rings) | Value::Polygon(rings) => {
            rings.iter().flat_map(|r| r.iter().map(|c| c.as_slice())).collect()
        }
        Value::MultiPolygon(polys) => {
            polys.iter().flat_map(|p| p.iter().flat_map(|r| r.iter().map(|c| c.as_slice()))).collect()
        }
        Value::GeometryCollection(geoms) => {
            let mut min_x = f64::MAX;
            let mut min_y = f64::MAX;
            let mut max_x = f64::MIN;
            let mut max_y = f64::MIN;
            for g in geoms {
                if let Some(b) = geojson_geometry_bbox(g) {
                    min_x = min_x.min(b[0]);
                    min_y = min_y.min(b[1]);
                    max_x = max_x.max(b[2]);
                    max_y = max_y.max(b[3]);
                }
            }
            return if min_x <= max_x { Some([min_x, min_y, max_x, max_y]) } else { None };
        }
    };
    if coords.is_empty() { return None; }
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for c in coords {
        if c.len() >= 2 {
            min_x = min_x.min(c[0]);
            min_y = min_y.min(c[1]);
            max_x = max_x.max(c[0]);
            max_y = max_y.max(c[1]);
        }
    }
    Some([min_x, min_y, max_x, max_y])
}

// --- Dissolve ---

fn dissolve_by_field(fc: &geojson::FeatureCollection, field: &str) -> Vec<geojson::Feature> {
    use std::collections::BTreeMap;
    let mut groups: BTreeMap<String, Vec<&geojson::Feature>> = BTreeMap::new();
    let null_key = "__NULL__".to_string();

    for feature in &fc.features {
        let key = feature.properties.as_ref()
            .and_then(|p| p.get(field))
            .map(|v| {
                if v.is_null() { null_key.clone() }
                else if let Some(s) = v.as_str() { s.to_string() }
                else { v.to_string() }
            })
            .unwrap_or_else(|| { null_key.clone() });
        groups.entry(key).or_default().push(feature);
    }

    let mut result = Vec::new();
    for (key, features) in &groups {
        if features.len() == 1 {
            result.push((*features[0]).clone());
            continue;
        }

        // Merge geometries
        let mut merged_geo: Option<geo::MultiPolygon<f64>> = None;
        let mut merged_props = serde_json::Map::new();
        merged_props.insert(field.to_string(), serde_json::Value::String(key.clone()));

        for feature in features {
            if let Some(ref geom) = feature.geometry {
                if let Some(mp) = geojson_to_geo_polygon(geom) {
                    merged_geo = Some(match merged_geo {
                        None => mp,
                        Some(acc) => {
                            use geo::BooleanOps;
                            acc.union(&mp)
                        }
                    });
                }
            }
            // Merge non-null properties from first feature
            if merged_props.len() <= 1 {
                if let Some(ref props) = feature.properties {
                    for (k, v) in props {
                        if k != field && !merged_props.contains_key(k) {
                            merged_props.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }

        if let Some(poly) = merged_geo {
            if let Some(geom) = geo_to_geojson_polygon(&poly) {
                let f = geojson::Feature {
                    bbox: None,
                    geometry: Some(geom),
                    id: None,
                    properties: Some(merged_props),
                    foreign_members: Default::default(),
                };
                result.push(f);
            }
        }
    }

    result
}

fn geojson_to_geo_polygon(geom: &geojson::Geometry) -> Option<geo::MultiPolygon<f64>> {
    use geo::{Coord, LineString, Polygon};
    match &geom.value {
        geojson::Value::Polygon(rings) => {
            let exterior_coords: Vec<Coord> = rings.first()?
                .iter().map(|c| Coord { x: c[0], y: c[1] }).collect();
            let exterior = LineString::new(exterior_coords);
            let interiors: Vec<LineString> = rings[1..].iter().map(|ring| {
                LineString::new(ring.iter().map(|c| Coord { x: c[0], y: c[1] }).collect())
            }).collect();
            Some(geo::MultiPolygon(vec![Polygon::new(exterior, interiors)]))
        }
        geojson::Value::MultiPolygon(polys) => {
            let mut result = Vec::new();
            for rings in polys {
                let exterior_coords: Vec<Coord> = rings.first()?
                    .iter().map(|c| Coord { x: c[0], y: c[1] }).collect();
                let exterior = LineString::new(exterior_coords);
                let interiors: Vec<LineString> = rings[1..].iter().map(|ring| {
                    LineString::new(ring.iter().map(|c| Coord { x: c[0], y: c[1] }).collect())
                }).collect();
                result.push(Polygon::new(exterior, interiors));
            }
            Some(geo::MultiPolygon(result))
        }
        _ => None,
    }
}

// --- Convex Hull Preview ---

fn extract_coords_from_geometry(geom: &geojson::Geometry, out: &mut Vec<geo::Coord<f64>>) {
    use geojson::Value;
    match &geom.value {
        Value::Point(c) => {
            if c.len() >= 2 { out.push(geo::Coord { x: c[0], y: c[1] }); }
        }
        Value::MultiPoint(pts) | Value::LineString(pts) => {
            for c in pts {
                if c.len() >= 2 { out.push(geo::Coord { x: c[0], y: c[1] }); }
            }
        }
        Value::Polygon(rings) => {
            // Only exterior ring (first) — interior points are always inside hull
            if let Some(exterior) = rings.first() {
                for c in exterior {
                    if c.len() >= 2 { out.push(geo::Coord { x: c[0], y: c[1] }); }
                }
            }
        }
        Value::MultiPolygon(polys) => {
            for rings in polys {
                if let Some(exterior) = rings.first() {
                    for c in exterior {
                        if c.len() >= 2 { out.push(geo::Coord { x: c[0], y: c[1] }); }
                    }
                }
            }
        }
        Value::MultiLineString(lines) => {
            for line in lines {
                for c in line {
                    if c.len() >= 2 { out.push(geo::Coord { x: c[0], y: c[1] }); }
                }
            }
        }
        Value::GeometryCollection(geoms) => {
            for g in geoms {
                extract_coords_from_geometry(g, out);
            }
        }
    }
}

fn compute_preview_hull_from_fc(fc: &geojson::FeatureCollection) -> serde_json::Value {
    let mut points: Vec<geo::Coord<f64>> = Vec::new();
    for feature in &fc.features {
        if let Some(ref geom) = feature.geometry {
            extract_coords_from_geometry(geom, &mut points);
        }
    }
    compute_preview_hull_from_points(&points)
}

fn compute_preview_hull_from_points(points: &[geo::Coord<f64>]) -> serde_json::Value {
    use geo::algorithm::convex_hull::ConvexHull;
    let mp = geo::MultiPoint::from_iter(points.iter().cloned());
    let hull: geo::Polygon<f64> = mp.convex_hull();

    // Convert to GeoJSON FeatureCollection with single Feature
    let exterior: Vec<Vec<f64>> = hull.exterior().coords().map(|c| vec![c.x, c.y]).collect();
    let mut rings = vec![exterior];
    for interior in hull.interiors() {
        rings.push(interior.coords().map(|c| vec![c.x, c.y]).collect());
    }

    let hull_geom = geojson::Geometry::new(geojson::Value::Polygon(rings));
    let hull_feature = geojson::Feature {
        bbox: None,
        geometry: Some(hull_geom),
        id: None,
        properties: None,
        foreign_members: None,
    };
    let hull_fc = geojson::FeatureCollection {
        bbox: None,
        features: vec![hull_feature],
        foreign_members: None,
    };

    serde_json::to_value(&hull_fc).unwrap_or_default()
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

fn to_output_filename_with_ext(file_name: &str, ext: &str) -> String {
    let base = file_name.rsplit_once('.').map(|(b, _)| b).unwrap_or(file_name);
    format!("{}.geosurgical.{}", base, ext)
}

// --- Shapefile ZIP Export ---

fn write_shapefile_zip(fc: &geojson::FeatureCollection) -> Result<Vec<u8>, JsError> {
    use zip::write::{FileOptions, ZipWriter};

    // Collect geometries as Shapefile Shape objects
    let mut shapes: Vec<shapefile::Shape> = Vec::with_capacity(fc.features.len());
    for feature in &fc.features {
        let shape = match &feature.geometry {
            Some(geom) => geojson_geometry_to_shape(geom),
            None => shapefile::Shape::NullShape,
        };
        shapes.push(shape);
    }

    // Write .shp bytes
    let shp_buf: Vec<u8> = Vec::new();
    let mut shp_cursor = Cursor::new(shp_buf);
    write_shp(&mut shp_cursor, &shapes)?;
    let shp_bytes = shp_cursor.into_inner();

    // Write .shx bytes
    let shx_buf: Vec<u8> = Vec::new();
    let mut shx_cursor = Cursor::new(shx_buf);
    write_shx(&mut shx_cursor, &shapes)?;
    let shx_bytes = shx_cursor.into_inner();

    // Write .dbf bytes
    let dbf_bytes = build_dbf_bytes(&fc.features);

    // Write .prj bytes (WGS84)
    let prj_bytes = b"GEOGCS[\"GCS_WGS_1984\",DATUM[\"D_WGS_1984\",SPHEROID[\"WGS_1984\",6378137.0,298.257223563]],PRIMEM[\"Greenwich\",0.0],UNIT[\"Degree\",0.0174532925199433]]".to_vec();

    // Pack into ZIP
    let zip_buf: Vec<u8> = Vec::new();
    let mut zip = ZipWriter::new(Cursor::new(zip_buf));
    let options: FileOptions<'_, ()> = FileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("export.shp", options).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;
    zip.write_all(&shp_bytes).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;

    zip.start_file("export.shx", options).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;
    zip.write_all(&shx_bytes).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;

    zip.start_file("export.dbf", options).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;
    zip.write_all(&dbf_bytes).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;

    zip.start_file("export.prj", options).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;
    zip.write_all(&prj_bytes).map_err(|e| JsError::new(&format!("ZIP write failed: {}", e)))?;

    let zip_cursor = zip.finish().map_err(|e| JsError::new(&format!("ZIP finish failed: {}", e)))?;
    Ok(zip_cursor.into_inner())
}

fn write_shp<W: Write>(writer: &mut W, shapes: &[shapefile::Shape]) -> Result<(), JsError> {
    let file_length_words = compute_shp_file_length_words(shapes);
    let shape_type = shapes.first().map(shape_type_code).unwrap_or(0);
    let bbox = compute_shapes_bbox(shapes);
    write_shp_header(writer, file_length_words, shape_type, bbox)?;
    for (i, shape) in shapes.iter().enumerate() {
        let content_len = shape_content_length_words(shape) as u32;
        writer.write_all(&(i as i32 + 1).to_be_bytes())
            .map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
        writer.write_all(&content_len.to_be_bytes())
            .map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
        write_shape_record(writer, shape)?;
    }
    Ok(())
}

fn write_shx<W: Write>(writer: &mut W, shapes: &[shapefile::Shape]) -> Result<(), JsError> {
    let file_length_words = 50 + (shapes.len() as u32) * 4;
    let shape_type = shapes.first().map(shape_type_code).unwrap_or(0);
    let bbox = compute_shapes_bbox(shapes);
    write_shp_header(writer, file_length_words, shape_type, bbox)?;
    let mut offset_words: u32 = 50;
    for shape in shapes {
        let content_len = shape_content_length_words(shape) as u32;
        writer.write_all(&offset_words.to_be_bytes())
            .map_err(|e| JsError::new(&format!("SHX write failed: {}", e)))?;
        writer.write_all(&content_len.to_be_bytes())
            .map_err(|e| JsError::new(&format!("SHX write failed: {}", e)))?;
        offset_words += 4 + content_len;
    }
    Ok(())
}

fn write_shp_header<W: Write>(writer: &mut W, file_length_words: u32, shape_type: i32, bbox: [f64; 4]) -> Result<(), JsError> {
    writer.write_all(&9994_i32.to_be_bytes()).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    writer.write_all(&[0u8; 20]).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    writer.write_all(&file_length_words.to_be_bytes()).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    writer.write_all(&1000_i32.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    writer.write_all(&shape_type.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    // BBox (4 doubles = 32 bytes)
    for v in &bbox {
        writer.write_all(&v.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    }
    // Z range + M range (4 doubles = 32 bytes, all zeros)
    writer.write_all(&[0u8; 32]).map_err(|e| JsError::new(&format!("SHP header write failed: {}", e)))?;
    Ok(())
}

fn compute_shapes_bbox(shapes: &[shapefile::Shape]) -> [f64; 4] {
    let (mut min_x, mut min_y) = (f64::MAX, f64::MAX);
    let (mut max_x, mut max_y) = (f64::MIN, f64::MIN);
    for shape in shapes {
        let coords: Vec<(f64, f64)> = match shape {
            shapefile::Shape::Point(p) => vec![(p.x, p.y)],
            shapefile::Shape::PointM(p) => vec![(p.x, p.y)],
            shapefile::Shape::PointZ(p) => vec![(p.x, p.y)],
            shapefile::Shape::Multipoint(pts) => pts.points().iter().map(|p| (p.x, p.y)).collect(),
            shapefile::Shape::MultipointM(pts) => pts.points().iter().map(|p| (p.x, p.y)).collect(),
            shapefile::Shape::MultipointZ(pts) => pts.points().iter().map(|p| (p.x, p.y)).collect(),
            shapefile::Shape::Polyline(line) => line.parts().iter().flat_map(|p| p.iter().map(|pt| (pt.x, pt.y))).collect(),
            shapefile::Shape::PolylineM(line) => line.parts().iter().flat_map(|p| p.iter().map(|pt| (pt.x, pt.y))).collect(),
            shapefile::Shape::PolylineZ(line) => line.parts().iter().flat_map(|p| p.iter().map(|pt| (pt.x, pt.y))).collect(),
            shapefile::Shape::Polygon(poly) => poly.rings().iter().flat_map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.iter().map(|pt| (pt.x, pt.y)).collect::<Vec<_>>(),
            }).collect(),
            shapefile::Shape::PolygonM(poly) => poly.rings().iter().flat_map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.iter().map(|pt| (pt.x, pt.y)).collect::<Vec<_>>(),
            }).collect(),
            shapefile::Shape::PolygonZ(poly) => poly.rings().iter().flat_map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.iter().map(|pt| (pt.x, pt.y)).collect::<Vec<_>>(),
            }).collect(),
            _ => vec![],
        };
        for (x, y) in coords {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if min_x == f64::MAX { [0.0, 0.0, 0.0, 0.0] } else { [min_x, min_y, max_x, max_y] }
}

fn shape_type_code(shape: &shapefile::Shape) -> i32 {
    match shape {
        shapefile::Shape::NullShape => 0,
        shapefile::Shape::Point(_) => 1,
        shapefile::Shape::Polyline(_) => 3,
        shapefile::Shape::Polygon(_) => 5,
        shapefile::Shape::Multipoint(_) => 8,
        shapefile::Shape::PointZ(_) => 11,
        shapefile::Shape::PolylineZ(_) => 13,
        shapefile::Shape::PolygonZ(_) => 15,
        shapefile::Shape::PointM(_) => 21,
        shapefile::Shape::PolylineM(_) => 23,
        shapefile::Shape::PolygonM(_) => 25,
        shapefile::Shape::MultipointM(_) => 28,
        shapefile::Shape::MultipointZ(_) => 31,
        shapefile::Shape::Multipatch(_) => 31,
    }
}

fn shape_content_length_words(shape: &shapefile::Shape) -> usize {
    match shape {
        shapefile::Shape::NullShape => 2,
        shapefile::Shape::Point(_) => 10, // type(4) + x(8) + y(8) = 20B = 10w
        shapefile::Shape::PointM(_) => 14, // type(4) + x(8) + y(8) + m(8) = 28B = 14w
        shapefile::Shape::PointZ(_) => 18, // type(4) + x(8) + y(8) + z(8) + m(8) = 36B = 18w
        shapefile::Shape::Multipoint(pts) => {
            let n = pts.points().len();
            20 + n * 8 // type(4)+bbox(32)+numpoints(4)+points(n*16) = 40+n*16 B = 20+n*8 w
        }
        shapefile::Shape::MultipointM(_) | shapefile::Shape::MultipointZ(_) => 2, // fallback
        shapefile::Shape::Polyline(line) => {
            let num_parts = line.parts().len();
            let num_points: usize = line.parts().iter().map(|p| p.len()).sum();
            22 + num_parts * 2 + num_points * 8
        }
        shapefile::Shape::PolylineM(_) | shapefile::Shape::PolylineZ(_) => 2, // fallback
        shapefile::Shape::Polygon(poly) => {
            let num_parts = poly.rings().len();
            let num_points: usize = poly.rings().iter().map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.len(),
            }).sum();
            22 + num_parts * 2 + num_points * 8
        }
        shapefile::Shape::PolygonM(_) => 2, // fallback: write_shape_record emits NullShape
        shapefile::Shape::PolygonZ(poly) => {
            let num_parts = poly.rings().len();
            let num_points: usize = poly.rings().iter().map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.len(),
            }).sum();
            30 + num_parts * 2 + num_points * 12
        }
        shapefile::Shape::Multipatch(_) => 2,
    }
}

fn compute_shp_file_length_words(shapes: &[shapefile::Shape]) -> u32 {
    let mut total: u32 = 50; // header
    for shape in shapes {
        total += 4; // record header
        total += shape_content_length_words(shape) as u32;
    }
    total
}

macro_rules! w {
    ($w:expr, $data:expr) => {
        $w.write_all($data).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?
    };
}

fn write_shape_record<W: Write>(writer: &mut W, shape: &shapefile::Shape) -> Result<(), JsError> {
    match shape {
        shapefile::Shape::NullShape => {
            w!(writer, &0_i32.to_le_bytes());
        }
        shapefile::Shape::Point(pt) => {
            w!(writer, &1_i32.to_le_bytes());
            w!(writer, &pt.x.to_le_bytes());
            w!(writer, &pt.y.to_le_bytes());
        }
        shapefile::Shape::PointM(pt) => {
            w!(writer, &21_i32.to_le_bytes());
            w!(writer, &pt.x.to_le_bytes());
            w!(writer, &pt.y.to_le_bytes());
            w!(writer, &pt.m.to_le_bytes());
        }
        shapefile::Shape::PointZ(pt) => {
            w!(writer, &11_i32.to_le_bytes());
            w!(writer, &pt.x.to_le_bytes());
            w!(writer, &pt.y.to_le_bytes());
            w!(writer, &pt.z.to_le_bytes());
            w!(writer, &f64::NAN.to_le_bytes()); // M value required by ESRI spec
        }
        shapefile::Shape::Multipoint(pts) => {
            let points = pts.points();
            w!(writer, &8_i32.to_le_bytes());
            write_point_bbox(writer, points.iter().map(|p| (p.x, p.y)))?;
            w!(writer, &(points.len() as i32).to_le_bytes());
            for p in points {
                w!(writer, &p.x.to_le_bytes());
                w!(writer, &p.y.to_le_bytes());
            }
        }
        shapefile::Shape::Polyline(line) => {
            let parts = line.parts();
            let num_points: usize = parts.iter().map(|p| p.len()).sum();
            w!(writer, &3_i32.to_le_bytes());
            write_parts_header(writer, parts, num_points)?;
            for part in parts {
                for pt in part {
                    w!(writer, &pt.x.to_le_bytes());
                    w!(writer, &pt.y.to_le_bytes());
                }
            }
        }
        shapefile::Shape::Polygon(poly) => {
            let rings = poly.rings();
            let num_points: usize = rings.iter().map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.len(),
            }).sum();
            w!(writer, &5_i32.to_le_bytes());
            write_polygon_header(writer, rings, num_points)?;
            for ring in rings {
                let points = match ring {
                    shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
                };
                for pt in points {
                    w!(writer, &pt.x.to_le_bytes());
                    w!(writer, &pt.y.to_le_bytes());
                }
            }
        }
        shapefile::Shape::PolygonZ(poly) => {
            let rings = poly.rings();
            let num_points: usize = rings.iter().map(|r| match r {
                shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p.len(),
            }).sum();
            w!(writer, &15_i32.to_le_bytes());
            write_polygon_header_z(writer, rings, num_points)?;
            for ring in rings {
                let points = match ring {
                    shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
                };
                for pt in points {
                    w!(writer, &pt.x.to_le_bytes());
                    w!(writer, &pt.y.to_le_bytes());
                }
            }
            // Z range + Z values
            let (z_min, z_max) = compute_z_range_poly_z(poly);
            w!(writer, &z_min.to_le_bytes());
            w!(writer, &z_max.to_le_bytes());
            for ring in rings {
                let points = match ring {
                    shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
                };
                for pt in points {
                    w!(writer, &pt.z.to_le_bytes());
                }
            }
        }
        _ => {
            w!(writer, &0_i32.to_le_bytes()); // fallback: NullShape
        }
    }
    Ok(())
}

fn write_point_bbox<W: Write>(writer: &mut W, points: impl Iterator<Item = (f64, f64)>) -> Result<(), JsError> {
    let (mut min_x, mut min_y) = (f64::MAX, f64::MAX);
    let (mut max_x, mut max_y) = (f64::MIN, f64::MIN);
    for (x, y) in points {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    if min_x == f64::MAX { min_x = 0.0; min_y = 0.0; max_x = 0.0; max_y = 0.0; }
    writer.write_all(&min_x.to_le_bytes())?;
    writer.write_all(&min_y.to_le_bytes())?;
    writer.write_all(&max_x.to_le_bytes())?;
    writer.write_all(&max_y.to_le_bytes())?;
    Ok(())
}

fn write_parts_header<W: Write>(writer: &mut W, parts: &[Vec<shapefile::Point>], num_points: usize) -> Result<(), JsError> {
    // Compute bbox
    let (mut min_x, mut min_y) = (f64::MAX, f64::MAX);
    let (mut max_x, mut max_y) = (f64::MIN, f64::MIN);
    for part in parts {
        for pt in part {
            min_x = min_x.min(pt.x);
            min_y = min_y.min(pt.y);
            max_x = max_x.max(pt.x);
            max_y = max_y.max(pt.y);
        }
    }
    if min_x == f64::MAX { min_x = 0.0; min_y = 0.0; max_x = 0.0; max_y = 0.0; }
    w!(writer, &min_x.to_le_bytes());
    w!(writer, &min_y.to_le_bytes());
    w!(writer, &max_x.to_le_bytes());
    w!(writer, &max_y.to_le_bytes());
    w!(writer, &(parts.len() as i32).to_le_bytes());
    w!(writer, &(num_points as i32).to_le_bytes());
    let mut offset: i32 = 0;
    for part in parts {
        w!(writer, &offset.to_le_bytes());
        offset += part.len() as i32;
    }
    Ok(())
}

fn write_polygon_header<W: Write>(writer: &mut W, rings: &[shapefile::PolygonRing<shapefile::Point>], num_points: usize) -> Result<(), JsError> {
    let (mut min_x, mut min_y) = (f64::MAX, f64::MAX);
    let (mut max_x, mut max_y) = (f64::MIN, f64::MIN);
    for ring in rings {
        let points = match ring {
            shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
        };
        for pt in points {
            min_x = min_x.min(pt.x);
            min_y = min_y.min(pt.y);
            max_x = max_x.max(pt.x);
            max_y = max_y.max(pt.y);
        }
    }
    if min_x == f64::MAX { min_x = 0.0; min_y = 0.0; max_x = 0.0; max_y = 0.0; }
    writer.write_all(&min_x.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&min_y.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&max_x.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&max_y.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&(rings.len() as i32).to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&(num_points as i32).to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    let mut offset: i32 = 0;
    for ring in rings {
        writer.write_all(&offset.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
        let points = match ring {
            shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
        };
        offset += points.len() as i32;
    }
    Ok(())
}

fn write_polygon_header_z<W: Write>(writer: &mut W, rings: &[shapefile::PolygonRing<shapefile::PointZ>], num_points: usize) -> Result<(), JsError> {
    let (mut min_x, mut min_y) = (f64::MAX, f64::MAX);
    let (mut max_x, mut max_y) = (f64::MIN, f64::MIN);
    for ring in rings {
        let points = match ring {
            shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
        };
        for pt in points {
            min_x = min_x.min(pt.x);
            min_y = min_y.min(pt.y);
            max_x = max_x.max(pt.x);
            max_y = max_y.max(pt.y);
        }
    }
    if min_x == f64::MAX { min_x = 0.0; min_y = 0.0; max_x = 0.0; max_y = 0.0; }
    writer.write_all(&min_x.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&min_y.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&max_x.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&max_y.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&(rings.len() as i32).to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    writer.write_all(&(num_points as i32).to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
    let mut offset: i32 = 0;
    for ring in rings {
        writer.write_all(&offset.to_le_bytes()).map_err(|e| JsError::new(&format!("SHP write failed: {}", e)))?;
        let points = match ring {
            shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
        };
        offset += points.len() as i32;
    }
    Ok(())
}

fn compute_z_range_poly_z(poly: &shapefile::PolygonZ) -> (f64, f64) {
    let mut z_min = f64::MAX;
    let mut z_max = f64::MIN;
    for ring in poly.rings() {
        let points = match ring {
            shapefile::PolygonRing::Outer(p) | shapefile::PolygonRing::Inner(p) => p,
        };
        for pt in points {
            z_min = z_min.min(pt.z);
            z_max = z_max.max(pt.z);
        }
    }
    if z_min == f64::MAX { (0.0, 0.0) } else { (z_min, z_max) }
}

fn geojson_geometry_to_shape(geom: &geojson::Geometry) -> shapefile::Shape {
    use geojson::Value;
    match &geom.value {
        Value::Point(c) => {
            shapefile::Shape::Point(shapefile::Point { x: c[0], y: c[1] })
        }
        Value::MultiPoint(pts) => {
            let points: Vec<shapefile::Point> = pts.iter()
                .filter(|c| c.len() >= 2)
                .map(|c| shapefile::Point { x: c[0], y: c[1] })
                .collect();
            shapefile::Shape::Multipoint(shapefile::Multipoint::new(points))
        }
        Value::LineString(coords) => {
            let points = coords_to_shp_points(coords);
            shapefile::Shape::Polyline(shapefile::Polyline::with_parts(vec![points]))
        }
        Value::MultiLineString(lines) => {
            let parts: Vec<Vec<shapefile::Point>> = lines.iter()
                .map(|c| coords_to_shp_points(c))
                .collect();
            shapefile::Shape::Polyline(shapefile::Polyline::with_parts(parts))
        }
        Value::Polygon(rings) => {
            let shp_rings = geojson_rings_to_shp(rings);
            shapefile::Shape::Polygon(shapefile::Polygon::with_rings(shp_rings))
        }
        Value::MultiPolygon(polys) => {
            let mut all_rings = Vec::new();
            for rings in polys {
                all_rings.extend(geojson_rings_to_shp(rings));
            }
            shapefile::Shape::Polygon(shapefile::Polygon::with_rings(all_rings))
        }
        Value::GeometryCollection(geoms) => {
            // Shapefile doesn't support GeometryCollection; take first geometry
            geoms.first().map(|g| geojson_geometry_to_shape(g)).unwrap_or(shapefile::Shape::NullShape)
        }
    }
}

fn coords_to_shp_points(coords: &[Vec<f64>]) -> Vec<shapefile::Point> {
    coords.iter()
        .filter(|c| c.len() >= 2)
        .map(|c| shapefile::Point { x: c[0], y: c[1] })
        .collect()
}

fn geojson_rings_to_shp(rings: &[Vec<Vec<f64>>]) -> Vec<shapefile::PolygonRing<shapefile::Point>> {
    rings.iter().enumerate().map(|(i, ring)| {
        let points = coords_to_shp_points(ring);
        if i == 0 {
            shapefile::PolygonRing::Outer(points)
        } else {
            shapefile::PolygonRing::Inner(points)
        }
    }).collect()
}

// --- DBF Writer ---

fn build_dbf_bytes(features: &[geojson::Feature]) -> Vec<u8> {
    // Collect all unique field names from all features
    let mut field_names: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut used_truncated = std::collections::HashSet::new();
    for feature in features {
        if let Some(ref props) = feature.properties {
            for key in props.keys() {
                if seen.insert(key.clone()) {
                    let truncated = truncate_to_bytes(key, 10);
                    // Deduplicate truncated names: append _1, _2, etc.
                    let unique = if used_truncated.contains(&truncated) {
                        let mut suffix = 1u32;
                        loop {
                            let candidate = format!("{}_{}", &truncated[..truncated.len().min(7)], suffix);
                            if !used_truncated.contains(&candidate) {
                                break candidate;
                            }
                            suffix += 1;
                        }
                    } else {
                        truncated.clone()
                    };
                    used_truncated.insert(unique.clone());
                    field_names.push(unique);
                }
            }
        }
    }

    let num_records = features.len() as u32;
    let num_fields = field_names.len().min(255);
    let field_length: u16 = 254; // max safe length for Character fields
    let header_size: u16 = 33 + (num_fields as u16) * 32;
    let record_size: u16 = 1 + (num_fields as u16) * field_length;

    let mut dbf = Vec::with_capacity(
        header_size as usize + (num_records as usize) * record_size as usize
    );

    // --- Header ---
    dbf.push(0x03); // version
    // Date (YY, MM, DD)
    dbf.push(26); dbf.push(5); dbf.push(19);
    dbf.extend_from_slice(&num_records.to_le_bytes());
    dbf.extend_from_slice(&header_size.to_le_bytes());
    dbf.extend_from_slice(&record_size.to_le_bytes());
    dbf.extend_from_slice(&[0u8; 20]); // reserved

    // --- Field descriptors ---
    for name in &field_names[..num_fields] {
        let mut name_bytes = [0u8; 11];
        let raw = name.as_bytes();
        let len = raw.len().min(11);
        name_bytes[..len].copy_from_slice(&raw[..len]);
        dbf.extend_from_slice(&name_bytes);
        dbf.push(b'C'); // Character type
        dbf.extend_from_slice(&[0u8; 4]); // reserved
        dbf.extend_from_slice(&field_length.to_le_bytes());
        dbf.extend_from_slice(&[0u8; 14]); // reserved
    }
    dbf.push(0x0D); // header terminator

    // --- Records ---
    for feature in features {
        dbf.push(b' '); // deletion flag
        let props = feature.properties.as_ref();
        for name in &field_names[..num_fields] {
            let value = props.and_then(|p| p.get(name));
            let text = match value {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Number(n)) => n.to_string(),
                Some(serde_json::Value::Bool(b)) => b.to_string(),
                Some(serde_json::Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            };
            let mut field_bytes = vec![b' '; field_length as usize];
            let raw = text.as_bytes();
            let len = raw.len().min(field_length as usize);
            field_bytes[..len].copy_from_slice(&raw[..len]);
            dbf.extend_from_slice(&field_bytes);
        }
    }

    dbf
}

fn truncate_to_bytes(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
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
        "operation:fix_encoding|reencoded={}|encoding={}",
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

fn simplify_geojson_geometry(geom: &geojson::Geometry, tolerance: f64, preserve_topology: bool) -> Option<geojson::Geometry> {
    let simplified_value = match &geom.value {
        geojson::Value::LineString(coords) => {
            let ls = geo_linestring_from_coords(coords);
            let simplified = if preserve_topology { ls.simplify_vw_preserve(&tolerance) } else { ls.simplify(&tolerance) };
            Some(geojson::Value::LineString(geo_ls_to_coords(&simplified)))
        }
        geojson::Value::MultiLineString(lines) => {
            let result: Vec<Vec<Vec<f64>>> = lines.iter().map(|coords| {
                let ls = geo_linestring_from_coords(coords);
                let simplified = if preserve_topology { ls.simplify_vw_preserve(&tolerance) } else { ls.simplify(&tolerance) };
                geo_ls_to_coords(&simplified)
            }).collect();
            Some(geojson::Value::MultiLineString(result))
        }
        geojson::Value::Polygon(rings) => {
            let poly = geo_polygon_from_rings(rings)?;
            let simplified = if preserve_topology { poly.simplify_vw_preserve(&tolerance) } else { poly.simplify(&tolerance) };
            Some(geojson::Value::Polygon(geo_poly_to_rings(&simplified)))
        }
        geojson::Value::MultiPolygon(polys) => {
            let result: Vec<Vec<Vec<Vec<f64>>>> = polys.iter().filter_map(|rings| {
                let poly = geo_polygon_from_rings(rings)?;
                let simplified = if preserve_topology { poly.simplify_vw_preserve(&tolerance) } else { poly.simplify(&tolerance) };
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
