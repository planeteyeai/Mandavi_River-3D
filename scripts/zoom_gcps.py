from PIL import Image

im = Image.open('public/data/mandovi/satellite_imagery.jpg')

# Let's crop tight windows around 6 known points to find the exact pixel:
crops = {
    # 1. Mandovi Bridge (Old) south abutment
    "mandovi_south_abutment": (1290, 480, 1340, 540),
    # 2. Mandovi Bridge (Old) north abutment
    "mandovi_north_abutment": (1280, 360, 1330, 420),
    # 3. Nerul Bridge on river
    "nerul_bridge_zoom": (290, 330, 350, 390),
    # 4. Miramar roundabout / beach garden
    "miramar_circle": (740, 620, 800, 680),
    # 5. Cabo Raj Bhavan building / tip
    "cabo_palace": (460, 1100, 520, 1160),
    # 6. Aguada Fort lower bastion / lighthouse
    "aguada_fort_bastion": (180, 610, 240, 670),
    # 7. Ribandar church / causeway entry
    "ribandar_causeway_entry": (1420, 530, 1480, 590),
    # 8. Ribandar ferry jetty
    "ribandar_jetty": (1720, 420, 1780, 480),
}

for name, box in crops.items():
    c = im.crop(box)
    # Save 4x zoomed for easy visual inspection
    c_zoom = c.resize((c.width * 4, c.height * 4), Image.NEAREST)
    c_zoom.save(f"scripts/{name}.png")
    print(f"Saved {name}.png for box {box}")
