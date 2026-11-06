import json
import math
import pyproj

wgs84 = pyproj.CRS("EPSG:4326")
utm43 = pyproj.CRS("EPSG:32643")
to_utm = pyproj.Transformer.from_crs(wgs84, utm43, always_xy=True).transform

with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

bridges_osm = {str(b['id']): b for b in osm.get('bridges', [])}

c1 = bridges_osm['658699077']['coordinates'] # North to South (Porvorim to Merces)
print(f"Atal Setu Carriageway 1: {len(c1)} vertices")

cum_dist = 0.0
for i in range(len(c1)):
    if i > 0:
        p1 = to_utm(c1[i-1][0], c1[i-1][1])
        p2 = to_utm(c1[i][0], c1[i][1])
        d = math.hypot(p2[0]-p1[0], p2[1]-p1[1])
        cum_dist += d
    print(f"  [{i:2d}]: lon={c1[i][0]:.7f}, lat={c1[i][1]:.7f} | cum_dist={cum_dist:7.1f}m")
