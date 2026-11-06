import numpy as np

# Camera at (0, 1000, 0), looking at (0, 0, 0)
# Look vector = (0, -1, 0)
# Up vector = (0, 0, 1)

look = np.array([0, -1, 0])
up = np.array([0, 0, 1])

# In Three.js:
# camera.matrix:
# Column 0: right vector
# Column 1: up vector
# Column 2: -look vector (backwards)

right = np.cross(look, up)
print(f"When Look = (0, -1, 0) and Up = (0, 0, 1):")
print(f"Right = Look x Up = {right}")

# If flipX = true:
# easting increases -> x = -(easting - e0) -> negative X!
# So East has negative X (x < 0).
# Since right is (-1, 0, 0):
# A point to the East (x = -100, y = 0, z = 0):
# Its coordinate in camera space (x_cam):
# x_cam = dot(point - cam_pos, right) = dot((-100, 0, 0), (-1, 0, 0)) = +100!
print(f"Point to the East (x = -100): x_cam = {np.dot(np.array([-100, 0, 0]), right)}")
print(f"Point to the West (x = +100): x_cam = {np.dot(np.array([100, 0, 0]), right)}")
print("Notice: With flipX=true and Up=(0,0,1):")
print("East has x_cam = +100 (SCREEN RIGHT)!")
print("West has x_cam = -100 (SCREEN LEFT)!")
