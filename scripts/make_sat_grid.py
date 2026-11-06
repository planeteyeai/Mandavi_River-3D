from PIL import Image, ImageDraw, ImageFont

im = Image.open('public/data/mandovi/satellite_imagery.jpg')
W, H = im.size

draw = ImageDraw.Draw(im)

# Draw grid lines every 200 pixels
for x in range(0, W, 200):
    draw.line([(x, 0), (x, H)], fill=(255, 255, 0), width=2)
    draw.text((x + 5, 20), f"X={x}", fill=(255, 255, 0))
    draw.text((x + 5, H - 40), f"X={x}", fill=(255, 255, 0))

for y in range(0, H, 100):
    draw.line([(0, y), (W, y)], fill=(255, 255, 0), width=1)
    draw.text((20, y + 5), f"Y={y}", fill=(255, 255, 0))
    draw.text((W - 80, y + 5), f"Y={y}", fill=(255, 255, 0))

im_small = im.resize((1024, int(1024 * H / W)))
im_small.save("scripts/sat_full_grid.png")
print(f"Saved sat_full_grid.png: {im_small.size}")
