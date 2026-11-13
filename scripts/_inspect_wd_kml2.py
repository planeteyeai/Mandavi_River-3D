from pathlib import Path
import re

def inspect(label, path):
    t = Path(path).read_text(encoding="utf-8", errors="replace")
    print("====", label, "====")
    print("size", len(t))
    # namespace-tolerant
    for key in ("north", "south", "east", "west"):
        m = re.search(rf"<(?:\w+:)?{key}>\s*([^<\s]+)", t, re.I)
        print(key, m.group(1) if m else None)
    href = re.search(r"<(?:\w+:)?href>\s*([^<]+?)\s*</(?:\w+:)?href>", t, re.I)
    if href:
        h = href.group(1).strip()
        print("href_prefix", h[:80], "len", len(h))
    # all overlays
    boxes = re.findall(
        r"<(?:\w+:)?LatLonBox>(.*?)</(?:\w+:)?LatLonBox>",
        t,
        re.I | re.S,
    )
    print("boxes", len(boxes))
    for i, box in enumerate(boxes):
        vals = {}
        for key in ("north", "south", "east", "west"):
            m = re.search(rf"<(?:\w+:)?{key}>\s*([^<\s]+)", box, re.I)
            vals[key] = m.group(1) if m else None
        print(" box", i, vals)
    names = re.findall(r"<(?:\w+:)?name>([^<]{0,160})</(?:\w+:)?name>", t, re.I)[:15]
    print("names", names)
    print()

inspect(
    "mithi water_depth (1).kml",
    r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mithi_river\src\data\water_depth (1).kml",
)
inspect(
    "mandovi water_depth.kml",
    r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mnadavi_River\public\data\mandovi\water_depth.kml",
)
inspect(
    "mandovi permanent_water.kml",
    r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mnadavi_River\public\data\mandovi\permanent_water.kml",
)
inspect(
    "mithi public water_depth.kml",
    r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Mithi_river\public\data\mithi\water_depth.kml",
)
