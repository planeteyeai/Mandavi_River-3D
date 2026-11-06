import json

with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

print("Checking all roads with railway or rail in any attribute:")
for r in osm.get('roads', []):
    hw = r.get('highway') or ''
    name = r.get('name') or ''
    if 'rail' in hw.lower() or 'rail' in name.lower() or r.get('railway'):
        print("Railway road:", r.get('id'), name, hw, r.get('railway'))

# Check all roads with lon around 73.868 to 73.875
print("\nChecking all roads with lon between 73.868 and 73.874 crossing river (lat 15.502 to 15.510):")
for r in osm.get('roads', []):
    coords = r.get('coordinates', [])
    if coords and any(73.868 <= c[0] <= 73.875 and 15.502 <= c[1] <= 15.510 for c in coords):
        print("Road in railway zone:", r.get('id'), "name:", r.get('name'), "hw:", r.get('highway'), "pts:", len(coords), "coords:", coords[:3])
