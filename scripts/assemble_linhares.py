import math
import pyproj

wgs84 = pyproj.CRS("EPSG:4326")
utm43 = pyproj.CRS("EPSG:32643")
transformer = pyproj.Transformer.from_crs(wgs84, utm43, always_xy=True)

import json
with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

# Segments in order from West (Patto) to East (Ribandar):
# 1203153949 (4 pts)
# 1203153948 (2 pts)
# 44016381 (9 pts)
# 837098424 (4 pts)
# 40130468 (9 pts, reverse)
# 40190556 (16 pts, reverse)

road_map = {str(r['id']): r for r in osm.get('roads', [])}

chain_ids = ['1203153949', '1203153948', '44016381', '837098424', '40130468', '40190556']
full_coords = []

for rid in chain_ids:
    r = road_map[rid]
    c = list(r['coordinates'])
    if not full_coords:
        full_coords.extend(c)
    else:
        # Check orientation
        d_normal = math.hypot(c[0][0] - full_coords[-1][0], c[0][1] - full_coords[-1][1])
        d_reversed = math.hypot(c[-1][0] - full_coords[-1][0], c[-1][1] - full_coords[-1][1])
        if d_reversed < d_normal:
            c = c[::-1]
        # Append omitting duplicate start point
        full_coords.extend(c[1:])

print(f"Ponte de Linhares assembled chain: {len(full_coords)} vertices")
print(f"  Start (Patto Plaza): lon={full_coords[0][0]:.6f}, lat={full_coords[0][1]:.6f}")
print(f"  End (Ribandar Town):  lon={full_coords[-1][0]:.6f}, lat={full_coords[-1][1]:.6f}")

# Compute metric length
total_m = 0.0
for i in range(1, len(full_coords)):
    e1, n1 = transformer.transform(full_coords[i-1][0], full_coords[i-1][1])
    e2, n2 = transformer.transform(full_coords[i][0], full_coords[i][1])
    total_m += math.hypot(e2 - e1, n2 - n1)

print(f"Total surveyed polyline length: {total_m:.2f} metres (~{total_m/1000:.2f} km)")
