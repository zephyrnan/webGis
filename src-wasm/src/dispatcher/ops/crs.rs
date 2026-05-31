pub(crate) fn apply_gcj02_transform(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_gcj02(geom);
        }
    }
}

pub(crate) fn transform_geometry_gcj02(geom: &mut geojson::Geometry) {
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

pub(crate) fn wgs84_to_gcj02(lat: f64, lng: f64) -> (f64, f64) {
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

pub(crate) fn transform_lat(x: f64, y: f64) -> f64 {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * x.abs().sqrt();
    let ret = ret + (20.0 * (6.0 * x * std::f64::consts::PI).sin() + 20.0 * (2.0 * x * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    let ret = ret + (20.0 * (y * std::f64::consts::PI).sin() + 40.0 * (y / 3.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    ret + (160.0 * (y / 12.0 * std::f64::consts::PI).sin() + 320.0 * (y * std::f64::consts::PI).sin()) * 2.0 / 3.0
}

pub(crate) fn transform_lng(x: f64, y: f64) -> f64 {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * x.abs().sqrt();
    let ret = ret + (20.0 * (6.0 * x * std::f64::consts::PI).sin() + 20.0 * (2.0 * x * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    let ret = ret + (20.0 * (x * std::f64::consts::PI).sin() + 40.0 * (x / 3.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0;
    ret + (150.0 * (x / 12.0 * std::f64::consts::PI).sin() + 300.0 * (x / 30.0 * std::f64::consts::PI).sin()) * 2.0 / 3.0
}

// --- WGS-84 (EPSG:4326) → Web Mercator (EPSG:3857) ---

pub(crate) fn wgs84_to_mercator(lat: f64, lng: f64) -> (f64, f64) {
    let lat = lat.clamp(-85.05112878, 85.05112878);
    let x = lng * 20037508.34 / 180.0;
    let y = ((90.0 + lat) * std::f64::consts::PI / 360.0).tan().ln() / std::f64::consts::PI * 20037508.34;
    (x, y)
}

pub(crate) fn apply_wgs84_to_mercator(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_wgs84_to_mercator(geom);
        }
    }
}

pub(crate) fn transform_geometry_wgs84_to_mercator(geom: &mut geojson::Geometry) {
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

pub(crate) fn gcj02_to_wgs84(lat: f64, lng: f64) -> (f64, f64) {
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

pub(crate) fn apply_gcj02_to_wgs84(fc: &mut geojson::FeatureCollection) {
    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_gcj02_to_wgs84(geom);
        }
    }
}

pub(crate) fn transform_geometry_gcj02_to_wgs84(geom: &mut geojson::Geometry) {
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

// --- Generic CRS Reprojection (proj4rs + crs-definitions) ---

pub(crate) fn apply_reproject(fc: &mut geojson::FeatureCollection, from_epsg: u32, to_epsg: u32) -> Result<(), String> {
    use proj4rs::proj::Proj;

    let from_code = u16::try_from(from_epsg)
        .map_err(|_| format!("EPSG code out of range: {}", from_epsg))?;
    let to_code = u16::try_from(to_epsg)
        .map_err(|_| format!("EPSG code out of range: {}", to_epsg))?;

    let from_def = crs_definitions::from_code(from_code)
        .ok_or_else(|| format!("UNKNOWN_EPSG: {} is not a recognized EPSG code", from_epsg))?;
    let to_def = crs_definitions::from_code(to_code)
        .ok_or_else(|| format!("UNKNOWN_EPSG: {} is not a recognized EPSG code", to_epsg))?;

    let from_proj = Proj::from_proj_string(from_def.proj4)
        .map_err(|e| format!("Invalid source proj4 for EPSG:{}: {:?}", from_epsg, e))?;
    let to_proj = Proj::from_proj_string(to_def.proj4)
        .map_err(|e| format!("Invalid target proj4 for EPSG:{}: {:?}", to_epsg, e))?;

    for feature in &mut fc.features {
        if let Some(ref mut geom) = feature.geometry {
            transform_geometry_reproject(geom, &from_proj, &to_proj);
        }
    }

    Ok(())
}

fn transform_geometry_reproject(geom: &mut geojson::Geometry, from: &proj4rs::proj::Proj, to: &proj4rs::proj::Proj) {
    use geojson::Value;
    match &mut geom.value {
        Value::Point(ref mut coords) => {
            reproject_coord(coords, from, to);
        }
        Value::MultiPoint(ref mut coords) | Value::LineString(ref mut coords) => {
            for c in coords.iter_mut() {
                reproject_coord(c, from, to);
            }
        }
        Value::MultiLineString(ref mut rings) | Value::Polygon(ref mut rings) => {
            for ring in rings.iter_mut() {
                for c in ring.iter_mut() {
                    reproject_coord(c, from, to);
                }
            }
        }
        Value::MultiPolygon(ref mut polygons) => {
            for polygon in polygons.iter_mut() {
                for ring in polygon.iter_mut() {
                    for c in ring.iter_mut() {
                        reproject_coord(c, from, to);
                    }
                }
            }
        }
        Value::GeometryCollection(ref mut geometries) => {
            for g in geometries.iter_mut() {
                transform_geometry_reproject(g, from, to);
            }
        }
    }
}

fn reproject_coord(coords: &mut Vec<f64>, from: &proj4rs::proj::Proj, to: &proj4rs::proj::Proj) {
    if coords.len() < 2 { return; }
    // proj4rs expects radians for angular CRS, meters for projected CRS
    let is_from_angular = is_angular_crs(from);
    let is_to_angular = is_angular_crs(to);

    let x = if is_from_angular { coords[0].to_radians() } else { coords[0] };
    let y = if is_from_angular { coords[1].to_radians() } else { coords[1] };

    let mut point = (x, y, 0.0);
    if proj4rs::transform::transform(from, to, &mut point).is_err() {
        return; // Skip this coordinate on error — leave unchanged
    }

    coords[0] = if is_to_angular { point.0.to_degrees() } else { point.0 };
    coords[1] = if is_to_angular { point.1.to_degrees() } else { point.1 };
}

fn is_angular_crs(proj: &proj4rs::proj::Proj) -> bool {
    // proj4rs stores the projection name; longlat/latlong are angular CRS
    let name = proj.projname();
    name == "longlat" || name == "latlong" || name == "latlon" || name == "lonlat"
}

// --- Buffer ---
