from PIL import Image
import numpy as np

im = Image.open('public/data/mandovi/satellite_imagery.jpg')
W, H = im.size
print(f"Satellite image: {W} x {H}")

# Let's save a downscaled version with a coordinate grid or slice along key areas
# Let's check where water (dark blue/green/black) and land are across the image
arr = np.array(im)

# Let's find pixel locations of landmarks:
# 1. Atal Setu / Mandovi Bridges:
# In real life, the 3 bridges span from Panaji (south) to Porvorim (north) at Lon ~ 73.832, Lat ~ 15.503.
# The bridge is ~ 600m long across the river, heading almost north-south.
# Let's search columns around X=1000..1500 for the 3 parallel linear bridge structures.

# Let's crop a strip across the middle: Y=350..600, X=1100..1500
crop_bridges = im.crop((1100, 350, 1500, 600))
crop_bridges.save("scripts/crop_bridges_zone.png")

# Let's crop western end: Aguada / Miramar mouth:
crop_mouth = im.crop((0, 300, 600, 800))
crop_mouth.save("scripts/crop_mouth.png")

# Let's crop eastern end: Chorao / Divar / Old Goa:
crop_east = im.crop((1500, 300, 2048, 800))
crop_east.save("scripts/crop_east.png")

print("Saved crop strips.")
