import xml.etree.ElementTree as ET

tree = ET.parse("public/data/Mandavi River Kml.kml")
root = tree.getroot()

placemarks = []
for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
    name = pm.find("{http://www.opengis.net/kml/2.2}name")
    n_str = name.text if name is not None else "Unnamed"
    # Geometry types
    poly = pm.find(".//{http://www.opengis.net/kml/2.2}Polygon")
    ls = pm.find(".//{http://www.opengis.net/kml/2.2}LineString")
    pt = pm.find(".//{http://www.opengis.net/kml/2.2}Point")
    coords_elem = pm.find(".//{http://www.opengis.net/kml/2.2}coordinates")
    n_coords = 0
    sample = None
    if coords_elem is not None and coords_elem.text:
        pts = coords_elem.text.strip().split()
        n_coords = len(pts)
        if pts:
            sample = pts[0]
    gtype = "Polygon" if poly is not None else "LineString" if ls is not None else "Point" if pt is not None else "Other"
    print(f"Placemark '{n_str}': {gtype}, {n_coords} coords, sample: {sample}")
