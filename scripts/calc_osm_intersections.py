import math
import json
import xml.etree.ElementTree as ET
from shapely.geometry import Point, LineString, Polygon
import pyproj

wgs84 = pyproj.CRS("EPSG:4326")
utm43 = pyproj.CRS("EPSG:32643")
to_utm = pyproj.Transformer.from_crs(wgs84, utm43, always_xy=True).transform

# 1. River boundary
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

# 2. OSM bridges
with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

bridges_osm = {str(b['id']): b for b in osm.get('bridges', [])}

# Atal Setu (use centerline of both carriageways: 658699077 & 837098406)
c1 = bridges_osm['658699077']['coordinates']
c2 = bridges_osm['837098406']['coordinates']
ls1 = LineString(c1)
ls2 = LineString(c2)

print("Atal Setu OSM C1 points:", len(c1), "C2 points:", len(c2))
# Intersection with river polygon
inter1 = ls1.intersection(river_poly)
inter2 = ls2.intersection(river_poly)
print("Atal Setu river intersection C1 length deg:", inter1.length)
print("  C1 river start (South):", inter1.coords[0], "end (North):", inter1.coords[-1])
print("  C2 river start (South):", inter2.coords[0], "end (North):", inter2.coords[-1])

# Metric length of river crossing portion
u_s = to_utm(inter1.coords[0][0], inter1.coords[0][1])
u_e = to_utm(inter1.coords[-1][0], inter1.coords[-1][1])
print(f"Atal Setu river crossing water span: {math.hypot(u_e[0]-u_s[0], u_e[1]-u_s[1]):.2f} m")

# Mandovi Bridge New (85192605)
mb_new_c = bridges_osm['85192605']['coordinates']
ls_new = LineString(mb_new_c)
inter_new = ls_new.intersection(river_poly)
print("\nNew Mandovi Bridge OSM points:", len(mb_new_c))
print("  All OSM coords:", mb_new_c)
print("  River intersection:", inter_new.coords[0], "to", inter_new.coords[-1])
u_s = to_utm(inter_new.coords[0][0], inter_new.coords[0][1])
u_e = to_utm(inter_new.coords[-1][0], inter_new.coords[-1][1])
print(f"  River crossing water span: {math.hypot(u_e[0]-u_s[0], u_e[1]-u_s[1]):.2f} m")
total_new_m = 0
for i in range(1, len(mb_new_c)):
    p1 = to_utm(mb_new_c[i-1][0], mb_new_c[i-1][1])
    p2 = to_utm(mb_new_c[i][0], mb_new_c[i][1])
    total_new_m += math.hypot(p2[0]-p1[0], p2[1]-p1[1])
print(f"  Total bridge polyline length: {total_new_m:.2f} m")

# Mandovi Bridge Old (156468722)
mb_old_c = bridges_osm['156468722']['coordinates']
ls_old = LineString(mb_old_c)
inter_old = ls_old.intersection(river_poly)
print("\nOld Mandovi Bridge OSM points:", len(mb_old_c))
print("  All OSM coords:", mb_old_c)
print("  River intersection:", inter_old.coords[0], "to", inter_old.coords[-1])
u_s = to_utm(inter_old.coords[0][0], inter_old.coords[0][1])
u_e = to_utm(inter_old.coords[-1][0], inter_old.coords[-1][1])
print(f"  River crossing water span: {math.hypot(u_e[0]-u_s[0], u_e[1]-u_s[1]):.2f} m")
total_old_m = 0
for i in range(1, len(mb_old_c)):
    p1 = to_utm(mb_old_c[i-1][0], mb_old_c[i-1][1])
    p2 = to_utm(mb_old_c[i][0], mb_old_c[i][1])
    total_old_m += math.hypot(p2[0]-p1[0], p2[1]-p1[1])
print(f"  Total bridge polyline length: {total_old_m:.2f} m")
