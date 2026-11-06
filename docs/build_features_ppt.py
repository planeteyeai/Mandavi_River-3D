"""Bright photo PPT — full-bleed feature shots, light captions, black text."""
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "ppt-assets"
OUT = ROOT / "Mandovi_RiverEye_Features_v3.pptx"

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x11, 0x11, 0x11)  # near-black body text
MUTED = RGBColor(0x33, 0x3F, 0x48)
ACCENT = RGBColor(0x0B, 0x7C, 0xA8)  # teal
ACCENT_2 = RGBColor(0xC4, 0x5C, 0x26)  # silt amber
SOFT_BG = RGBColor(0xF2, 0xF7, 0xFA)
BAR_BG = RGBColor(0xFF, 0xFF, 0xFF)
BAR_LINE = RGBColor(0xC8, 0xDC, 0xE6)


def set_run(run, size=14, bold=False, color=INK, name="Calibri"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = name


def fill(shape, rgb):
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb


def no_line(shape):
    shape.line.fill.background()


def cover_picture(slide, path, prs):
    path = Path(path)
    if not path.exists():
        return None
    from PIL import Image

    slide_w, slide_h = prs.slide_width, prs.slide_height
    with Image.open(path) as im:
        iw, ih = im.size
    scale = max(slide_w / iw, slide_h / ih)
    pic_w = int(iw * scale)
    pic_h = int(ih * scale)
    left = int((slide_w - pic_w) / 2)
    top = int((slide_h - pic_h) / 2)
    return slide.shapes.add_picture(str(path), left, top, width=pic_w, height=pic_h)


def light_caption(slide, prs, title, line1, line2=None, accent=ACCENT):
    """White caption strip — black text, coloured title accent (no black bar)."""
    bar_h = Inches(1.2) if line2 else Inches(1.0)
    # soft shadow plate
    plate = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        0,
        prs.slide_height - bar_h,
        prs.slide_width,
        bar_h,
    )
    fill(plate, BAR_BG)
    plate.line.color.rgb = BAR_LINE

    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        0,
        prs.slide_height - bar_h,
        Inches(0.12),
        bar_h,
    )
    fill(strip, accent)
    no_line(strip)

    box = slide.shapes.add_textbox(
        Inches(0.45),
        prs.slide_height - bar_h + Inches(0.14),
        prs.slide_width - Inches(0.9),
        bar_h - Inches(0.2),
    )
    tf = box.text_frame
    tf.word_wrap = True
    p0 = tf.paragraphs[0]
    r0 = p0.add_run()
    r0.text = title
    set_run(r0, size=18, bold=True, color=accent)

    p1 = tf.add_paragraph()
    r1 = p1.add_run()
    r1.text = line1
    set_run(r1, size=13, bold=False, color=INK)

    if line2:
        p2 = tf.add_paragraph()
        r2 = p2.add_run()
        r2.text = line2
        set_run(r2, size=12, bold=False, color=MUTED)


# All product points — silt is a 3-step photo story
FEATURES = [
    {
        "title": "3D Mandovi Digital Twin",
        "line1": "Full 3D twin of the Mandovi estuary — terrain, river, bridges, and settlements.",
        "line2": "Navigate chainage live while the camera stays where you left it.",
        "image": ASSETS / "feat-3d.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Casino Ships & Boats",
        "line1": "Casino and river vessels in 3D with real AIS LOA × beam sizes.",
        "line2": "Ships stay ON by default in every submenu — toggle from the left Ships control.",
        "image": ASSETS / "feat-ships.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Live BOD & COD",
        "line1": "Always-on BOD and COD (mg/L) beside live weather on the twin.",
        "line2": "Updates with chainage click and joining-stream outlet lat/long.",
        "image": ASSETS / "feat-bodcod.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Salinity — Smoothed Classes",
        "line1": "Mandovi salinity classes on the river — green → yellow → orange → red PSU bands.",
        "line2": "Same smoothed-class product as Google Earth, shown in the 3D twin.",
        "image": ASSETS / "feat-salinity.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Chlorophyll-a (NDCI)",
        "line1": "Chlorophyll / NDCI water-quality paint for Mandovi water pixels.",
        "line2": "One click in Water Quality shows class colours with a compact legend.",
        "image": ASSETS / "feat-chlorophyll.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Coliform (E. coli Class)",
        "line1": "Coliform / E. coli class overlay for bathing-water risk bands.",
        "line2": "Blue → green → orange class map across the estuary reach.",
        "image": ASSETS / "feat-coliform.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Nitrogen Risk",
        "line1": "Nitrogen high-risk class layer — Low / Moderate / High.",
        "line2": "Reads on the 3D river with live BOD·COD and weather still visible.",
        "image": ASSETS / "feat-nitrogen.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Eutrophication",
        "line1": "Eutrophication trophic-class paint for Mandovi water quality.",
        "line2": "Spot oligotrophic to hypereutrophic bands without leaving the twin.",
        "image": ASSETS / "feat-eutro.jpg",
        "accent": ACCENT,
    },
    {
        "title": "Silt Classification & Volume",
        "line1": "River-wide silt classification and volume with period picker (e.g. Oct 2026).",
        "line2": "Colour ramp shows deposition intensity across the Mandovi reach.",
        "image": ASSETS / "feat-silt.jpg",
        "accent": ACCENT_2,
    },
    {
        "title": "Silt Step 1 — Place 4 Points",
        "line1": "Open Silt Area Analysis and click P1 → P2 → P3 → P4 on the water.",
        "line2": "The polygon closes automatically — then silt analysis runs for that area.",
        "image": ASSETS / "feat-silt-points.jpg",
        "accent": ACCENT_2,
    },
    {
        "title": "Silt Step 2 — Area Locked",
        "line1": "Selected area shows Surface / Underwater modes after the 4 points are set.",
        "line2": "Edit, clear, or minimize while the prism stays on the twin.",
        "image": ASSETS / "feat-silt-area.jpg",
        "accent": ACCENT_2,
    },
    {
        "title": "Silt Step 3 — Inner Water Simulated View",
        "line1": "Switch to Underwater (Cutaway) — camera dives into the water column.",
        "line2": "See simulated silt from bed to surface inside the selected prism — clearly visible.",
        "image": ASSETS / "feat-silt-underwater.jpg",
        "accent": ACCENT_2,
    },
    {
        "title": "Live Weather Details",
        "line1": "Live temperature, condition, and wind next to the twin.",
        "line2": "Open the weather icon for past/future Open-Meteo detail graphs.",
        "image": ASSETS / "feat-weather.jpg",
        "accent": ACCENT,
    },
]


def title_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT_BG)
    no_line(bg)

    cover = ASSETS / "feat-3d.jpg"
    if cover.exists():
        cover_picture(slide, cover, prs)
        # light wash so title card stays readable (not black)
        wash = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
        )
        fill(wash, RGBColor(0xF7, 0xFB, 0xFD))
        # soft: leave mostly photo — remove opaque wash, use side card only
        slide.shapes._spTree.remove(wash._element)

    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(3.0),
        Inches(1.45),
        Inches(7.3),
        Inches(4.5),
    )
    fill(card, WHITE)
    card.line.color.rgb = BAR_LINE

    accent_bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(3.0),
        Inches(1.45),
        Inches(0.14),
        Inches(4.5),
    )
    fill(accent_bar, ACCENT)
    no_line(accent_bar)

    logo = ASSETS / "logo.png"
    if logo.exists():
        slide.shapes.add_picture(str(logo), Inches(5.45), Inches(1.7), height=Inches(1.45))

    box = slide.shapes.add_textbox(Inches(3.4), Inches(3.3), Inches(6.6), Inches(2.4))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "Mandovi River Eye"
    set_run(r, size=32, bold=True, color=INK)

    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Feature Highlights — Updated Project"
    set_run(r2, size=16, bold=True, color=ACCENT)

    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = (
        "3D Twin · Ships · BOD/COD · Salinity · Chlorophyll · Coliform\n"
        "Nitrogen · Eutrophication · Silt (Points → Underwater) · Weather"
    )
    set_run(r3, size=12, bold=False, color=MUTED)


def feature_slide(prs, feat):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT_BG)
    no_line(bg)
    cover_picture(slide, feat["image"], prs)
    light_caption(
        slide,
        prs,
        feat["title"],
        feat["line1"],
        feat.get("line2"),
        accent=feat.get("accent", ACCENT),
    )


def end_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT_BG)
    no_line(bg)
    if (ASSETS / "feat-bridge.jpg").exists():
        cover_picture(slide, ASSETS / "feat-bridge.jpg", prs)

    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(2.6),
        Inches(2.2),
        Inches(8.1),
        Inches(3.0),
    )
    fill(card, WHITE)
    card.line.color.rgb = BAR_LINE

    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(2.6),
        Inches(2.2),
        Inches(0.14),
        Inches(3.0),
    )
    fill(strip, ACCENT_2)
    no_line(strip)

    box = slide.shapes.add_textbox(Inches(3.0), Inches(2.5), Inches(7.4), Inches(2.5))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "All Mandovi twin features covered"
    set_run(r, size=24, bold=True, color=INK)

    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Silt flow: place 4 points → lock area → underwater simulated silt view"
    set_run(r2, size=14, bold=False, color=ACCENT_2)

    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = "Ships on by default · camera stays · live BOD·COD & weather"
    set_run(r3, size=13, bold=False, color=MUTED)

    p4 = tf.add_paragraph()
    p4.alignment = PP_ALIGN.CENTER
    r4 = p4.add_run()
    r4.text = "Thank you"
    set_run(r4, size=16, bold=True, color=ACCENT)


def main():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    title_slide(prs)
    for feat in FEATURES:
        feature_slide(prs, feat)
    end_slide(prs)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    print(f"Wrote {OUT} ({1 + len(FEATURES) + 1} slides)")


if __name__ == "__main__":
    main()
