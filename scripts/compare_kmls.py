import xml.etree.ElementTree as ET

for path in [
    "public/data/Mandavi River Kml.kml",
    "public/data/mandovi/mandovi_river.kml",
    "public/data/mandovi/Mandovi_River_Coordinates_Cleaned.kml",
]:
    tree = ET.parse(path)
    root = tree.getroot()
    pms = root.findall(".//{http://www.opengis.net/kml/2.2}Placemark")
    print(f"\n=== {path} ({len(pms)} placemarks) ===")
    for pm in pms:
        name = pm.find("{http://www.opengis.net/kml/2.2}name")
        n = name.text if name is not None else ""
        c = pm.find(".//{http://www.opengis.net/kml/2.2}coordinates")
        pts = c.text.strip().split() if c is not None and c.text else []
        print(f"  {n}: {len(pts)} pts, first={pts[0] if pts else None}")
