use super::*;

pub(crate) fn stream_export_zip(
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

pub(crate) fn to_output_filename_with_ext(file_name: &str, ext: &str) -> String {
    let base = file_name.rsplit_once('.').map(|(b, _)| b).unwrap_or(file_name);
    format!("{}.geosurgical.{}", base, ext)
}

// --- Shapefile ZIP Export ---

pub(crate) fn write_shapefile_zip(fc: &geojson::FeatureCollection) -> Result<Vec<u8>, JsError> {
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

pub(crate) fn write_shp<W: Write>(writer: &mut W, shapes: &[shapefile::Shape]) -> Result<(), JsError> {
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

pub(crate) fn write_shx<W: Write>(writer: &mut W, shapes: &[shapefile::Shape]) -> Result<(), JsError> {
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

pub(crate) fn write_shp_header<W: Write>(writer: &mut W, file_length_words: u32, shape_type: i32, bbox: [f64; 4]) -> Result<(), JsError> {
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

pub(crate) fn compute_shapes_bbox(shapes: &[shapefile::Shape]) -> [f64; 4] {
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

pub(crate) fn shape_type_code(shape: &shapefile::Shape) -> i32 {
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

pub(crate) fn shape_content_length_words(shape: &shapefile::Shape) -> usize {
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

pub(crate) fn compute_shp_file_length_words(shapes: &[shapefile::Shape]) -> u32 {
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

pub(crate) fn write_shape_record<W: Write>(writer: &mut W, shape: &shapefile::Shape) -> Result<(), JsError> {
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

pub(crate) fn write_point_bbox<W: Write>(writer: &mut W, points: impl Iterator<Item = (f64, f64)>) -> Result<(), JsError> {
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

pub(crate) fn write_parts_header<W: Write>(writer: &mut W, parts: &[Vec<shapefile::Point>], num_points: usize) -> Result<(), JsError> {
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

pub(crate) fn write_polygon_header<W: Write>(writer: &mut W, rings: &[shapefile::PolygonRing<shapefile::Point>], num_points: usize) -> Result<(), JsError> {
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

pub(crate) fn write_polygon_header_z<W: Write>(writer: &mut W, rings: &[shapefile::PolygonRing<shapefile::PointZ>], num_points: usize) -> Result<(), JsError> {
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

pub(crate) fn compute_z_range_poly_z(poly: &shapefile::PolygonZ) -> (f64, f64) {
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

pub(crate) fn geojson_geometry_to_shape(geom: &geojson::Geometry) -> shapefile::Shape {
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

pub(crate) fn coords_to_shp_points(coords: &[Vec<f64>]) -> Vec<shapefile::Point> {
    coords.iter()
        .filter(|c| c.len() >= 2)
        .map(|c| shapefile::Point { x: c[0], y: c[1] })
        .collect()
}

pub(crate) fn geojson_rings_to_shp(rings: &[Vec<Vec<f64>>]) -> Vec<shapefile::PolygonRing<shapefile::Point>> {
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

pub(crate) fn build_dbf_bytes(features: &[geojson::Feature]) -> Vec<u8> {
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

pub(crate) fn truncate_to_bytes(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}
