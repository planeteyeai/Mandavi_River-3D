import json

with open("public/data/mandovi/osm_mandovi_corridor.json") as f:
    osm = json.load(f)

print(f"Total bridges in OSM: {len(osm.get('bridges', []))}")
for b in osm.get("bridges", []):
    name = b.get("name", "")
    coords = b.get("coordinates", [])
    if coords:
        c0 = coords[0]
        c_mid = coords[len(coords)//2]
        print(f"Bridge '{name}': mid=({c_mid[0]:.5f}, {c_mid[1]:.5f})")

print("\nNamed roads near West (Lon < 73.80):")
for r in osm.get("roads", []):
    name = r.get("name", "")
    coords = r.get("coordinates", [])
    if name and coords:
        c0 = coords[0]
        if c0[0] < 73.79:
            print(f"Road '{name}': start=({c0[0]:.5f}, {c0[1]:.5f})")
