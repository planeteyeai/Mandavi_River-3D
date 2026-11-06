import json
import os
import glob
import xml.etree.ElementTree as ET
from PIL import Image

print("=== MANDAVI RIVER GEOSPATIAL AUDIT ===")

# 1. KML Files
for kml_file in glob.glob("public/data/**/*.kml", recursive=True):
    try:
        root = ET.parse(kml_file).getroot()
        ns = {"kml": "http://www.opengis.net/kml/2.2"}
        coords = []
        for elem in root.findall(".//kml:coordinates", ns):
            txt = elem.text.strip() if elem.text else ""
            for pt in txt.split():
                parts = [float(x) for x in pt.split(",") if x]
                if len(parts) >= 2:
                    coords.append(parts[:2])
        if not coords:
            for elem in root.iter():
                if elem.tag.endswith("coordinates") and elem.text:
                    for pt in elem.text.strip().split():
                        parts = [float(x) for x in pt.split(",") if x]
                        if len(parts) >= 2:
                            coords.append(parts[:2])
        if coords:
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            print(f"KML: {kml_file}")
            print(f"  Count: {len(coords)}")
            print(f"  Lon: [{min(lons):.6f}, {max(lons):.6f}]")
            print(f"  Lat: [{min(lats):.6f}, {max(lats):.6f}]")
            # Check coordinate order sanity: in India, Lon is ~73-74, Lat is ~15-16
            if min(lons) > 10 and max(lons) < 20 and min(lats) > 70 and max(lats) < 80:
                print("  WARNING: SWAPPED COORD ORDER DETECTED! (Lat, Lon instead of Lon, Lat)")
            elif min(lons) > 70 and max(lons) < 80 and min(lats) > 10 and max(lats) < 20:
                print("  STATUS: Correct coordinate order [Lon, Lat]")
    except Exception as e:
        print(f"KML Error {kml_file}: {e}")

# 2. GeoJSON Files
for gj_file in glob.glob("public/data/**/*.geojson", recursive=True):
    try:
        with open(gj_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        features = data.get("features", [])
        print(f"\nGeoJSON: {gj_file} (features={len(features)})")
        coords = []
        def extract_coords(c):
            if isinstance(c, list):
                if len(c) >= 2 and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float)):
                    coords.append(c[:2])
                else:
                    for sub in c:
                        extract_coords(sub)
        for feat in features:
            geom = feat.get("geometry", {})
            extract_coords(geom.get("coordinates", []))
        if coords:
            lons = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            print(f"  Sample count: {len(coords)}")
            print(f"  Lon: [{min(lons):.6f}, {max(lons):.6f}]")
            print(f"  Lat: [{min(lats):.6f}, {max(lats):.6f}]")
            if min(lons) > 10 and max(lons) < 20 and min(lats) > 70 and max(lats) < 80:
                print("  WARNING: SWAPPED COORD ORDER! [Lat, Lon] instead of [Lon, Lat]")
            elif min(lons) > 70 and max(lons) < 80 and min(lats) > 10 and max(lats) < 20:
                print("  STATUS: Correct coordinate order [Lon, Lat]")
    except Exception as e:
        print(f"GeoJSON Error {gj_file}: {e}")

# 3. OSM JSON
for osm_file in ["public/data/mandovi/osm_mandovi_corridor.json"]:
    if os.path.exists(osm_file):
        try:
            with open(osm_file, "r", encoding="utf-8") as f:
                osm = json.load(f)
            elements = osm.get("elements", [])
            nodes = [e for e in elements if e.get("type") == "node"]
            ways = [e for e in elements if e.get("type") == "way"]
            print(f"\nOSM JSON: {osm_file}")
            print(f"  Elements: {len(elements)} (nodes: {len(nodes)}, ways: {len(ways)})")
            if nodes:
                lons = [n["lon"] for n in nodes if "lon" in n]
                lats = [n["lat"] for n in nodes if "lat" in n]
                print(f"  Nodes Lon: [{min(lons):.6f}, {max(lons):.6f}]")
                print(f"  Nodes Lat: [{min(lats):.6f}, {max(lats):.6f}]")
        except Exception as e:
            print(f"OSM Error {osm_file}: {e}")

# 4. Satellite imagery
sat_file = "public/data/mandovi/satellite_imagery.jpg"
if os.path.exists(sat_file):
    try:
        im = Image.open(sat_file)
        print(f"\nSatellite image: {sat_file}")
        print(f"  Dimensions: {im.size} (width={im.size[0]}, height={im.size[1]})")
        print(f"  Aspect ratio: {im.size[0]/im.size[1]:.4f}")
        exif = im.getexif()
        print(f"  EXIF tags count: {len(exif)}")
    except Exception as e:
        print(f"Sat Error {sat_file}: {e}")

# 5. GeoTIFF DTM
tif_file = "public/data/mandovi/fabdem_dtm.tif"
if os.path.exists(tif_file):
    print(f"\nGeoTIFF: {tif_file}")
    try:
        im = Image.open(tif_file)
        print(f"  TIF Dimensions: {im.size}, mode: {im.mode}")
        # Check TIFF tags
        for tag_id, val in im.tag_v2.items():
            print(f"    Tag {tag_id}: {val}")
    except Exception as e:
        print(f"  TIF inspection: {e}")
