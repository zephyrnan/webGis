use super::*;

pub(crate) fn compute_preview_hull_from_fc(fc: &geojson::FeatureCollection) -> serde_json::Value {
    let mut points: Vec<geo::Coord<f64>> = Vec::new();
    for feature in &fc.features {
        if let Some(ref geom) = feature.geometry {
            extract_coords_from_geometry(geom, &mut points);
        }
    }
    compute_preview_hull_from_points(&points)
}

pub(crate) fn compute_preview_hull_from_points(points: &[geo::Coord<f64>]) -> serde_json::Value {
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
