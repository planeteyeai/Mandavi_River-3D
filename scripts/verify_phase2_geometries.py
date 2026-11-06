import math
import json
import xml.etree.ElementTree as ET
import pyproj
from shapely.geometry import Point, LineString, Polygon

wgs84 = pyproj.CRS("EPSG:4326")
utm43 = pyproj.CRS("EPSG:32643")
to_utm = pyproj.Transformer.from_crs(wgs84, utm43, always_xy=True).transform
to_wgs84 = pyproj.Transformer.from_crs(utm43, wgs84, always_xy=True).transform

# River polygon and thalweg
tree = ET.parse('public/data/mandovi/mandovi_river.kml')
root = tree.getroot()
ns = {'kml': 'http://www.opengis.net/kml/2.2'}

for pm in root.findall('.//kml:Placemark', ns):
    name = pm.find('kml:name', ns).text
    if 'Boundary' in name:
        coords_text = pm.find('.//kml:coordinates', ns).text.strip()
        poly_coords = [[float(c) for c in tok.split(',')[:2]] for tok in coords_text.split() if tok]
    elif 'Thalweg' in name:
        coords_text = pm.find('.//kml:coordinates', ns).text.strip()
        thalweg_coords = [[float(c) for c in tok.split(',')[:2]] for tok in coords_text.split() if tok]

river_poly = Polygon(poly_coords)
thalweg_line = LineString(thalweg_coords)

origin_lon = (min(c[0] for c in poly_coords) + max(c[0] for c in poly_coords)) / 2.0
origin_lat = (min(c[1] for c in poly_coords) + max(c[1] for c in poly_coords)) / 2.0
e0, n0 = to_utm(origin_lon, origin_lat)
flip_x = True

def to_local(e, n):
    x = -(e - e0) if flip_x else (e - e0)
    z = n - n0
    return x, z

def to_coords(x, z):
    e = (-x if flip_x else x) + e0
    n = z + n0
    return to_wgs84(e, n)

# Compute cumulative chainage along thalweg
cl_local = []
for lon, lat in thalweg_coords:
    e, n = to_utm(lon, lat)
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

print(f"Loaded thalweg centerline: total length = {total_cl_len:.1f} m, {len(stations)} stations")

# Load assembled Linhares chain
with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)
road_map = {str(r['id']): r for r in osm.get('roads', [])}
chain_ids = ['1203153949', '1203153948', '44016381', '837098424', '40130468', '40190556']
linhares_coords = []
for rid in chain_ids:
    r = road_map[rid]
    c = list(r['coordinates'])
    if not linhares_coords:
        linhares_coords.extend(c)
    else:
        d_normal = math.hypot(c[0][0] - linhares_coords[-1][0], c[0][1] - linhares_coords[-1][1])
        d_reversed = math.hypot(c[-1][0] - linhares_coords[-1][0], c[-1][1] - linhares_coords[-1][1])
        if d_reversed < d_normal:
            c = c[::-1]
        linhares_coords.extend(c[1:])

# New curated bridge definitions for Phase 2
PHASE2_BRIDGES_DEF = [
    {
        "id": "900000001",
        "name": "Atal Setu",
        "bridgeType": "cable-stayed",
        "highway": "trunk",
        "widthM": 21,
        "lengthM": 620,
        "structureType": "Cable-Stayed Box Girder Bridge",
        "source": "Goa State Infrastructure Development Corporation (GSIDC) / L&T",
        "coords": [
            [73.837180, 15.500000],
            [73.836931, 15.502609],
            [73.836756, 15.504429],
            [73.836620, 15.505580],
        ],
        "approachViaducts": {
            "southLandViaduct": [
                [73.837558, 15.496525],
                [73.837439, 15.497062],
                [73.837280, 15.498980],
                [73.837180, 15.500000]
            ],
            "northLandViaduct": [
                [73.836620, 15.505580],
                [73.836548, 15.506238],
                [73.836330, 15.507480],
                [73.835971, 15.508938],
                [73.835553, 15.510128],
                [73.835082, 15.515026]
            ]
        }
    },
    {
        "id": "900000002",
        "name": "Mandovi Bridge (New)",
        "bridgeType": "girder",
        "highway": "primary",
        "widthM": 14,
        "lengthM": 600,
        "structureType": "Prestressed Concrete Girder Bridge (Northbound)",
        "source": "Public Works Department (PWD) Goa",
        "coords": [
            [73.837419, 15.499929],
            [73.837250, 15.501486],
            [73.837095, 15.503001],
            [73.836947, 15.504449],
            [73.836788, 15.505887],
            [73.836766, 15.506126]
        ]
    },
    {
        "id": "900000003",
        "name": "Mandovi Bridge (Old)",
        "bridgeType": "girder",
        "highway": "primary",
        "widthM": 12,
        "lengthM": 600,
        "structureType": "Prestressed Concrete Girder Bridge (Southbound)",
        "source": "Public Works Department (PWD) Goa",
        "coords": [
            [73.836845, 15.499959],
            [73.836656, 15.501830],
            [73.836488, 15.503326],
            [73.836340, 15.504773],
            [73.836239, 15.505734]
        ]
    },
    {
        "id": "900000004",
        "name": "Ribandar Causeway (Ponte Conde de Linhares)",
        "bridgeType": "causeway",
        "highway": "secondary",
        "widthM": 10,
        "lengthM": 3141,
        "structureType": "Historic Stone Masonry Causeway with Arched Culverts",
        "source": "Archaeological Survey of India / Goa Tourism / Goa Heritage Survey",
        "coords": linhares_coords
    },
    {
        "id": "900000005",
        "name": "Konkan Railway Mandovi Viaduct",
        "bridgeType": "railway",
        "highway": "railway",
        "widthM": 9,
        "lengthM": 946,
        "structureType": "Prestressed Concrete Viaduct with 124.2m Navigational Steel Through-Girder Span",
        "source": "Konkan Railway Corporation Limited (KRCL)",
        "coords": [
            [73.870850, 15.502450],
            [73.871150, 15.504800],
            [73.871500, 15.507600],
            [73.871900, 15.510950]
        ]
    }
]

for b in PHASE2_BRIDGES_DEF:
    coords = b["coords"]
    ls = LineString(coords)
    
    # Calculate polyline length
    poly_len_m = 0.0
    for i in range(1, len(coords)):
        e1, n1 = to_utm(coords[i-1][0], coords[i-1][1])
        e2, n2 = to_utm(coords[i][0], coords[i][1])
        poly_len_m += math.hypot(e2 - e1, n2 - n1)
        
    e_s, n_s = to_utm(coords[0][0], coords[0][1])
    e_e, n_e = to_utm(coords[-1][0], coords[-1][1])
    straight_len_m = math.hypot(e_e - e_s, n_e - n_s)
    
    # River intersection
    poly_inter = ls.intersection(river_poly)
    river_w_m = 0.0
    if not poly_inter.is_empty:
        if poly_inter.geom_type == "LineString":
            p_s = to_utm(poly_inter.coords[0][0], poly_inter.coords[0][1])
            p_e = to_utm(poly_inter.coords[-1][0], poly_inter.coords[-1][1])
            river_w_m = math.hypot(p_e[0] - p_s[0], p_e[1] - p_s[1])
        elif poly_inter.geom_type == "MultiLineString":
            pts = []
            for sub in poly_inter.geoms:
                pts.extend(list(sub.coords))
            pts.sort(key=lambda p: p[1])
            p_s = to_utm(pts[0][0], pts[0][1])
            p_e = to_utm(pts[-1][0], pts[-1][1])
            river_w_m = math.hypot(p_e[0] - p_s[0], p_e[1] - p_s[1])
            
    # Thalweg intersection
    th_inter = ls.intersection(thalweg_line)
    th_pt = None
    th_chainage = None
    if not th_inter.is_empty:
        if th_inter.geom_type == "Point":
            th_pt = (th_inter.x, th_inter.y)
        elif th_inter.geom_type == "MultiPoint":
            th_pt = (th_inter.geoms[0].x, th_inter.geoms[0].y)
            
        if th_pt:
            pt_point = Point(th_pt)
            accumulated = 0.0
            for i in range(1, len(cl_local)):
                seg_ls = LineString([(thalweg_coords[i-1][0], thalweg_coords[i-1][1]), (thalweg_coords[i][0], thalweg_coords[i][1])])
                d_seg = math.hypot(cl_local[i]["x"] - cl_local[i-1]["x"], cl_local[i]["z"] - cl_local[i-1]["z"])
                if seg_ls.distance(pt_point) < 1e-5 or seg_ls.intersects(pt_point):
                    proj_frac = seg_ls.project(pt_point, normalized=True)
                    th_chainage = accumulated + proj_frac * d_seg
                    break
                accumulated += d_seg
                
    # Centerpoint
    mid_lon = (coords[0][0] + coords[-1][0]) * 0.5
    mid_lat = (coords[0][1] + coords[-1][1]) * 0.5
    mid_e, mid_n = to_utm(mid_lon, mid_lat)
    mid_x, mid_z = to_local(mid_e, mid_n)
    best_st = min(stations, key=lambda st: (st["x"] - mid_x)**2 + (st["z"] - mid_z)**2)
    ch_label = f"{int(best_st['meters'] // 1000)}+{int(round(best_st['meters'] % 1000)):03d}"
    
    print(f"\n=== {b['name']} (ID: {b['id']}) ===")
    print(f"  Start: [{coords[0][0]:.6f}, {coords[0][1]:.6f}], End: [{coords[-1][0]:.6f}, {coords[-1][1]:.6f}]")
    print(f"  Polyline Length: {poly_len_m:.1f} m | Straight Length: {straight_len_m:.1f} m | Configured Length: {b['lengthM']} m")
    print(f"  River Channel Width at Crossing: {river_w_m:.1f} m")
    print(f"  Connects Both Banks: {poly_len_m >= river_w_m} (Margin: +{poly_len_m - river_w_m:.1f} m)")
    if th_pt:
        print(f"  Thalweg Intersection: [{th_pt[0]:.6f}, {th_pt[1]:.6f}] at Ch {th_chainage:.1f} m (Nearest Station: {ch_label})")
    else:
        print(f"  Thalweg Intersection: NONE (Runs along bank/marsh, nearest station: {ch_label})")
