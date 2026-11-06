import json

with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

target_ids = ['85192605', '156468722', '658699077', '837098406']

for b in osm.get('bridges', []):
    bid = str(b.get('id'))
    if bid in target_ids:
        print(f"\n=== BRIDGE {bid} ({b.get('name', 'unnamed')}) ===")
        print("Highway:", b.get('highway'))
        coords = b.get('coordinates', [])
        print("Point count:", len(coords))
        for i, c in enumerate(coords):
            print(f"  [{i}]: lon={c[0]:.7f}, lat={c[1]:.7f}")
