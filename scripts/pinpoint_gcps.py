from PIL import Image
import numpy as np

im = Image.open('public/data/mandovi/satellite_imagery.jpg')
W, H = im.size

# Let's inspect specific features with high precision:
# In crop_bridges_zone: box was (1100, 350, 1500, 600)
# Inside this box:
# Bridge spans vertically from North bank (top of crop) to South bank (bottom of crop).
# In the crop image (width=400, height=250):
# The bridge is around x_crop = 210..225!
# So global X = 1100 + 215 = 1315!
# The river center in crop is around y_crop = 115!
# So global Y = 350 + 115 = 465!

# Let's check Atal Setu / Mandovi Bridge in full image:
# South bank abutment: X ~ 1318, Y ~ 530
# North bank abutment: X ~ 1305, Y ~ 380
# Bridge center on river: X = 1312, Y = 455

# Let's verify Nerul Bridge:
# nerul bridge crosses Nerul river near lat 15.5126, lon 73.7845.
# In crop_mouth: box was (0, 300, 600, 800)
# Inside crop_mouth:
# Nerul river bridge is at top-middle of crop_mouth: x_crop ~ 325, y_crop ~ 60
# So global X ~ 325, global Y ~ 360.

# Let's check Aguada Lighthouse / Fort Aguada:
# Real world: Lat 15.4925, Lon 73.7735
# In crop_mouth:
# Fort Aguada is the tip at bottom-left of headland: x_crop ~ 220, y_crop ~ 350
# Global X ~ 220, Global Y ~ 650.

# Let's check Cabo Raj Bhavan (tip of Dona Paula / Miramar headland):
# Real world: Lat 15.4605, Lon 73.7874
# Where is it?
# Let's search South of Mandovi Bay:
# Let's crop (0, 700, 600, 1194):
crop_south = im.crop((0, 700, 600, 1194))
crop_south.save("scripts/crop_cabo.png")

# Let's check Konkan Railway Viaduct:
# Real world: Lat 15.5065, Lon 73.8714
# Let's crop eastern region: X=1700..2048, Y=200..600
crop_rail = im.crop((1700, 200, 2048, 600))
crop_rail.save("scripts/crop_railway.png")

print("Saved crop_cabo and crop_railway.")
