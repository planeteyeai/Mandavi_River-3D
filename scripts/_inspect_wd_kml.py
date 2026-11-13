from pathlib import Path
import re

p = Path(r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mithi_river\src\data\water_depth (1).kml")
t = p.read_text(encoding="utf-8", errors="replace")
print("size", len(t))
print("GroundOverlay", t.count("GroundOverlay"))
print("LatLonBox", t.count("LatLonBox"))
print("data:image", "data:image" in t)
print("Placemark", len(re.findall(r"<Placemark", t, re.I)))
print("Polygon", len(re.findall(r"<Polygon", t, re.I)))
print("Point", len(re.findall(r"<Point", t, re.I)))
for key in ("north", "south", "east", "west"):
    m = re.search(rf"<{key}>\s*([^<\s]+)", t, re.I)
    print(key, m.group(1) if m else None)
# name / description snippets
names = re.findall(r"<name>([^<]{0,120})</name>", t, re.I)[:20]
print("names", names)
# compare with mandovi bundled
for rel in [
    r"public\data\mandovi\water_depth.kml",
    r"public\data\mandovi\permanent_water.kml",
    r"public\data\updates\original\water_depth_mandavi.kml",
]:
    q = Path(r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mnadavi_River") / rel
    if not q.exists():
        print("missing", rel)
        continue
    u = q.read_text(encoding="utf-8", errors="replace")
    print("---", rel, "size", len(u), "same_as_mithi", u == t)
    for key in ("north", "south", "east", "west"):
        m = re.search(rf"<{key}>\s*([^<\s]+)", u, re.I)
        print(" ", key, m.group(1) if m else None)
