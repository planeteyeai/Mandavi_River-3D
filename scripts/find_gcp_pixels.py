from PIL import Image

im = Image.open("public/data/mandovi/satellite_imagery.jpg")
W, H = im.size
print(f"Image Dimensions: {W} x {H}")

# Let's test a linear fit between:
# Nerul Bridge: Lat 15.5126, Lon 73.7845
# Cabo Raj Bhavan: Lat 15.4605, Lon 73.7874
# Mandovi Bridge: Lat 15.5032, Lon 73.8328
# Ribandar Ferry: Lat 15.5050, Lon 73.8640

# Let's inspect small 30x30 crops around estimated locations:
# In patch_aguada (0..400, 100..500): Nerul bridge was at X ≈ 310, Y ≈ 325 (global X=310, Y=325)
# In patch_west (0..400, 400..800): Cabo tip was at X ≈ 100, Y ≈ 600 (global X=100, Y=600)
# In patch_bridges2 (1100..1500, 300..600): Mandovi bridge was at X ≈ 1300, Y ≈ 450 (global X=1300, Y=450)
# In patch_east (1600..2048, 200..600): Ribandar ferry was at X ≈ 1800, Y ≈ 450 (global X=1800, Y=450)

# Check dx vs dlon:
# Between Nerul (lon 73.7845) and Mandovi Bridge (lon 73.8328):
# dlon = 0.0483 degrees
# dx = 1300 - 310 = 990 pixels
# scale_x = 990 / 0.0483 = 20,496.89 pixels/degree!
# Width = 2048 pixels -> lon_span = 2048 / 20497 ≈ 0.100 degrees!
# Wait! Let's check between Mandovi Bridge (lon 73.8328, x=1300) and Ribandar Ferry (lon 73.8640, x=1800):
# dlon = 0.0312 degrees
# dx = 1800 - 1300 = 500 pixels
# scale_x = 500 / 0.0312 = 16,025 pixels/degree!

# Let's crop exact 60x60 windows around these features to pinpoint their exact pixel center:
crops = {
    "nerul_bridge": (270, 290, 350, 360),
    "cabo_raj_bhavan": (80, 560, 140, 640),
    "mandovi_bridge_center": (1260, 420, 1340, 480),
    "ribandar_ferry": (1750, 420, 1850, 480),
}

for name, box in crops.items():
    c = im.crop(box)
    c.save(f"scripts/{name}.png")
    print(f"Saved {name}.png for box {box}")
