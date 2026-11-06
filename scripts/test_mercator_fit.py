import numpy as np
import math

def latlon_to_mercator(lon, lat):
    R = 6378137.0
    x = R * math.radians(lon)
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y

def mercator_to_latlon(x, y):
    R = 6378137.0
    lon = math.degrees(x / R)
    lat = math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)
    return lon, lat

# Let's inspect the GCPs in EPSG:3857
gcps = [
    ("Aguada Fort Southern Tip", 73.7735, 15.4925, 200, 640),
    ("Nerul River Bridge", 73.7845, 15.5126, 320, 360),
    ("Cabo Raj Bhavan Tip", 73.7874, 15.4605, 490, 1140),
    ("Miramar Beach Point", 73.8122, 15.4855, 780, 660),
    ("Mandovi Bridges Center", 73.8335, 15.5030, 1312, 455),
    ("Ribandar Ferry Point", 73.8640, 15.5050, 1750, 450),
]

xm_list, ym_list = [], []
xs, ys = [], []
for name, lon, lat, x, y in gcps:
    xm, ym = latlon_to_mercator(lon, lat)
    xm_list.append(xm)
    ym_list.append(ym)
    xs.append(x)
    ys.append(y)

xm_arr = np.array(xm_list)
ym_arr = np.array(ym_list)
xs = np.array(xs)
ys = np.array(ys)

# Fit X vs X_mercator:
A_x = np.vstack([xm_arr, np.ones(len(xm_arr))]).T
a_xm, b_xm = np.linalg.lstsq(A_x, xs, rcond=None)[0]

# Fit Y vs Y_mercator:
A_y = np.vstack([ym_arr, np.ones(len(ym_arr))]).T
a_ym, b_ym = np.linalg.lstsq(A_y, ys, rcond=None)[0]

print("=== MERCATOR FIT RESULTS ===")
print(f"X = {a_xm:.6f} * X_m + ({b_xm:.2f})")
print(f"Y = {a_ym:.6f} * Y_m + ({b_ym:.2f})")

# Image bounds in Mercator:
W, H = 2048, 1194
west_m = (0 - b_xm) / a_xm
east_m = (W - b_xm) / a_xm
north_m = (0 - b_ym) / a_ym
south_m = (H - b_ym) / a_ym

w_lon, n_lat = mercator_to_latlon(west_m, north_m)
e_lon, s_lat = mercator_to_latlon(east_m, south_m)

print(f"Mercator Bounds: West={w_lon:.6f}, East={e_lon:.6f}, South={s_lat:.6f}, North={n_lat:.6f}")

for name, lon, lat, x_act, y_act in gcps:
    xm, ym = latlon_to_mercator(lon, lat)
    x_pred = a_xm * xm + b_xm
    y_pred = a_ym * ym + b_ym
    err_m = np.hypot((x_act - x_pred) / a_xm, (y_act - y_pred) / a_ym)
    print(f"{name:26s}: actual=({x_act:4d}, {y_act:4d}), pred=({x_pred:6.1f}, {y_pred:6.1f}) -> err = {err_m:.1f} m")
