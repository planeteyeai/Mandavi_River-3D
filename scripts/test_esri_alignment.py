from PIL import Image

im = Image.open('scripts/test_esri_sat.jpg')
W, H = im.size

west, east = 73.76, 73.89
south, north = 15.45, 15.53

def lonlat_to_pixel(lon, lat):
    u = (lon - west) / (east - west)
    v = (lat - south) / (north - south)
    px = int(round(u * W))
    py = int(round((1.0 - v) * H))
    return px, py

# 1. Atal Setu / Mandovi Bridges: Lon ~ 73.8328, Lat ~ 15.5032
px_br, py_br = lonlat_to_pixel(73.8328, 15.5032)
print(f"Bridges pixel: ({px_br}, {py_br})")

# Crop 200x200 around bridge:
crop_br = im.crop((px_br - 100, py_br - 100, px_br + 100, py_br + 100))
crop_br.save("scripts/esri_crop_bridges.png")

# 2. Fort Aguada lower bastion: Lon 73.7735, Lat 15.4925
px_ag, py_ag = lonlat_to_pixel(73.7735, 15.4925)
print(f"Aguada pixel: ({px_ag}, {py_ag})")
crop_ag = im.crop((px_ag - 100, py_ag - 100, px_ag + 100, py_ag + 100))
crop_ag.save("scripts/esri_crop_aguada.png")

# 3. Ribandar Causeway mid: Lon 73.8540, Lat 15.5025
px_rb, py_rb = lonlat_to_pixel(73.8540, 15.5025)
print(f"Ribandar pixel: ({px_rb}, {py_rb})")
crop_rb = im.crop((px_rb - 100, py_rb - 100, px_rb + 100, py_rb + 100))
crop_rb.save("scripts/esri_crop_ribandar.png")

print("Saved ESRI crops.")
