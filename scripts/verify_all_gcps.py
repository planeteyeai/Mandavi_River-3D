import json
import xml.etree.ElementTree as ET
from PIL import Image
import numpy as np

print("=== GROUND CONTROL POINTS (GCP) MULTI-LAYER VERIFICATION ===")

gcps = [
    {
        "id": "GCP-1",
        "name": "Atal Setu (Cable-Stayed Bridge)",
        "lon": 73.83360,
        "lat": 15.50320,
        "expected_feature": "Bridge crossing Mandovi River between Panaji & Porvorim",
    },
    {
        "id": "GCP-2",
        "name": "Mandovi Bridge (Old)",
        "lon": 73.83115,
        "lat": 15.50330,
        "expected_feature": "Historic road bridge crossing Mandovi River",
    },
    {
        "id": "GCP-3",
        "name": "Ribandar Causeway (Ponte Conde de Linhares)",
        "lon": 73.85400,
        "lat": 15.50250,
        "expected_feature": "Historic causeway across river arm linking Panaji & Ribandar",
    },
    {
        "id": "GCP-4",
        "name": "Fort Aguada Lighthouse & Bastion",
        "lon": 73.77350,
        "lat": 15.49250,
        "expected_feature": "Portuguese fort at northern entrance to Mandovi Bay",
    },
    {
        "id": "GCP-5",
        "name": "Cabo Raj Bhavan Headland (Dona Paula)",
        "lon": 73.78740,
        "lat": 15.46050,
        "expected_feature": "Southern headland of Mandovi Estuary",
    },
]

# 1. Satellite Imagery Bounds & Resolution
sat_path = "public/data/mandovi/satellite_imagery.jpg"
im = Image.open(sat_path)
W, H = im.size
west, east, south, north = 73.76, 73.89, 15.45, 15.53
print(f"1. Satellite Imagery ({W} x {H}, bounds: [{west}, {east}, {south}, {north}]):")
for g in gcps:
    u = (g["lon"] - west) / (east - west)
    v = (g["lat"] - south) / (north - south)
    px = int(round(u * W))
    py = int(round((1.0 - v) * H))
    print(f"   {g['id']} {g['name']:36s}: UV=({u:.4f}, {v:.4f}) -> Pixel=({px:4d}, {py:4d})")

# 2. DTM Elevation at GCPs
print(f"\n2. GeoTIFF DTM Elevation at GCPs:")
dtm_im = Image.open("public/data/mandovi/fabdem_dtm.tif")
dtm_w, dtm_h = dtm_im.size
dtm_arr = np.array(dtm_im)
for g in gcps:
    u = (g["lon"] - west) / (east - west)
    v = (g["lat"] - south) / (north - south)
    col = int(round(u * (dtm_w - 1)))
    row = int(round((1.0 - v) * (dtm_h - 1)))
    elev = dtm_arr[row, col]
    print(f"   {g['id']} {g['name']:36s}: DTM pixel=({col:4d}, {row:4d}) -> Elevation = {elev:5.1f} m")

# 3. KML River Polygon & Centerline proximity
print(f"\n3. KML River Boundary & Centerline Distance to GCPs:")
tree = ET.parse("public/data/Mandavi River Kml.kml")
root = tree.getroot()
for g in gcps:
    min_dist_poly = float("inf")
    for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
        name_tag = pm.find("{http://www.opengis.net/kml/2.2}name")
        pm_name = name_tag.text if name_tag is not None else ""
        c_tag = pm.find(".//{http://www.opengis.net/kml/2.2}coordinates")
        if c_tag is not None and c_tag.text:
            for pt in c_tag.text.strip().split():
                parts = [float(x) for x in pt.split(",") if x]
                if len(parts) >= 2:
                    d_lon = (parts[0] - g["lon"]) * 107269
                    d_lat = (parts[1] - g["lat"]) * 111320
                    dist = np.hypot(d_lon, d_lat)
                    if dist < min_dist_poly:
                        min_dist_poly = dist
    print(f"   {g['id']} {g['name']:36s}: Nearest KML water vertex = {min_dist_poly:5.1f} m")

# 4. OSM Road & Bridge alignment
print(f"\n4. OSM Road & Bridge alignment at GCPs:")
with open("public/data/mandovi/osm_mandovi_corridor.json") as f:
    osm = json.load(f)
for g in gcps:
    min_dist_osm = float("inf")
    matched_name = ""
    for r in osm.get("roads", []) + osm.get("bridges", []):
        for pt in r.get("coordinates", []):
            d_lon = (pt[0] - g["lon"]) * 107269
            d_lat = (pt[1] - g["lat"]) * 111320
            dist = np.hypot(d_lon, d_lat)
            if dist < min_dist_osm:
                min_dist_osm = dist
                matched_name = r.get("name") or r.get("highway")
    print(f"   {g['id']} {g['name']:36s}: Nearest OSM road/bridge ({matched_name}) = {min_dist_osm:5.1f} m")
