import json

with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

print("=== CONNECTING ROADS ON NORTH BANK (Porvorim / Betim) ===")
for r in osm.get('roads', []):
    name = r.get('name') or ''
    coords = r.get('coordinates', [])
    if any(73.835 <= c[0] <= 73.838 and 15.505 <= c[1] <= 15.508 for c in coords):
        print("North road", r.get('id'), "name:", name, "hw:", r.get('highway'), "pts:", len(coords))

print("\n=== CONNECTING ROADS ON SOUTH BANK (Panaji) ===")
for r in osm.get('roads', []):
    name = r.get('name') or ''
    coords = r.get('coordinates', [])
    if any(73.835 <= c[0] <= 73.838 and 15.497 <= c[1] <= 15.499 for c in coords):
        print("South road", r.get('id'), "name:", name, "hw:", r.get('highway'), "pts:", len(coords))
