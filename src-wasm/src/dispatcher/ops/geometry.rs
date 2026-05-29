use super::super::*;

pub(crate) fn buffer_geojson_geometry(geom: &geojson::Geometry, distance: f64, segments: u32) -> Option<geojson::Geometry> {
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

pub(crate) fn make_buffer_circle(lat: f64, lng: f64, distance: f64, segments: u32) -> geojson::Geometry {
    let polygon = geo_polygon_from_circle(lat, lng, distance, segments);
    let mp = geo::MultiPolygon(vec![polygon]);
    geo_to_geojson_polygon(&mp).unwrap_or_else(|| {
        geojson::Geometry::new(geojson::Value::Polygon(vec![vec![]]))
    })
}

pub(crate) fn geo_polygon_from_circle(lat: f64, lng: f64, distance: f64, segments: u32) -> geo::Polygon<f64> {
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

pub(crate) fn merge_geo_polygons(mut polygons: Vec<geo::Polygon<f64>>) -> geo::MultiPolygon<f64> {
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

pub(crate) fn geo_to_geojson_polygon(mp: &geo::MultiPolygon<f64>) -> Option<geojson::Geometry> {
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

pub(crate) fn buffer_linestring(coords: &[Vec<f64>], distance: f64, segments: u32) -> Option<geojson::Geometry> {
    if coords.len() < 2 { return None; }
    let mut circles = Vec::new();
    for c in coords {
        circles.push(geo_polygon_from_circle(c[1], c[0], distance, segments));
    }
    let merged = merge_geo_polygons(circles);
    geo_to_geojson_polygon(&merged)
}

pub(crate) fn buffer_polygon_rings(rings: &[Vec<Vec<f64>>], distance: f64, segments: u32) -> Option<geojson::Geometry> {
    let Some(outer) = rings.first() else { return None; };
    let mut circles = Vec::new();
    for c in outer {
        circles.push(geo_polygon_from_circle(c[1], c[0], distance, segments));
    }
    let merged = merge_geo_polygons(circles);
    geo_to_geojson_polygon(&merged)
}

// --- Clip / Intersect bbox check ---

pub(crate) fn geojson_bbox_intersects(geom: &geojson::Geometry, bbox: &[f64; 4]) -> bool {
    let Some(geom_bbox) = geojson_geometry_bbox(geom) else { return false; };
    // Check if bounding boxes overlap
    !(geom_bbox[2] < bbox[0] || geom_bbox[0] > bbox[2] || geom_bbox[3] < bbox[1] || geom_bbox[1] > bbox[3])
}

pub(crate) fn geojson_geometry_bbox(geom: &geojson::Geometry) -> Option<[f64; 4]> {
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

pub(crate) fn dissolve_by_field(fc: &geojson::FeatureCollection, field: &str) -> Vec<geojson::Feature> {
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

pub(crate) fn geojson_to_geo_polygon(geom: &geojson::Geometry) -> Option<geo::MultiPolygon<f64>> {
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

pub(crate) fn extract_coords_from_geometry(geom: &geojson::Geometry, out: &mut Vec<geo::Coord<f64>>) {
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

pub(crate) fn count_geojson_coords(geom: &geojson::Geometry) -> usize {
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

pub(crate) fn simplify_geojson_geometry(geom: &geojson::Geometry, tolerance: f64, preserve_topology: bool) -> Option<geojson::Geometry> {
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

pub(crate) fn geo_linestring_from_coords(coords: &[Vec<f64>]) -> geo::LineString<f64> {
    geo::LineString(coords.iter().filter(|c| c.len() >= 2).map(|c| geo::Coord { x: c[0], y: c[1] }).collect())
}

pub(crate) fn geo_ls_to_coords(ls: &geo::LineString<f64>) -> Vec<Vec<f64>> {
    ls.0.iter().map(|c| vec![c.x, c.y]).collect()
}

pub(crate) fn geo_polygon_from_rings(rings: &[Vec<Vec<f64>>]) -> Option<geo::Polygon<f64>> {
    if rings.is_empty() { return None; }
    let exterior = geo_linestring_from_coords(&rings[0]);
    let interiors: Vec<geo::LineString<f64>> = rings[1..].iter().map(|r| geo_linestring_from_coords(r)).collect();
    Some(geo::Polygon::new(exterior, interiors))
}

pub(crate) fn geo_poly_to_rings(poly: &geo::Polygon<f64>) -> Vec<Vec<Vec<f64>>> {
    let mut result = vec![geo_ls_to_coords(poly.exterior())];
    for interior in poly.interiors() {
        result.push(geo_ls_to_coords(interior));
    }
    result
}

pub(crate) fn is_valid_geojson_geometry(geom: &geojson::Geometry) -> bool {
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

pub(crate) fn is_valid_coord_slice(c: &[f64]) -> bool {
    c.len() >= 2 && c[0].is_finite() && c[1].is_finite()
}

pub(crate) fn try_fix_geometry(geom: &geojson::Geometry) -> Option<geojson::Geometry> {
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
