import json
import xml.etree.ElementTree as ET
from PIL import Image

print("=== CHECKING COORDINATES OF KEY MANDAVI LANDMARKS ACROSS ALL LAYERS ===")

# Control Point 1: Atal Setu / Mandovi Bridge area
# Expected: Lon ~ 73.833, Lat ~ 15.503

# 1. KML Centerline & Polygon
kml_path = "public/data/Mandavi River Kml.kml"
tree = ET.parse(kml_path)
root = tree.getroot()
for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
    name = pm.find("{http://www.opengis.net/kml/2.2}name")
    n_txt = name.text if name is not None else ""
    coords_elem = pm.find(".//{http://www.opengis.net/kml/2.2}coordinates")
    if coords_elem is not None and coords_elem.text:
        pts = []
        for p in coords_elem.text.strip().split():
            parts = [float(x) for x in p.split(",") if x]
            if len(parts) >= 2:
                pts.append(parts[:2])
        # Find points near Atal Setu (Lon ~ 73.833)
        near_atal = [p for p in pts if abs(p[0] - 73.833) < 0.005]
        print(f"KML '{n_txt}': total pts={len(pts)}, near Atal Setu (lon~73.833): count={len(near_atal)}")
        if near_atal:
            print(f"   Sample near Atal Setu: {near_atal[:3]}")

# 2. Bridges GeoJSON & Curated Definitions
br_path = "public/data/mandovi/bridges.geojson"
with open(br_path) as f:
    br = json.load(f)
print("\nBridges GeoJSON:")
for feat in br.get("features", []):
    name = feat.get("properties", {}).get("name")
    c = feat.get("geometry", {}).get("coordinates")
    print(f"  {name}: {c}")

# 3. OSM Roads & Bridges in osm_mandovi_corridor.json
with open("public/data/mandovi/osm_mandovi_corridor.json") as f:
    osm = json.load(f)
print("\nOSM Mandovi Corridor:")
atal_roads = [r for r in osm.get("roads", []) if "atal" in r.get("name", "").lower() or "mandovi" in r.get("name", "").lower()]
print(f"  Named Atal/Mandovi roads in OSM: {len(atal_roads)}")
for r in atal_roads[:4]:
    print(f"    Road '{r.get('name')}': coords={r.get('coordinates')[:2]}")

atal_bridges = [b for b in osm.get("bridges", []) if "atal" in b.get("name", "").lower() or "mandovi" in b.get("name", "").lower()]
print(f"  Named Atal/Mandovi bridges in OSM: {len(atal_bridges)}")
for b in atal_bridges[:4]:
    print(f"    Bridge '{b.get('name')}': coords={b.get('coordinates')[:2]}")

# 4. Satellite image bounds & pixel mapping
# West=73.76, East=73.89, South=15.45, North=15.53
# Image size: 1404 x 864
# For Atal Setu (73.8335, 15.5030):
# u = (73.8335 - 73.76) / (73.89 - 73.76) = 0.0735 / 0.13 = 0.5654
# pixel X = 0.5654 * 1404 = 794
# v = (15.5030 - 15.45) / (15.53 - 15.45) = 0.053 / 0.08 = 0.6625
# In image coordinates (top is North = 15.53, bottom is South = 15.45):
# pixel Y from top = (1.0 - 0.6625) * 864 = 292
print(f"\nSatellite pixel for Atal Setu (73.8335, 15.5030): X={794}, Y={292}")
