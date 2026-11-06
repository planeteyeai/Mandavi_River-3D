import json

with open('public/data/mandovi/osm_mandovi_corridor.json') as f:
    osm = json.load(f)

for b in osm.get('buildings', []):
    coords = b.get('coordinates', [])
    if coords:
        lon, lat = coords[0]
        if 73.814 < lon < 73.818 and 15.488 < lat < 15.493:
            print(f"Building {b.get('name')}: ({lon:.5f}, {lat:.5f})")

for lu in osm.get('landuse', []):
    coords = lu.get('coordinates', [])
    if coords:
        lon, lat = coords[0]
        if 73.814 < lon < 73.818 and 15.488 < lat < 15.493:
            print(f"Landuse/Leisure {lu.get('name')}: ({lon:.5f}, {lat:.5f}) leisure={lu.get('leisure')}")
