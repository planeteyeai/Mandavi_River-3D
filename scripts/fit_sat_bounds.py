import numpy as np

# GCPs identified with high precision:
# Format: (name, Lon, Lat, X_pixel, Y_pixel)
gcps = [
    ("Aguada Fort Southern Tip", 73.7735, 15.4925, 200, 640),
    ("Nerul River Bridge", 73.7845, 15.5126, 320, 360),
    ("Cabo Raj Bhavan Tip", 73.7874, 15.4605, 490, 1140),
    ("Miramar Beach Point", 73.8122, 15.4855, 780, 660),
    ("Mandovi Bridges Center", 73.8335, 15.5030, 1312, 455),
    ("Ribandar Ferry Point", 73.8640, 15.5050, 1750, 450),
]

lons = np.array([g[1] for g in gcps])
lats = np.array([g[2] for g in gcps])
xs = np.array([g[3] for g in gcps])
ys = np.array([g[4] for g in gcps])

# Fit X vs Lon: x = a * lon + b
A_x = np.vstack([lons, np.ones(len(lons))]).T
a_x, b_x = np.linalg.lstsq(A_x, xs, rcond=None)[0]

# Fit Y vs Lat: y = a * lat + b
A_y = np.vstack([lats, np.ones(len(lats))]).T
a_y, b_y = np.linalg.lstsq(A_y, ys, rcond=None)[0]

print("=== LINEAR FIT RESULTS ===")
print(f"X = {a_x:.4f} * Lon + ({b_x:.4f})")
print(f"Y = {a_y:.4f} * Lat + ({b_y:.4f})")

# Image dimensions:
W, H = 2048, 1194

# Derived Bounds:
# At X = 0:
west = (0 - b_x) / a_x
# At X = W (2048):
east = (W - b_x) / a_x

# At Y = 0 (top):
north = (0 - b_y) / a_y
# At Y = H (bottom):
south = (H - b_y) / a_y

print("\n=== DERIVED SATELLITE IMAGE BOUNDS ===")
print(f"West:  {west:.6f}")
print(f"East:  {east:.6f}")
print(f"South: {south:.6f}")
print(f"North: {north:.6f}")

# Residuals check:
print("\n=== RESIDUAL CHECKS FOR EACH GCP ===")
for name, lon, lat, x_act, y_act in gcps:
    x_pred = a_x * lon + b_x
    y_pred = a_y * lat + b_y
    # Convert pixel error to metres (approx 1 degree lat = 111,000m, 1 deg lon = 107,000m)
    err_x_deg = (x_act - x_pred) / a_x
    err_y_deg = (y_act - y_pred) / a_y
    err_m = np.hypot(err_x_deg * 107000, err_y_deg * 111000)
    print(f"{name:26s}: actual=({x_act:4d}, {y_act:4d}), pred=({x_pred:6.1f}, {y_pred:6.1f}) -> err = {err_m:.1f} m")

# Compare with DTM bounds:
print("\n=== COMPARISON WITH DTM BOUNDS ===")
print("DTM Bounds:  West=73.760000, East=73.890000, South=15.450000, North=15.530000")
print(f"Sat Bounds:  West={west:.6f}, East={east:.6f}, South={south:.6f}, North={north:.6f}")
