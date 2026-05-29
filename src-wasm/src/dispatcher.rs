use std::io::{Cursor, Read, Write};
use geojson::GeoJson;
use js_sys::Function;
use wasm_bindgen::JsError;
use zip::ZipArchive;
use geo::Simplify;
use geo::SimplifyVwPreserve;
use crate::types::*;

mod input;
mod export;
mod preview;
mod util;
mod ops;

use input::*;
use export::*;
use preview::*;
use util::*;
use ops::*;

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
            Operation::FilterAttribute { field, operator, value } => {
                let before = fc.features.len();
                fc.features.retain(|f| {
                    let Some(prop_val) = get_text_property(f, field) else {
                        return false;
                    };
                    match operator.as_str() {
                        "==" => prop_val == *value,
                        "!=" => prop_val != *value,
                        "contains" => prop_val.contains(value),
                        _ => false,
                    }
                });
                let removed = before - fc.features.len();
                logs.push(format!("operation:filter_attribute|removed={}", removed));
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
