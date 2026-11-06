import math
import json
import os
import xml.etree.ElementTree as ET
import pyproj
from shapely.geometry import Point, LineString, Polygon

# 1. Coordinate Reference Systems
wgs84 = pyproj.CRS("EPSG:4326")
utm43 = pyproj.CRS("EPSG:32643")
transformer_to_utm = pyproj.Transformer.from_crs(wgs84, utm43, always_xy=True)
transformer_to_wgs84 = pyproj.Transformer.from_crs(utm43, wgs84, always_xy=True)

def lon_lat_to_utm(lon, lat):
    return transformer_to_utm.transform(lon, lat)

def utm_to_lon_lat(e, n):
    return transformer_to_wgs84.transform(e, n)

# 2. Parse KML Data
kml_path = "public/data/mandovi/mandovi_river.kml"
tree = ET.parse(kml_path)
root = tree.getroot()
ns = {"kml": "http://www.opengis.net/kml/2.2"}

poly_coords = None
thalweg_coords = None

for pm in root.findall(".//kml:Placemark", ns):
    name_el = pm.find("kml:name", ns)
    name = name_el.text if name_el is not None else ""
    if "Boundary" in name:
        coords_text = pm.find(".//kml:coordinates", ns).text.strip()
        poly_coords = [[float(c) for c in tok.split(",")[:2]] for tok in coords_text.split() if tok]
    elif "Thalweg" in name:
        coords_text = pm.find(".//kml:coordinates", ns).text.strip()
        thalweg_coords = [[float(c) for c in tok.split(",")[:2]] for tok in coords_text.split() if tok]

river_poly = Polygon(poly_coords)
thalweg_line = LineString(thalweg_coords)

# 3. Local Three.js Coordinate Frame (mirrors projection.js and datasetFromKml.js)
min_lon = min(c[0] for c in poly_coords)
max_lon = max(c[0] for c in poly_coords)
min_lat = min(c[1] for c in poly_coords)
max_lat = max(c[1] for c in poly_coords)
origin_lon = (min_lon + max_lon) / 2.0
origin_lat = (min_lat + max_lat) / 2.0
e0, n0 = lon_lat_to_utm(origin_lon, origin_lat)
flip_x = True

def to_local(e, n):
    x = -(e - e0) if flip_x else (e - e0)
    z = n - n0
    return x, z

def to_utm(x, z):
    e = (-x if flip_x else x) + e0
    n = z + n0
    return e, n

def local_to_lon_lat(x, z):
    e, n = to_utm(x, z)
    return utm_to_lon_lat(e, n)

# 4. Thalweg Centerline Cumulative Chainage
cl_local = []
for lon, lat in thalweg_coords:
    e, n = lon_lat_to_utm(lon, lat)
    x, z = to_local(e, n)
    cl_local.append({"lon": lon, "lat": lat, "easting": e, "northing": n, "x": x, "z": z})

raw_lengths = [0.0]
for i in range(1, len(cl_local)):
    d = math.hypot(cl_local[i]["x"] - cl_local[i-1]["x"], cl_local[i]["z"] - cl_local[i-1]["z"])
    raw_lengths.append(raw_lengths[-1] + d)

total_cl_len = raw_lengths[-1]
n_stations = 480
stations = []
step = total_cl_len / (n_stations - 1)

for s in range(n_stations):
    t_dist = s * step
    idx = 0
    while idx < len(raw_lengths) - 2 and raw_lengths[idx+1] < t_dist:
        idx += 1
    seg_len = raw_lengths[idx+1] - raw_lengths[idx]
    frac = (t_dist - raw_lengths[idx]) / seg_len if seg_len > 0 else 0
    x = cl_local[idx]["x"] + frac * (cl_local[idx+1]["x"] - cl_local[idx]["x"])
    z = cl_local[idx]["z"] + frac * (cl_local[idx+1]["z"] - cl_local[idx]["z"])
    stations.append({"x": x, "z": z, "meters": t_dist})

# 5. Bridge Definitions
MANDOVI_BRIDGES_DEF = [
    {
        "id": "900000001",
        "name": "Atal Setu",
        "bridgeType": "cable-stayed",
        "highway": "trunk",
        "widthM": 22,
        "coords": [
            [73.8328, 15.4998],
            [73.8333, 15.5020],
            [73.8338, 15.5042],
            [73.8345, 15.5068],
        ],
    },
    {
        "id": "900000002",
        "name": "Mandovi Bridge (New)",
        "bridgeType": "girder",
        "highway": "primary",
        "widthM": 14,
        "coords": [
            [73.8310, 15.5004],
            [73.8317, 15.5032],
            [73.8324, 15.5062],
        ],
    },
    {
        "id": "900000003",
        "name": "Mandovi Bridge (Old)",
        "bridgeType": "girder",
        "highway": "primary",
        "widthM": 12,
        "coords": [
            [73.8304, 15.5005],
            [73.8312, 15.5033],
            [73.8319, 15.5061],
        ],
    },
    {
        "id": "900000004",
        "name": "Ribandar Causeway (Ponte Conde de Linhares)",
        "bridgeType": "causeway",
        "highway": "secondary",
        "widthM": 12,
        "coords": [
            [73.8475, 15.5002],
            [73.8540, 15.5025],
            [73.8640, 15.5052],
        ],
    },
    {
        "id": "900000005",
        "name": "Konkan Railway Mandovi Viaduct",
        "bridgeType": "railway",
        "highway": "railway",
        "widthM": 10,
        "coords": [
            [73.8710, 15.5020],
            [73.8714, 15.5065],
            [73.8719, 15.5110],
        ],
    },
]

BRIDGE_DIMENSIONS = {
    "900000001": {
        "lengthM": 620,
        "widthM": 21,
        "spans": {"count": 4, "typicalLengthM": 150},
        "structureType": "Cable-Stayed Box Girder Bridge",
        "source": "Goa State Infrastructure Development Corporation (GSIDC)",
        "confidence": "high",
    },
    "900000002": {
        "lengthM": 590,
        "widthM": 14,
        "spans": {"count": 12, "typicalLengthM": 48},
        "structureType": "Prestressed Concrete Girder Bridge",
        "source": "Public Works Department, Goa",
        "confidence": "high",
    },
    "900000003": {
        "lengthM": 590,
        "widthM": 12,
        "spans": {"count": 12, "typicalLengthM": 48},
        "structureType": "Prestressed Concrete Girder Bridge",
        "source": "Public Works Department, Goa",
        "confidence": "high",
    },
    "900000004": {
        "lengthM": 3200,
        "widthM": 10,
        "structureType": "Historic Masonry Causeway (Ponte Conde de Linhares)",
        "source": "Archaeological Survey of India / Goa Heritage Survey",
        "confidence": "high",
    },
    "900000005": {
        "lengthM": 1319,
        "widthM": 9,
        "spans": {"count": 26, "typicalLengthM": 50},
        "structureType": "Prestressed Concrete Box Girder Viaduct",
        "source": "Konkan Railway Corporation Limited (KRCL)",
        "confidence": "high",
    },
}

BRIDGE_ELEVATIONS = {
    "900000001": {"deckM": 32.5, "soffitM": 28.0, "hfl25M": 3.8, "hfl100M": 4.5, "datum": "Survey of India MSL (Marmagao Datum)", "source": "GSIDC"},
    "900000002": {"deckM": 16.5, "soffitM": 14.5, "hfl25M": 3.8, "hfl100M": 4.5, "datum": "Survey of India MSL (Marmagao Datum)", "source": "PWD Goa"},
    "900000003": {"deckM": 15.5, "soffitM": 13.5, "hfl25M": 3.8, "hfl100M": 4.5, "datum": "Survey of India MSL (Marmagao Datum)", "source": "PWD Goa"},
    "900000004": {"deckM": 5.5, "soffitM": 4.2, "hfl25M": 3.8, "hfl100M": 4.5, "datum": "Survey of India MSL (Marmagao Datum)", "source": "Goa Heritage Survey"},
    "900000005": {"deckM": 20.0, "soffitM": 17.5, "hfl25M": 3.8, "hfl100M": 4.5, "datum": "Survey of India MSL (Marmagao Datum)", "source": "KRCL"},
}

# 6. Audit calculations
audit_results = []

for b in MANDOVI_BRIDGES_DEF:
    b_id = b["id"]
    name = b["name"]
    coords = b["coords"]
    spec = BRIDGE_DIMENSIONS.get(b_id, {})
    elev = BRIDGE_ELEVATIONS.get(b_id, {})

    # Source start and end
    src_start_lon, src_start_lat = coords[0]
    src_end_lon, src_end_lat = coords[-1]
    u0 = lon_lat_to_utm(src_start_lon, src_start_lat)
    u1 = lon_lat_to_utm(src_end_lon, src_end_lat)
    s_x, s_z = to_local(u0[0], u0[1])
    e_x, e_z = to_local(u1[0], u1[1])
    
    # Source polyline length along vertices
    src_polyline_len = 0.0
    vert_locals = []
    for c in coords:
        cu = lon_lat_to_utm(c[0], c[1])
        cx, cz = to_local(cu[0], cu[1])
        vert_locals.append((cx, cz))
    for i in range(1, len(vert_locals)):
        src_polyline_len += math.hypot(vert_locals[i][0] - vert_locals[i-1][0], vert_locals[i][1] - vert_locals[i-1][1])

    # Straight-line distance between source endpoints
    src_endpoint_dist = math.hypot(e_x - s_x, e_z - s_z)
    
    # Midpoint of source endpoints
    mid_x = (s_x + e_x) * 0.5
    mid_z = (s_z + e_z) * 0.5
    mid_lon, mid_lat = local_to_lon_lat(mid_x, mid_z)
    
    ax = (e_x - s_x) / (src_endpoint_dist or 1)
    az = (e_z - s_z) / (src_endpoint_dist or 1)

    # Nearest Station Chainage in application
    best_st = min(stations, key=lambda st: (st["x"] - mid_x)**2 + (st["z"] - mid_z)**2)
    ch_m = best_st["meters"]
    ch_label = f"{int(ch_m // 1000)}+{int(round(ch_m % 1000)):03d}"

    # Rendered 3D Dimensions after applySourcedPlanDimensions()
    rendered_len = spec.get("lengthM", src_endpoint_dist)
    rendered_w = spec.get("widthM", b["widthM"])
    half = rendered_len * 0.5
    rend_s_x = mid_x - ax * half
    rend_s_z = mid_z - az * half
    rend_e_x = mid_x + ax * half
    rend_e_z = mid_z + az * half
    rend_s_lon, rend_s_lat = local_to_lon_lat(rend_s_x, rend_s_z)
    rend_e_lon, rend_e_lat = local_to_lon_lat(rend_e_x, rend_e_z)

    # Riverbank Intersections with river polygon
    # We create a line extended beyond both banks to find exact intersection with river polygon boundary
    line_geom = LineString(coords)
    # Intersect with river polygon
    poly_inter = line_geom.intersection(river_poly)
    
    left_bank_pt = None
    right_bank_pt = None
    river_width_m = None
    
    if not poly_inter.is_empty:
        if poly_inter.geom_type == "LineString":
            inter_coords = list(poly_inter.coords)
            # Find points closest to start and end
            pt0 = inter_coords[0]
            pt1 = inter_coords[-1]
            # Convert to local to get true metric width
            u_pt0 = lon_lat_to_utm(pt0[0], pt0[1])
            u_pt1 = lon_lat_to_utm(pt1[0], pt1[1])
            river_width_m = math.hypot(u_pt1[0] - u_pt0[0], u_pt1[1] - u_pt0[1])
            
            # Identify South (Left) vs North (Right) bank
            # Mandovi flows Westward (towards sea), so South is Left bank, North is Right bank
            if pt0[1] < pt1[1]:
                left_bank_pt = pt0 # South
                right_bank_pt = pt1 # North
            else:
                left_bank_pt = pt1
                right_bank_pt = pt0
        elif poly_inter.geom_type == "MultiLineString":
            # If multiple segments (e.g. crossing sandbars/islands)
            all_pts = []
            for ls in poly_inter.geoms:
                all_pts.extend(list(ls.coords))
            # Sort by latitude
            all_pts.sort(key=lambda p: p[1])
            left_bank_pt = all_pts[0]
            right_bank_pt = all_pts[-1]
            u_pt0 = lon_lat_to_utm(left_bank_pt[0], left_bank_pt[1])
            u_pt1 = lon_lat_to_utm(right_bank_pt[0], right_bank_pt[1])
            river_width_m = math.hypot(u_pt1[0] - u_pt0[0], u_pt1[1] - u_pt0[1])

    # Thalweg Intersection
    thalweg_inter = line_geom.intersection(thalweg_line)
    thalweg_pt = None
    exact_thalweg_chainage = None
    crossing_angle_deg = None
    
    if not thalweg_inter.is_empty:
        if thalweg_inter.geom_type == "Point":
            thalweg_pt = (thalweg_inter.x, thalweg_inter.y)
        elif thalweg_inter.geom_type == "MultiPoint":
            thalweg_pt = (thalweg_inter.geoms[0].x, thalweg_inter.geoms[0].y)
        
        if thalweg_pt:
            # Calculate distance along thalweg line to this point
            exact_thalweg_chainage = thalweg_line.project(Point(thalweg_pt), normalized=False)
            # Note: thalweg_line coordinates are in degrees, let's calculate metric distance along thalweg
            # by accumulating segment lengths up to projection
            th_cum_m = 0.0
            pt_point = Point(thalweg_pt)
            accumulated = 0.0
            for i in range(1, len(cl_local)):
                seg_ls = LineString([(thalweg_coords[i-1][0], thalweg_coords[i-1][1]), (thalweg_coords[i][0], thalweg_coords[i][1])])
                d_seg = math.hypot(cl_local[i]["x"] - cl_local[i-1]["x"], cl_local[i]["z"] - cl_local[i-1]["z"])
                if seg_ls.distance(pt_point) < 1e-5 or seg_ls.intersects(pt_point):
                    proj_frac = seg_ls.project(pt_point, normalized=True)
                    exact_thalweg_chainage = accumulated + proj_frac * d_seg
                    # Calculate flow vector and bridge vector for crossing angle
                    flow_dx = cl_local[i]["x"] - cl_local[i-1]["x"]
                    flow_dz = cl_local[i]["z"] - cl_local[i-1]["z"]
                    flow_len = math.hypot(flow_dx, flow_dz) or 1.0
                    flow_dir = (flow_dx / flow_len, flow_dz / flow_len)
                    
                    dot = flow_dir[0] * ax + flow_dir[1] * az
                    angle_rad = math.acos(max(-1.0, min(1.0, abs(dot))))
                    crossing_angle_deg = 90.0 - math.degrees(angle_rad) # Angle relative to perpendicular (0 = perpendicular)
                    break
                accumulated += d_seg

    # Approach roads
    approach_road_len_m = 36.0 * 2 # 36 m on start bank + 36 m on end bank = 72 m total

    # Elevation & scene height
    deck_y_scene = None
    if name == "Atal Setu":
        deck_y_scene = 24.0 # SURFACE_Y (0) + 24.0 = 24.0
    elif "Mandovi" in name:
        deck_y_scene = 14.0 # SURFACE_Y (0) + 14.0 = 14.0
    elif "Causeway" in name:
        deck_y_scene = 4.8  # SURFACE_Y (0) + 4.8 = 4.8
    elif "Railway" in name:
        deck_y_scene = 16.0 # SURFACE_Y (0) + 16.0 = 16.0

    entry = {
        "id": b_id,
        "name": name,
        "bridgeType": b["bridgeType"],
        "highway": b["highway"],
        "source": b.get("source", spec.get("source", "MANDOVI_SURVEY")),
        "center": {
            "lat": round(mid_lat, 6),
            "lon": round(mid_lon, 6),
            "x": round(mid_x, 2),
            "z": round(mid_z, 2)
        },
        "source_coordinates": {
            "start": {"lat": round(src_start_lat, 6), "lon": round(src_start_lon, 6), "x": round(s_x, 2), "z": round(s_z, 2)},
            "end": {"lat": round(src_end_lat, 6), "lon": round(src_end_lon, 6), "x": round(e_x, 2), "z": round(e_z, 2)},
            "vertices": [{"lat": round(c[1], 6), "lon": round(c[0], 6)} for c in coords],
            "straight_length_m": round(src_endpoint_dist, 2),
            "polyline_length_m": round(src_polyline_len, 2)
        },
        "rendered_3d_model": {
            "start": {"lat": round(rend_s_lat, 6), "lon": round(rend_s_lon, 6), "x": round(rend_s_x, 2), "z": round(rend_s_z, 2)},
            "end": {"lat": round(rend_e_lat, 6), "lon": round(rend_e_lon, 6), "x": round(rend_e_x, 2), "z": round(rend_e_z, 2)},
            "length_m": round(rendered_len, 2),
            "width_m": round(rendered_w, 2),
            "deck_y_scene": deck_y_scene,
            "approach_road_length_m": approach_road_len_m
        },
        "river_crossing": {
            "intersects_river_polygon": not poly_inter.is_empty,
            "intersects_thalweg": not thalweg_inter.is_empty,
            "river_width_at_crossing_m": round(river_width_m, 2) if river_width_m else None,
            "left_bank": {"lat": round(left_bank_pt[1], 6), "lon": round(left_bank_pt[0], 6)} if left_bank_pt else None,
            "right_bank": {"lat": round(right_bank_pt[1], 6), "lon": round(right_bank_pt[0], 6)} if right_bank_pt else None,
            "thalweg_intersection": {"lat": round(thalweg_pt[1], 6), "lon": round(thalweg_pt[0], 6)} if thalweg_pt else None,
            "thalweg_chainage_m": round(exact_thalweg_chainage, 1) if exact_thalweg_chainage else None,
            "nearest_station_chainage_m": round(ch_m, 1),
            "chainage_label": ch_label,
            "crossing_angle_deg": round(crossing_angle_deg, 2) if crossing_angle_deg is not None else None,
            "connects_both_banks": bool(rendered_len >= (river_width_m or 0))
        },
        "engineering_specs": {
            "source_length_m": spec.get("lengthM"),
            "source_width_m": spec.get("widthM"),
            "structure_type": spec.get("structureType"),
            "spans_count": spec.get("spans", {}).get("count") if spec.get("spans") else None,
            "typical_span_m": spec.get("spans", {}).get("typicalLengthM") if spec.get("spans") else None,
            "piers_count": (spec.get("spans", {}).get("count") - 1) if (spec.get("spans") and spec.get("spans", {}).get("count")) else None,
            "deck_elevation_msl": elev.get("deckM"),
            "soffit_elevation_msl": elev.get("soffitM"),
            "datum": elev.get("datum"),
            "authority_source": spec.get("source") or elev.get("source")
        }
    }
    audit_results.append(entry)

print(json.dumps(audit_results, indent=2))
