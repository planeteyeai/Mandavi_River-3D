from PIL import Image
import numpy as np

crop = Image.open('scripts/kr_railway_crop.png').convert('RGB')
arr = np.array(crop)
# Height is 378, width is 157
west, east, south, north = 73.868989, 73.873972, 15.501016, 15.513016
h, w, _ = arr.shape

# Let's inspect rows around the river crossing: py from 50 to 320
bridge_pts = []
for py in range(40, 340, 15):
    row = arr[py, :, :]
    # The bridge appears as a distinct linear feature (often higher brightness or distinct color compared to water)
    # Let's find brightness: R + G + B
    brightness = row.sum(axis=1)
    # River water is usually dark
    # Let's print the max brightness in the middle columns (col 40 to 110)
    sub = brightness[40:110]
    peak_col = 40 + np.argmax(sub)
    lon = west + (peak_col / w) * (east - west)
    lat = north - (py / h) * (north - south)
    bridge_pts.append((lon, lat, peak_col, py))

print("Detected bridge centerline candidates from satellite image:")
for lon, lat, col, py in bridge_pts:
    print(f"  py={py:3d}, col={col:3d} -> lon={lon:.6f}, lat={lat:.6f}")
