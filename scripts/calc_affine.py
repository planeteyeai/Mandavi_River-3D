from PIL import Image
import numpy as np

im = Image.open('public/data/mandovi/satellite_imagery.jpg')

# Let's match very clear OSM intersection nodes to image pixels:
# 1. Fort Aguada Road sharp hairpin near Aguada jail / lighthouse:
# OSM: Lon = 73.77467, Lat = 15.49363
# In image: X ~ 205, Y ~ 635

# 2. Verem - Nerul Road bridge over river inlet:
# OSM: Lon = 73.77873, Lat = 15.51097
# In image: X ~ 290, Y ~ 365

# 3. Raj Bhavan gate / Dona Paula tip:
# OSM: Lon = 73.78870, Lat = 15.46320
# In image: X ~ 490, Y ~ 1115

# 4. Miramar Circle / Dayanand Bandodkar Marg junction:
# OSM: Lon = 73.81220, Lat = 15.48550
# In image: X ~ 765, Y ~ 665

# 5. Old Patto Bridge / Rua de Ourem:
# OSM: Lon = 73.83448, Lat = 15.49848
# In image: X ~ 1335, Y ~ 535

# 6. Atal Setu main cable-stayed pylon in Mandovi river:
# Real world: Lon = 73.83360, Lat = 15.50320
# In image: X ~ 1318, Y ~ 455

# 7. Ponte Conde de Linhares (Ribandar causeway) mid-causeway:
# OSM: Lon = 73.85400, Lat = 15.50250
# In image: X ~ 1595, Y ~ 495

# 8. Panaji-Ribandar-Old Goa road curve at Ribandar village:
# OSM: Lon = 73.86200, Lat = 15.50370
# In image: X ~ 1740, Y ~ 455

matches = [
    ("Fort Aguada Hairpin", 73.77467, 15.49363, 205, 635),
    ("Verem-Nerul Bridge", 73.77873, 15.51097, 290, 365),
    ("Raj Bhavan Road Tip", 73.78870, 15.46320, 490, 1115),
    ("Miramar Circle", 73.81220, 15.48550, 765, 665),
    ("Old Patto Bridge", 73.83448, 15.49848, 1335, 535),
    ("Atal Setu River Center", 73.83360, 15.50320, 1318, 455),
    ("Ribandar Causeway Mid", 73.85400, 15.50250, 1595, 495),
    ("Ribandar Village Curve", 73.86200, 15.50370, 1740, 455),
]

lons = np.array([m[1] for m in matches])
lats = np.array([m[2] for m in matches])
xs = np.array([m[3] for m in matches])
ys = np.array([m[4] for m in matches])

# Affine transformation:
# [x]   [a1 a2 a3] [lon]
# [y] = [a4 a5 a6] [lat]
# [1]   [0  0  1 ] [ 1 ]

A = np.vstack([lons, lats, np.ones(len(lons))]).T
sol_x, _, _, _ = np.linalg.lstsq(A, xs, rcond=None)
sol_y, _, _, _ = np.linalg.lstsq(A, ys, rcond=None)

print("Affine matrix for (Lon, Lat) -> (Pixel X, Pixel Y):")
print(f"X = {sol_x[0]:.4f} * Lon + {sol_x[1]:.4f} * Lat + {sol_x[2]:.4f}")
print(f"Y = {sol_y[0]:.4f} * Lon + {sol_y[1]:.4f} * Lat + {sol_y[2]:.4f}")

print("\nResidual errors (metres):")
for name, lon, lat, x, y in matches:
    xp = sol_x[0]*lon + sol_x[1]*lat + sol_x[2]
    yp = sol_y[0]*lon + sol_y[1]*lat + sol_y[2]
    # Invert to lon, lat error:
    # Scale: dx / dlon ~ 17000 px/deg -> 1 px ~ 107000/17000 ~ 6.3 metres!
    err_px = np.hypot(x - xp, y - yp)
    err_m = err_px * 6.3
    print(f"  {name:24s}: actual=({x:4d},{y:4d}), pred=({xp:6.1f},{yp:6.1f}) -> error: {err_px:4.1f} px ({err_m:5.1f} m)")
