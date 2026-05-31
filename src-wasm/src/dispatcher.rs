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
            Operation::Reproject { from_epsg, to_epsg } => {
                match apply_reproject(&mut fc, *from_epsg, *to_epsg) {
                    Ok(()) => {
                        logs.push(format!("operation:reproject|from=EPSG:{}|to=EPSG:{}", from_epsg, to_epsg));
                    }
                    Err(e) => {
                        warnings.push(format!("REPROJECT_FAILED: {}", e));
                        logs.push(format!("operation:reproject|skipped=true|from=EPSG:{}|to=EPSG:{}|error={}", from_epsg, to_epsg, e));
                    }
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
                // True geometric clipping: Polygon/MultiPolygon get intersection-clipped,
                // other geometry types fall back to bbox-intersects (keep or discard).
                fc.features = fc.features.into_iter().filter_map(|mut f| {
                    let Some(ref geom) = f.geometry else { return None; };
                    match clip_geometry_to_bbox(geom, bbox) {
                        Some(clipped_geom) => {
                            f.geometry = Some(clipped_geom);
                            Some(f)
                        }
                        None => None,
                    }
                }).collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ─── helpers ───────────────────────────────────────────────────

    fn sample_fc(features: Vec<serde_json::Value>) -> Vec<u8> {
        let fc = json!({
            "type": "FeatureCollection",
            "features": features
        });
        serde_json::to_vec(&fc).unwrap()
    }

    fn point_feature(lng: f64, lat: f64, props: serde_json::Value) -> serde_json::Value {
        json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lng, lat] },
            "properties": props
        })
    }

    fn polygon_feature(ring: Vec<Vec<f64>>, props: serde_json::Value) -> serde_json::Value {
        json!({
            "type": "Feature",
            "geometry": { "type": "Polygon", "coordinates": [ring] },
            "properties": props
        })
    }

    fn square_ring(cx: f64, cy: f64, size: f64) -> Vec<Vec<f64>> {
        let h = size / 2.0;
        vec![
            vec![cx - h, cy - h],
            vec![cx + h, cy - h],
            vec![cx + h, cy + h],
            vec![cx - h, cy + h],
            vec![cx - h, cy - h],
        ]
    }

    fn make_ast(ops: Vec<Operation>) -> GeoSurgicalAst {
        GeoSurgicalAst {
            version: "1".into(),
            operations: ops,
            target_layer: None,
        }
    }

    /// Run execute() and return (envelope, data_bytes).
    fn run(input: &[u8], ast: &GeoSurgicalAst) -> (SurgeryEnvelope, Vec<u8>) {
        let buf = execute(input, ast, "test.geojson", input.len() as f64, &None).unwrap();
        let env_len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        let env_bytes = &buf[4..4 + env_len];
        let data = buf[4 + env_len..].to_vec();
        let envelope: SurgeryEnvelope = serde_json::from_slice(env_bytes).unwrap();
        (envelope, data)
    }

    fn run_data_fc(data: &[u8]) -> serde_json::Value {
        serde_json::from_slice(data).unwrap()
    }

    // ─── filter_area ───────────────────────────────────────────────

    #[test]
    fn filter_area_removes_zero_area() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "area": 0 })),
            point_feature(2.0, 2.0, json!({ "area": 50 })),
            point_feature(3.0, 3.0, json!({ "area": 100 })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterArea { field: "area".into(), operator: ">".into(), value: 0.0 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
        assert_eq!(fc["features"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn filter_area_keeps_all_when_all_pass() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "area": 10 })),
            point_feature(2.0, 2.0, json!({ "area": 20 })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterArea { field: "area".into(), operator: ">=".into(), value: 5.0 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    #[test]
    fn filter_area_less_than() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "area": 5 })),
            point_feature(2.0, 2.0, json!({ "area": 15 })),
            point_feature(3.0, 3.0, json!({ "area": 25 })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterArea { field: "area".into(), operator: "<".into(), value: 20.0 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    // ─── filter_attribute ──────────────────────────────────────────

    #[test]
    fn filter_attribute_equals() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "name": "Beijing" })),
            point_feature(2.0, 2.0, json!({ "name": "Shanghai" })),
            point_feature(3.0, 3.0, json!({ "name": "Beijing" })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterAttribute { field: "name".into(), operator: "==".into(), value: "Beijing".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    #[test]
    fn filter_attribute_not_equals() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "type": "road" })),
            point_feature(2.0, 2.0, json!({ "type": "river" })),
            point_feature(3.0, 3.0, json!({ "type": "road" })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterAttribute { field: "type".into(), operator: "!=".into(), value: "river".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    #[test]
    fn filter_attribute_contains() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "desc": "main highway" })),
            point_feature(2.0, 2.0, json!({ "desc": "small trail" })),
            point_feature(3.0, 3.0, json!({ "desc": "highway ramp" })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterAttribute { field: "desc".into(), operator: "contains".into(), value: "highway".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    // ─── drop_empty ────────────────────────────────────────────────

    #[test]
    fn drop_empty_removes_null_and_empty_string() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "name": "valid" })),
            point_feature(2.0, 2.0, json!({ "name": null })),
            point_feature(3.0, 3.0, json!({ "name": "" })),
            point_feature(4.0, 4.0, json!({ "name": "also valid" })),
        ]);
        let ast = make_ast(vec![
            Operation::DropEmpty { field: "name".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    // ─── rename_field ──────────────────────────────────────────────

    #[test]
    fn rename_field_renames_property() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "old_name": "hello", "other": 42 })),
        ]);
        let ast = make_ast(vec![
            Operation::RenameField { from: "old_name".into(), to: "new_name".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let props = &fc["features"][0]["properties"];
        assert!(props.get("old_name").is_none());
        assert_eq!(props["new_name"], "hello");
        assert_eq!(props["other"], 42);
        assert_eq!(env.result.summary.output_feature_count, Some(1));
    }

    // ─── transform_crs ─────────────────────────────────────────────

    #[test]
    fn transform_crs_wgs84_to_gcj02() {
        // Beijing coordinates
        let input = sample_fc(vec![
            point_feature(116.4, 39.9, json!({ "name": "Beijing" })),
        ]);
        let ast = make_ast(vec![
            Operation::TransformCrs { from: "EPSG:4326".into(), to: "GCJ-02".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let coords = fc["features"][0]["geometry"]["coordinates"].as_array().unwrap();
        let lng = coords[0].as_f64().unwrap();
        let lat = coords[1].as_f64().unwrap();
        // GCJ-02 offset should be within ~0.01 degrees
        assert!((lng - 116.4).abs() < 0.01);
        assert!((lat - 39.9).abs() < 0.01);
        // Coordinates should have actually changed
        assert!(lng != 116.4 || lat != 39.9);
        assert!(env.result.logs.iter().any(|l| l.contains("GCJ-02")));
    }

    #[test]
    fn transform_crs_wgs84_to_mercator() {
        let input = sample_fc(vec![
            point_feature(0.0, 0.0, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::TransformCrs { from: "EPSG:4326".into(), to: "EPSG:3857".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let coords = fc["features"][0]["geometry"]["coordinates"].as_array().unwrap();
        // (0,0) WGS84 → (0,0) in Mercator
        assert!(coords[0].as_f64().unwrap().abs() < 1.0);
        assert!(coords[1].as_f64().unwrap().abs() < 1.0);
        assert!(env.result.logs.iter().any(|l| l.contains("Web Mercator")));
    }

    #[test]
    fn transform_crs_gcj02_to_wgs84_roundtrip() {
        let input = sample_fc(vec![
            point_feature(116.4, 39.9, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::TransformCrs { from: "EPSG:4326".into(), to: "GCJ-02".into() },
            Operation::TransformCrs { from: "GCJ-02".into(), to: "EPSG:4326".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let coords = fc["features"][0]["geometry"]["coordinates"].as_array().unwrap();
        let lng = coords[0].as_f64().unwrap();
        let lat = coords[1].as_f64().unwrap();
        // Round-trip should be within 1 meter (~0.00001 degrees)
        assert!((lng - 116.4).abs() < 0.0001, "lng roundtrip: got {}", lng);
        assert!((lat - 39.9).abs() < 0.0001, "lat roundtrip: got {}", lat);
    }

    #[test]
    fn transform_crs_unsupported_produces_warning() {
        let input = sample_fc(vec![point_feature(0.0, 0.0, json!({}))]);
        let ast = make_ast(vec![
            Operation::TransformCrs { from: "EPSG:4326".into(), to: "EPSG:32650".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.warnings.iter().any(|w| w.contains("UNSUPPORTED_CRS_TRANSFORM")));
    }

    // ─── reproject (generic CRS via proj4rs) ───────────────────────

    #[test]
    fn reproject_wgs84_to_utm_zone50() {
        // Beijing (116.4, 39.9) → UTM Zone 50N (EPSG:32650)
        // Expected: x ≈ 449029, y ≈ 4416674
        let input = sample_fc(vec![
            point_feature(116.4, 39.9, json!({ "name": "Beijing" })),
        ]);
        let ast = make_ast(vec![
            Operation::Reproject { from_epsg: 4326, to_epsg: 32650 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let coords = fc["features"][0]["geometry"]["coordinates"].as_array().unwrap();
        let x = coords[0].as_f64().unwrap();
        let y = coords[1].as_f64().unwrap();
        // UTM Zone 50N for Beijing: x ≈ 448700–449100, y ≈ 4416500–4416800
        // (proj4rs uses WGS84 ellipsoid; small differences from PROJ C library are expected)
        assert!(x > 448000.0 && x < 450000.0, "UTM x out of range: got {}", x);
        assert!(y > 4416000.0 && y < 4418000.0, "UTM y out of range: got {}", y);
        assert!(env.result.logs.iter().any(|l| l.contains("EPSG:32650")));
    }

    #[test]
    fn reproject_wgs84_to_mercator_via_reproject() {
        // Verify reproject gives same result as transform_crs for EPSG:3857
        let input1 = sample_fc(vec![point_feature(116.4, 39.9, json!({}))]);
        let input2 = input1.clone();

        // Via transform_crs
        let ast1 = make_ast(vec![
            Operation::TransformCrs { from: "EPSG:4326".into(), to: "EPSG:3857".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data1) = run(&input1, &ast1);
        let fc1 = run_data_fc(&data1);
        let c1 = fc1["features"][0]["geometry"]["coordinates"].as_array().unwrap();

        // Via reproject
        let ast2 = make_ast(vec![
            Operation::Reproject { from_epsg: 4326, to_epsg: 3857 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data2) = run(&input2, &ast2);
        let fc2 = run_data_fc(&data2);
        let c2 = fc2["features"][0]["geometry"]["coordinates"].as_array().unwrap();

        let x1 = c1[0].as_f64().unwrap();
        let x2 = c2[0].as_f64().unwrap();
        let y1 = c1[1].as_f64().unwrap();
        let y2 = c2[1].as_f64().unwrap();

        // Both should produce ~same result (within 1m tolerance)
        assert!((x1 - x2).abs() < 1.0, "x diff: {} vs {}", x1, x2);
        assert!((y1 - y2).abs() < 1.0, "y diff: {} vs {}", y1, y2);
    }

    #[test]
    fn reproject_roundtrip_utm_to_wgs84() {
        let input = sample_fc(vec![
            point_feature(116.4, 39.9, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::Reproject { from_epsg: 4326, to_epsg: 32650 },
            Operation::Reproject { from_epsg: 32650, to_epsg: 4326 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let coords = fc["features"][0]["geometry"]["coordinates"].as_array().unwrap();
        let lng = coords[0].as_f64().unwrap();
        let lat = coords[1].as_f64().unwrap();
        assert!((lng - 116.4).abs() < 0.001, "lng roundtrip: got {}", lng);
        assert!((lat - 39.9).abs() < 0.001, "lat roundtrip: got {}", lat);
    }

    #[test]
    fn reproject_unknown_epsg_produces_warning() {
        let input = sample_fc(vec![point_feature(0.0, 0.0, json!({}))]);
        let ast = make_ast(vec![
            Operation::Reproject { from_epsg: 99999, to_epsg: 4326 },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.warnings.iter().any(|w| w.contains("REPROJECT_FAILED")));
    }

    // ─── simplify ──────────────────────────────────────────────────

    #[test]
    fn simplify_reduces_vertex_count() {
        // Create a polygon with many vertices
        let mut ring = Vec::new();
        for i in 0..100 {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / 99.0;
            ring.push(vec![angle.cos(), angle.sin()]);
        }
        ring.push(ring[0].clone()); // close ring

        let input = sample_fc(vec![polygon_feature(ring, json!({}))]);
        let ast = make_ast(vec![
            Operation::Simplify { tolerance: 0.1, preserve_topology: Some(true) },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let result_ring = fc["features"][0]["geometry"]["coordinates"][0].as_array().unwrap();
        // Should have fewer vertices than 100
        assert!(result_ring.len() < 100, "simplified to {} vertices", result_ring.len());
        assert!(env.result.logs.iter().any(|l| l.contains("simplify")));
    }

    // ─── field_calculate ───────────────────────────────────────────

    #[test]
    fn field_calculate_add() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "a": 10, "b": 5 })),
            point_feature(2.0, 2.0, json!({ "a": 20, "b": 3 })),
        ]);
        let ast = make_ast(vec![
            Operation::FieldCalculate {
                target_field: "sum".into(),
                operation: "add".into(),
                operands: vec!["a".into(), "b".into()],
            },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(fc["features"][0]["properties"]["sum"], 15.0);
        assert_eq!(fc["features"][1]["properties"]["sum"], 23.0);
    }

    #[test]
    fn field_calculate_multiply() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "x": 4, "y": 3 })),
        ]);
        let ast = make_ast(vec![
            Operation::FieldCalculate {
                target_field: "product".into(),
                operation: "multiply".into(),
                operands: vec!["x".into(), "y".into()],
            },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(fc["features"][0]["properties"]["product"], 12.0);
    }

    #[test]
    fn field_calculate_divide_by_zero() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "a": 10, "b": 0 })),
        ]);
        let ast = make_ast(vec![
            Operation::FieldCalculate {
                target_field: "result".into(),
                operation: "divide".into(),
                operands: vec!["a".into(), "b".into()],
            },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.warnings.iter().any(|w| w.contains("FIELD_CALCULATE_ERRORS")));
    }

    // ─── validate_geometry ─────────────────────────────────────────
    // Note: NaN cannot survive JSON round-trip (serde_json serializes NaN as null).
    // These tests exercise the helper functions directly instead of going through execute().

    #[test]
    fn validate_geometry_nan_point_is_invalid() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![f64::NAN, 1.0]));
        assert!(!is_valid_geojson_geometry(&geom));
    }

    #[test]
    fn validate_geometry_inf_point_is_invalid() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![f64::INFINITY, 1.0]));
        assert!(!is_valid_geojson_geometry(&geom));
    }

    #[test]
    fn validate_geometry_valid_polygon() {
        let geom = geojson::Geometry::new(geojson::Value::Polygon(vec![
            vec![vec![0.0, 0.0], vec![1.0, 0.0], vec![1.0, 1.0], vec![0.0, 0.0]]
        ]));
        assert!(is_valid_geojson_geometry(&geom));
    }

    #[test]
    fn validate_geometry_fix_removes_nan_from_linestring() {
        let geom = geojson::Geometry::new(geojson::Value::LineString(vec![
            vec![1.0, 1.0], vec![f64::NAN, 2.0], vec![3.0, 3.0]
        ]));
        let fixed = try_fix_geometry(&geom).unwrap();
        if let geojson::Value::LineString(coords) = &fixed.value {
            assert_eq!(coords.len(), 2);
            assert_eq!(coords[0], vec![1.0, 1.0]);
            assert_eq!(coords[1], vec![3.0, 3.0]);
        } else {
            panic!("expected LineString");
        }
    }

    #[test]
    fn validate_geometry_fix_closes_unclosed_polygon_ring() {
        let geom = geojson::Geometry::new(geojson::Value::Polygon(vec![
            vec![vec![0.0, 0.0], vec![1.0, 0.0], vec![1.0, 1.0], vec![0.0, 1.0]]
        ]));
        // Ring is not closed (first != last)
        let fixed = try_fix_geometry(&geom).unwrap();
        if let geojson::Value::Polygon(rings) = &fixed.value {
            let ring = &rings[0];
            assert_eq!(ring.first(), ring.last(), "ring should be closed");
        } else {
            panic!("expected Polygon");
        }
    }

    #[test]
    fn validate_geometry_fix_removes_nan_from_polygon() {
        let geom = geojson::Geometry::new(geojson::Value::Polygon(vec![
            vec![
                vec![0.0, 0.0], vec![1.0, 0.0], vec![f64::NAN, 1.0],
                vec![1.0, 1.0], vec![0.0, 1.0], vec![0.0, 0.0]
            ]
        ]));
        let fixed = try_fix_geometry(&geom).unwrap();
        if let geojson::Value::Polygon(rings) = &fixed.value {
            // NaN point should have been removed
            for c in &rings[0] {
                assert!(c[0].is_finite() && c[1].is_finite());
            }
        } else {
            panic!("expected Polygon");
        }
    }

    #[test]
    fn validate_geometry_no_fix_needed_returns_none() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![1.0, 2.0]));
        assert!(try_fix_geometry(&geom).is_none(), "valid geometry should not need fixing");
    }

    #[test]
    fn validate_geometry_check_via_execute_with_valid_data() {
        // All-valid features → no warnings
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({})),
            point_feature(2.0, 2.0, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::ValidateGeometry { mode: "check".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.logs.iter().any(|l| l.contains("invalid=0")));
        assert!(!env.result.warnings.iter().any(|w| w.contains("INVALID_GEOMETRY")));
    }

    // ─── buffer ────────────────────────────────────────────────────

    #[test]
    fn buffer_point_produces_polygon() {
        let input = sample_fc(vec![
            point_feature(116.4, 39.9, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::Buffer { distance: 1000.0, segments: Some(16) },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        let geom_type = fc["features"][0]["geometry"]["type"].as_str().unwrap();
        // Point buffered → Polygon or MultiPolygon
        assert!(geom_type == "Polygon" || geom_type == "MultiPolygon",
                "expected Polygon/MultiPolygon, got {}", geom_type);
    }

    // ─── clip ──────────────────────────────────────────────────────

    #[test]
    fn clip_filters_by_bbox() {
        let input = sample_fc(vec![
            point_feature(10.0, 10.0, json!({ "name": "inside" })),
            point_feature(50.0, 50.0, json!({ "name": "outside" })),
            point_feature(15.0, 15.0, json!({ "name": "inside2" })),
        ]);
        let ast = make_ast(vec![
            Operation::Clip { bbox: [5.0, 5.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(env.result.summary.output_feature_count, Some(2));
        assert_eq!(fc["features"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn clip_polygon_intersects_bbox() {
        let input = sample_fc(vec![
            polygon_feature(square_ring(10.0, 10.0, 4.0), json!({ "name": "inside" })),
            polygon_feature(square_ring(50.0, 50.0, 4.0), json!({ "name": "outside" })),
        ]);
        let ast = make_ast(vec![
            Operation::Clip { bbox: [0.0, 0.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(1));
    }

    #[test]
    fn clip_truly_clips_partially_overlapping_polygon() {
        // Large polygon centered at (15, 15), size 20 → spans (5,5) to (25,25)
        // Clip bbox (0,0)-(20,20) → should produce a clipped polygon, not the original
        let input = sample_fc(vec![
            polygon_feature(square_ring(15.0, 15.0, 20.0), json!({ "name": "partial" })),
        ]);
        let ast = make_ast(vec![
            Operation::Clip { bbox: [0.0, 0.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(fc["features"].as_array().unwrap().len(), 1);

        // Verify the clipped geometry is actually smaller
        let geom = &fc["features"][0]["geometry"];
        let geom_type = geom["type"].as_str().unwrap();
        assert!(geom_type == "Polygon" || geom_type == "MultiPolygon");

        // Count vertices — original square has 5 points (4 + closing), clipped should have different count
        let vertex_count = match geom_type {
            "Polygon" => geom["coordinates"][0].as_array().unwrap().len(),
            "MultiPolygon" => geom["coordinates"][0][0].as_array().unwrap().len(),
            _ => unreachable!(),
        };
        // Original square has 5 vertices; clipped rectangle should have 5 vertices too,
        // but the coordinates should be different (bounded by clip bbox)
        assert!(vertex_count >= 4, "clipped polygon should have at least 4 vertices, got {}", vertex_count);

        // Verify no coordinate exceeds the clip bbox
        let ring = match geom_type {
            "Polygon" => geom["coordinates"][0].as_array().unwrap(),
            "MultiPolygon" => geom["coordinates"][0][0].as_array().unwrap(),
            _ => unreachable!(),
        };
        for coord in ring {
            let x = coord[0].as_f64().unwrap();
            let y = coord[1].as_f64().unwrap();
            assert!(x >= 0.0 && x <= 20.0, "x={} outside clip bbox", x);
            assert!(y >= 0.0 && y <= 20.0, "y={} outside clip bbox", y);
        }
    }

    #[test]
    fn clip_vs_intersect_produce_different_results() {
        // Polygon partially overlapping clip bbox:
        // - clip should return 1 feature with clipped geometry
        // - intersect should return 1 feature with ORIGINAL geometry
        let input_clip = sample_fc(vec![
            polygon_feature(square_ring(15.0, 15.0, 20.0), json!({})),
        ]);
        let input_intersect = input_clip.clone();

        // Clip: true geometric clipping
        let ast_clip = make_ast(vec![
            Operation::Clip { bbox: [0.0, 0.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, clip_data) = run(&input_clip, &ast_clip);
        let clip_fc = run_data_fc(&clip_data);

        // Intersect: bbox filtering only
        let ast_intersect = make_ast(vec![
            Operation::Intersect { bbox: [0.0, 0.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (_, intersect_data) = run(&input_intersect, &ast_intersect);
        let intersect_fc = run_data_fc(&intersect_data);

        // Both keep the feature
        assert_eq!(clip_fc["features"].as_array().unwrap().len(), 1);
        assert_eq!(intersect_fc["features"].as_array().unwrap().len(), 1);

        // But the geometries should differ: clip modifies, intersect preserves
        let clip_coords = &clip_fc["features"][0]["geometry"]["coordinates"];
        let intersect_coords = &intersect_fc["features"][0]["geometry"]["coordinates"];
        assert_ne!(clip_coords, intersect_coords,
            "clip should modify geometry, intersect should preserve it");
    }

    // ─── intersect ─────────────────────────────────────────────────

    #[test]
    fn intersect_filters_by_bbox() {
        let input = sample_fc(vec![
            point_feature(10.0, 10.0, json!({})),
            point_feature(50.0, 50.0, json!({})),
        ]);
        let ast = make_ast(vec![
            Operation::Intersect { bbox: [0.0, 0.0, 20.0, 20.0] },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert_eq!(env.result.summary.output_feature_count, Some(1));
    }

    // ─── dissolve ──────────────────────────────────────────────────

    #[test]
    fn dissolve_merges_by_field() {
        let input = sample_fc(vec![
            polygon_feature(square_ring(0.0, 0.0, 2.0), json!({ "group": "A" })),
            polygon_feature(square_ring(10.0, 10.0, 2.0), json!({ "group": "A" })),
            polygon_feature(square_ring(20.0, 20.0, 2.0), json!({ "group": "B" })),
        ]);
        let ast = make_ast(vec![
            Operation::Dissolve { field: "group".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        // A merged into 1, B stays as 1 → total 2
        assert_eq!(env.result.summary.output_feature_count, Some(2));
    }

    // ─── export ────────────────────────────────────────────────────

    #[test]
    fn export_geojson_default() {
        let input = sample_fc(vec![point_feature(1.0, 1.0, json!({}))]);
        let ast = make_ast(vec![
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        assert_eq!(env.result.kind, "geojson");
        assert!(env.result.file_name.ends_with(".geojson"));
        let fc: serde_json::Value = serde_json::from_slice(&data).unwrap();
        assert_eq!(fc["type"], "FeatureCollection");
    }

    #[test]
    fn export_csv_format() {
        let input = sample_fc(vec![
            point_feature(1.0, 2.0, json!({ "name": "test" })),
        ]);
        let ast = make_ast(vec![
            Operation::Export { format: "csv".into() },
        ]);
        // CSV export still goes through GeoJSON serialization in the current code;
        // the format is recorded but data output is still GeoJSON bytes.
        // This test verifies the export operation doesn't crash.
        let (env, _) = run(&input, &ast);
        assert!(env.result.logs.iter().any(|l| l.contains("csv")));
    }

    // ─── noop / need_clarification ─────────────────────────────────

    #[test]
    fn noop_passes_through() {
        let input = sample_fc(vec![point_feature(1.0, 1.0, json!({}))]);
        let ast = make_ast(vec![
            Operation::Noop { reason: "test".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.logs.iter().any(|l| l.contains("noop")));
        assert_eq!(env.result.summary.output_feature_count, Some(1));
    }

    #[test]
    fn need_clarification_adds_warning() {
        let input = sample_fc(vec![point_feature(1.0, 1.0, json!({}))]);
        let ast = make_ast(vec![
            Operation::NeedClarification { reason: "ambiguous layer".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, _) = run(&input, &ast);
        assert!(env.result.warnings.iter().any(|w| w.contains("NEED_CLARIFICATION")));
    }

    // ─── pipeline (multi-op) ───────────────────────────────────────

    #[test]
    fn pipeline_filter_then_rename_then_export() {
        let input = sample_fc(vec![
            point_feature(1.0, 1.0, json!({ "area": 0, "name": "zero" })),
            point_feature(2.0, 2.0, json!({ "area": 50, "name": "valid" })),
            point_feature(3.0, 3.0, json!({ "area": 100, "name": "big" })),
        ]);
        let ast = make_ast(vec![
            Operation::FilterArea { field: "area".into(), operator: ">".into(), value: 0.0 },
            Operation::RenameField { from: "name".into(), to: "label".into() },
            Operation::Export { format: "geojson".into() },
        ]);
        let (env, data) = run(&input, &ast);
        let fc = run_data_fc(&data);
        assert_eq!(fc["features"].as_array().unwrap().len(), 2);
        // All remaining features should have "label" instead of "name"
        for f in fc["features"].as_array().unwrap() {
            assert!(f["properties"].get("name").is_none());
            assert!(f["properties"].get("label").is_some());
        }
        assert_eq!(env.result.summary.operations, vec!["filter_area", "rename_field", "export"]);
    }

    // ─── envelope / undo ───────────────────────────────────────────

    #[test]
    fn undo_available_for_small_files() {
        let input = sample_fc(vec![point_feature(1.0, 1.0, json!({}))]);
        let ast = make_ast(vec![Operation::Export { format: "geojson".into() }]);
        let (env, _) = run(&input, &ast);
        assert!(env.undo.available);
        assert_eq!(env.undo.strategy, "snapshot");
    }

    #[test]
    fn undo_unavailable_for_large_files() {
        let input = sample_fc(vec![point_feature(1.0, 1.0, json!({}))]);
        let large_size = 60.0 * 1024.0 * 1024.0; // 60 MB
        let ast = make_ast(vec![Operation::Export { format: "geojson".into() }]);
        let buf = execute(&input, &ast, "test.geojson", large_size, &None).unwrap();
        let env_len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        let envelope: SurgeryEnvelope = serde_json::from_slice(&buf[4..4 + env_len]).unwrap();
        assert!(!envelope.undo.available);
        assert_eq!(envelope.undo.strategy, "replay_from_original");
    }

    // ─── output filename ───────────────────────────────────────────

    #[test]
    fn output_filename_geojson() {
        assert_eq!(
            to_output_filename_with_ext("sample.geojson", "geojson"),
            "sample.geosurgical.geojson"
        );
    }

    #[test]
    fn output_filename_zip() {
        assert_eq!(
            to_output_filename_with_ext("data.shp.zip", "zip"),
            "data.shp.geosurgical.zip"
        );
    }

    // ─── utility: compare_numeric ──────────────────────────────────

    #[test]
    fn compare_numeric_operators() {
        assert!(compare_numeric(10.0, ">=", 5.0));
        assert!(compare_numeric(5.0, ">=", 5.0));
        assert!(!compare_numeric(4.0, ">=", 5.0));
        assert!(compare_numeric(10.0, ">", 5.0));
        assert!(!compare_numeric(5.0, ">", 5.0));
        assert!(compare_numeric(3.0, "<=", 5.0));
        assert!(compare_numeric(5.0, "<=", 5.0));
        assert!(compare_numeric(3.0, "<", 5.0));
        assert!(compare_numeric(5.0, "=", 5.0));
        assert!(!compare_numeric(5.0, "=", 5.1));
        assert!(!compare_numeric(1.0, "??", 1.0));
    }

    #[test]
    fn compare_numeric_relative_epsilon() {
        // Large values: absolute epsilon would fail, relative should pass
        let big = 1e15;
        assert!(compare_numeric(big, "=", big));
        assert!(!compare_numeric(big, "=", big + 100.0));
    }

    // ─── utility: get_numeric_property / get_text_property ─────────

    #[test]
    fn get_numeric_property_works() {
        let f = geojson::Feature {
            bbox: None,
            geometry: None,
            id: None,
            properties: Some(serde_json::from_str(r#"{"area": 42.5}"#).unwrap()),
            foreign_members: Default::default(),
        };
        assert_eq!(get_numeric_property(&f, "area"), 42.5);
        assert_eq!(get_numeric_property(&f, "missing"), 0.0);
    }

    #[test]
    fn get_text_property_works() {
        let f = geojson::Feature {
            bbox: None,
            geometry: None,
            id: None,
            properties: Some(serde_json::from_str(r#"{"name": "hello", "count": 5, "empty": null}"#).unwrap()),
            foreign_members: Default::default(),
        };
        assert_eq!(get_text_property(&f, "name"), Some("hello".to_string()));
        assert_eq!(get_text_property(&f, "count"), Some("5".to_string()));
        assert_eq!(get_text_property(&f, "empty"), None);
        assert_eq!(get_text_property(&f, "missing"), None);
    }

    // ─── utility: resolve_operand ──────────────────────────────────

    #[test]
    fn resolve_operand_field_name() {
        let f = geojson::Feature {
            bbox: None,
            geometry: None,
            id: None,
            properties: Some(serde_json::from_str(r#"{"x": 7.5}"#).unwrap()),
            foreign_members: Default::default(),
        };
        assert_eq!(resolve_operand(&f, "x"), Some(7.5));
    }

    #[test]
    fn resolve_operand_numeric_literal() {
        let f = geojson::Feature {
            bbox: None,
            geometry: None,
            id: None,
            properties: Some(serde_json::Map::new()),
            foreign_members: Default::default(),
        };
        assert_eq!(resolve_operand(&f, "3.14"), Some(3.14));
        assert_eq!(resolve_operand(&f, "not_a_field"), None);
    }

    // ─── geometry helpers ──────────────────────────────────────────

    #[test]
    fn geojson_bbox_intersects_true() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![10.0, 10.0]));
        assert!(geojson_bbox_intersects(&geom, &[5.0, 5.0, 15.0, 15.0]));
    }

    #[test]
    fn geojson_bbox_intersects_false() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![50.0, 50.0]));
        assert!(!geojson_bbox_intersects(&geom, &[5.0, 5.0, 15.0, 15.0]));
    }

    #[test]
    fn is_valid_geojson_geometry_valid_point() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![1.0, 2.0]));
        assert!(is_valid_geojson_geometry(&geom));
    }

    #[test]
    fn is_valid_geojson_geometry_nan() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![f64::NAN, 2.0]));
        assert!(!is_valid_geojson_geometry(&geom));
    }

    #[test]
    fn is_valid_geojson_geometry_inf() {
        let geom = geojson::Geometry::new(geojson::Value::Point(vec![1.0, f64::INFINITY]));
        assert!(!is_valid_geojson_geometry(&geom));
    }

    // ─── CRS math ──────────────────────────────────────────────────

    #[test]
    fn wgs84_to_mercator_origin() {
        let (x, y) = wgs84_to_mercator(0.0, 0.0);
        assert!(x.abs() < 1.0);
        assert!(y.abs() < 1.0);
    }

    #[test]
    fn wgs84_to_mercator_known_point() {
        // London: lat=51.5, lng=-0.1
        let (x, y) = wgs84_to_mercator(51.5, -0.1);
        assert!((x - (-11131.9)).abs() < 100.0, "x={}", x);
        assert!((y - 6711455.0).abs() < 10000.0, "y={}", y);
    }

    #[test]
    fn gcj02_roundtrip_accuracy() {
        let lat = 39.9;
        let lng = 116.4;
        let (glat, glng) = wgs84_to_gcj02(lat, lng);
        let (wlat, wlng) = gcj02_to_wgs84(glat, glng);
        assert!((wlat - lat).abs() < 0.0001, "lat: {} → {}", lat, wlat);
        assert!((wlng - lng).abs() < 0.0001, "lng: {} → {}", lng, wlng);
    }

    // ─── fix_encoding inplace ──────────────────────────────────────

    #[test]
    fn fix_encoding_inplace_cleans_replacement_chars() {
        let dirty = format!("hello{}world", '\u{FFFD}');
        let mut props = serde_json::Map::new();
        props.insert("name".into(), serde_json::Value::String(dirty));
        let mut fc = geojson::FeatureCollection {
            bbox: None,
            features: vec![geojson::Feature {
                bbox: None,
                geometry: None,
                id: None,
                properties: Some(props),
                foreign_members: Default::default(),
            }],
            foreign_members: None,
        };
        let enc = encoding_rs::Encoding::for_label(b"utf-8");
        let (cleaned, _log) = fix_encoding_inplace(&mut fc, enc, "utf-8", "utf-8");
        assert_eq!(cleaned, 1);
        let name = fc.features[0].properties.as_ref().unwrap().get("name").unwrap().as_str().unwrap();
        assert!(!name.contains('\u{FFFD}'));
        assert_eq!(name, "helloworld");
    }

    // ─── input: GeoJSON parsing ────────────────────────────────────

    #[test]
    fn parse_geojson_feature_collection_valid() {
        let input = b"{\"type\":\"FeatureCollection\",\"features\":[]}";
        let fc = parse_geojson_feature_collection(input).unwrap();
        assert_eq!(fc.features.len(), 0);
    }

    #[test]
    fn parse_geojson_single_feature() {
        let input = b"{\"type\":\"Feature\",\"geometry\":null,\"properties\":{}}";
        let fc = parse_geojson_feature_collection(input).unwrap();
        assert_eq!(fc.features.len(), 1);
    }

    #[test]
    fn parse_geojson_invalid_returns_error() {
        // JsError::new() panics on non-wasm targets, so we catch the panic
        let result = std::panic::catch_unwind(|| {
            let input = b"not json at all";
            parse_geojson_feature_collection(input)
        });
        // On non-wasm, JsError::new panics → catch_unwind returns Err
        // On wasm, it would return Ok(Err(JsError))
        assert!(result.is_err() || result.unwrap().is_err());
    }

    #[test]
    fn is_zip_detection() {
        assert!(is_zip_input(&[0x50, 0x4B, 0x03, 0x04], "data.bin"));
        assert!(is_zip_input(&[0x00, 0x00], "data.zip"));
        assert!(!is_zip_input(&[0x7B, 0x22], "data.geojson"));
    }

    // ─── DBF value parsing ─────────────────────────────────────────

    #[test]
    fn parse_dbf_value_numeric() {
        let v = parse_dbf_value_lossy(b"  42.5  ", 'N');
        assert_eq!(v, serde_json::json!(42.5));
    }

    #[test]
    fn parse_dbf_value_string() {
        let v = parse_dbf_value_lossy(b"hello", 'C');
        assert_eq!(v, serde_json::json!("hello"));
    }

    #[test]
    fn parse_dbf_value_boolean() {
        assert_eq!(parse_dbf_value_lossy(b"T", 'L'), serde_json::json!(true));
        assert_eq!(parse_dbf_value_lossy(b"F", 'L'), serde_json::json!(false));
    }

    #[test]
    fn parse_dbf_value_empty_is_null() {
        let v = parse_dbf_value_lossy(b"  ", 'C');
        assert!(v.is_null());
    }

    // ─── operation_name ────────────────────────────────────────────

    #[test]
    fn operation_name_all_variants() {
        assert_eq!(operation_name(&Operation::FilterArea { field: "".into(), operator: "".into(), value: 0.0 }), "filter_area");
        assert_eq!(operation_name(&Operation::FilterAttribute { field: "".into(), operator: "".into(), value: "".into() }), "filter_attribute");
        assert_eq!(operation_name(&Operation::DropEmpty { field: "".into() }), "drop_empty");
        assert_eq!(operation_name(&Operation::RenameField { from: "".into(), to: "".into() }), "rename_field");
        assert_eq!(operation_name(&Operation::TransformCrs { from: "".into(), to: "".into() }), "transform_crs");
        assert_eq!(operation_name(&Operation::Reproject { from_epsg: 0, to_epsg: 0 }), "reproject");
        assert_eq!(operation_name(&Operation::FixEncoding { from: "".into(), to: "".into() }), "fix_encoding");
        assert_eq!(operation_name(&Operation::Simplify { tolerance: 0.0, preserve_topology: None }), "simplify");
        assert_eq!(operation_name(&Operation::FieldCalculate { target_field: "".into(), operation: "".into(), operands: vec![] }), "field_calculate");
        assert_eq!(operation_name(&Operation::ValidateGeometry { mode: "".into() }), "validate_geometry");
        assert_eq!(operation_name(&Operation::Buffer { distance: 0.0, segments: None }), "buffer");
        assert_eq!(operation_name(&Operation::Clip { bbox: [0.0; 4] }), "clip");
        assert_eq!(operation_name(&Operation::Intersect { bbox: [0.0; 4] }), "intersect");
        assert_eq!(operation_name(&Operation::Dissolve { field: "".into() }), "dissolve");
        assert_eq!(operation_name(&Operation::Export { format: "".into() }), "export");
        assert_eq!(operation_name(&Operation::Noop { reason: "".into() }), "noop");
        assert_eq!(operation_name(&Operation::NeedClarification { reason: "".into() }), "need_clarification");
    }
}
