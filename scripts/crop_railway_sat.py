import math
from PIL import Image

# Satellite image bounds
west, east, south, north = 73.76, 73.89, 15.45, 15.53
im = Image.open('public/data/mandovi/satellite_imagery.jpg')
w, h = im.size

def lon_lat_to_pixel(lon, lat):
    px = int((lon - west) / (east - west) * w)
    py = int((north - lat) / (north - south) * h)
    return px, py

def pixel_to_lon_lat(px, py):
    lon = west + (px / w) * (east - west)
    lat = north - (py / h) * (north - south)
    return lon, lat

# Crop around the Konkan Railway crossing: lon 73.869 to 73.874, lat 15.501 to 15.512
p1 = lon_lat_to_pixel(73.869, 15.513) # top-left
p2 = lon_lat_to_pixel(73.874, 15.501) # bottom-right

box = (min(p1[0], p2[0]), min(p1[1], p2[1]), max(p1[0], p2[0]), max(p1[1], p2[1]))
crop = im.crop(box)
crop.save('scripts/kr_railway_crop.png')
print(f"Saved crop: {crop.size} px, box: {box}")
print(f"Top-Left lon,lat: {pixel_to_lon_lat(box[0], box[1])}")
print(f"Bottom-Right lon,lat: {pixel_to_lon_lat(box[2], box[3])}")
