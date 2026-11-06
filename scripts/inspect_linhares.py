import json

with open('public/data/mandovi/osm_mandovi_corridor.json', 'r', encoding='utf-8') as f:
    osm = json.load(f)

linhares_roads = []
for r in osm.get('roads', []):
    name = (r.get('name') or '').lower()
    rid = str(r.get('id'))
    if 'linhares' in name or 'ribandar' in name or rid in ['44016381', '1203153948', '1203153949', '40130468', '40190556', '156581593', '1118207568', '1118207569', '1118207570', '1118207571', '1378031003', '1378031004']:
        coords = r.get('coordinates', [])
        if coords:
            linhares_roads.append({
                'id': rid,
                'name': r.get('name'),
                'bridge': r.get('bridge'),
                'highway': r.get('highway'),
                'start': coords[0],
                'end': coords[-1],
                'count': len(coords),
                'coords': coords
            })

print(f"Found {len(linhares_roads)} candidate segments for Ponte de Linhares / Panaji-Ribandar road:")
for lr in linhares_roads:
    print(f"  ID {lr['id']}: name='{lr['name']}', pts={lr['count']}, start=[{lr['start'][0]:.6f}, {lr['start'][1]:.6f}], end=[{lr['end'][0]:.6f}, {lr['end'][1]:.6f}]")
