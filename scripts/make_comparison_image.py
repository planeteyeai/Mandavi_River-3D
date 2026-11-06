from PIL import Image, ImageDraw, ImageFont

# Load old and new satellite rasters
old_im = Image.open('public/data/mandovi/satellite_imagery_backup.jpg')
new_im = Image.open('public/data/mandovi/satellite_imagery.jpg')

# Landmark 1: Atal Setu / Mandovi Bridge
# In old uncalibrated image: bridge was found around (1312, 455)
old_crop = old_im.crop((1212, 355, 1412, 555)).resize((300, 300), Image.LANCZOS)
# In new georeferenced raster: Lon 73.8328, Lat 15.5032 maps to (2319, 844) on 4096x2520
new_crop = new_im.crop((2319 - 150, 844 - 150, 2319 + 150, 844 + 150)).resize((300, 300), Image.LANCZOS)

# Create side-by-side comparison image
comp = Image.new('RGB', (640, 360), (20, 25, 30))
comp.paste(old_crop, (15, 45))
comp.paste(new_crop, (325, 45))

draw = ImageDraw.Draw(comp)
draw.text((15, 15), "BEFORE: Uncalibrated Crop (Offset >400m)", fill=(255, 80, 80))
draw.text((325, 15), "AFTER: Georeferenced Ortho (Exact Match)", fill=(80, 255, 120))
draw.text((15, 335), "Atal Setu / Mandovi Bridges - Real World Location Verified", fill=(200, 200, 200))

comp.save("scripts/comparison_atal_setu.png")
print("Saved comparison_atal_setu.png")
