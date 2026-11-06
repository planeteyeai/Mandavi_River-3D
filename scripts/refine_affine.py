import json
import numpy as np

# 10 Ground Control Points with verified OSM and satellite image pixel coordinates:
gcps = [
    # 1. Fort Aguada lower bastion / lighthouse
    ("Fort Aguada Bastion", 73.77350, 15.49250, 203, 638),
    # 2. Verem - Nerul Road bridge over inlet
    ("Verem-Nerul Bridge", 73.77873, 15.51097, 292, 362),
    # 3. Raj Bhavan Dona Paula tip
    ("Raj Bhavan Tip", 73.78870, 15.46320, 470, 1100),
    # 4. Miramar Parade Ground (Campal Football Stadium) center
    ("Campal Football Stadium", 73.81625, 15.49111, 920, 770),
    # 5. Kala Academy / Cultural Centre waterfront
    ("Kala Academy Waterfront", 73.81785, 15.49480, 946, 715),
    # 6. Dayanand Bandodkar Marg waterfront curve near Panaji Ferry
    ("Panaji DB Marg Waterfront", 73.82450, 15.50020, 1060, 630),
    # 7. Atal Setu central river pylon
    ("Atal Setu River Center", 73.83360, 15.50320, 1318, 455),
    # 8. Mandovi Bridge (Old) south abutment
    ("Mandovi South Abutment", 73.83040, 15.50050, 1308, 510),
    # 9. Ponte Conde de Linhares (Ribandar Causeway mid-point)
    ("Ribandar Causeway Mid", 73.85400, 15.50250, 1595, 495),
    # 10. Ribandar Village waterfront road curve
    ("Ribandar Village Curve", 73.86200, 15.50370, 1740, 455),
]

lons = np.array([g[1] for g in gcps])
lats = np.array([g[2] for g in gcps])
xs = np.array([g[3] for g in gcps])
ys = np.array([g[4] for g in gcps])

# Affine fit:
A = np.vstack([lons, lats, np.ones(len(lons))]).T
c_x, _, _, _ = np.linalg.lstsq(A, xs, rcond=None)
c_y, _, _, _ = np.linalg.lstsq(A, ys, rcond=None)

print("=== REFINED AFFINE FIT ===")
print(f"Pixel X = {c_x[0]:.6f} * Lon + {c_x[1]:.6f} * Lat + ({c_x[2]:.6f})")
print(f"Pixel Y = {c_y[0]:.6f} * Lon + {c_y[1]:.6f} * Lat + ({c_y[2]:.6f})")

# Image dimensions:
W = 2048
H = 1194

# Compute inverse affine matrix (Pixel X, Pixel Y) -> (Lon, Lat):
# [x]   [c_x[0] c_x[1]] [lon]   [c_x[2]]
# [y] = [c_y[0] c_y[1]] [lat] + [c_y[2]]
M = np.array([[c_x[0], c_x[1]], [c_y[0], c_y[1]]])
M_inv = np.linalg.inv(M)
shift = np.array([c_x[2], c_y[2]])

def pixel_to_lonlat(px, py):
    res = M_inv @ (np.array([px, py]) - shift)
    return res[0], res[1]

# Corner coordinates of satellite_imagery.jpg:
tl_lon, tl_lat = pixel_to_lonlat(0, 0)
tr_lon, tr_lat = pixel_to_lonlat(W, 0)
bl_lon, bl_lat = pixel_to_lonlat(0, H)
br_lon, br_lat = pixel_to_lonlat(W, H)

print("\n=== CORNERS OF SATELLITE IMAGE ===")
print(f"Top-Left     (0, 0):         Lon={tl_lon:.6f}, Lat={tl_lat:.6f}")
print(f"Top-Right    (2048, 0):      Lon={tr_lon:.6f}, Lat={tr_lat:.6f}")
print(f"Bottom-Left  (0, 1194):      Lon={bl_lon:.6f}, Lat={bl_lat:.6f}")
print(f"Bottom-Right (2048, 1194):   Lon={br_lon:.6f}, Lat={br_lat:.6f}")

print("\n=== BOUNDING BOX ===")
sat_west = min(tl_lon, bl_lon)
sat_east = max(tr_lon, br_lon)
sat_south = min(bl_lat, br_lat)
sat_north = max(tl_lat, tr_lat)
print(f"West:  {sat_west:.6f}")
print(f"East:  {sat_east:.6f}")
print(f"South: {sat_south:.6f}")
print(f"North: {sat_north:.6f}")

print("\n=== RESIDUAL ERRORS ACROSS ALL 10 CONTROL POINTS ===")
errors = []
for name, lon, lat, x_act, y_act in gcps:
    xp = c_x[0]*lon + c_x[1]*lat + c_x[2]
    yp = c_y[0]*lon + c_y[1]*lat + c_y[2]
    # Error in metres:
    # 1 pixel in X ≈ 107000 / c_x[0] ≈ 6.1m
    # 1 pixel in Y ≈ 111000 / abs(c_y[1]) ≈ 7.3m
    err_x_m = (x_act - xp) * (107000 / c_x[0])
    err_y_m = (y_act - yp) * (111000 / abs(c_y[1]))
    err_dist = np.hypot(err_x_m, err_y_m)
    errors.append(err_dist)
    print(f"  {name:26s}: actual=({x_act:4d},{y_act:4d}), pred=({xp:6.1f},{yp:6.1f}) -> error: {err_dist:5.1f} m")

print(f"\nMean error:   {np.mean(errors):.1f} m")
print(f"Max error:    {np.max(errors):.1f} m")
print(f"Median error: {np.median(errors):.1f} m")
