"""Bright full-bleed feature PPT — image covers slide, small caption at bottom."""
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "ppt-assets"
OUT = ROOT / "Mandovi_RiverEye_Features_v2.pptx"

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x12, 0x2B, 0x3A)
MUTED = RGBColor(0xE8, 0xF4, 0xF8)
ACCENT = RGBColor(0x0B, 0x8F, 0xB8)
SOFT_BG = RGBColor(0xF4, 0xFA, 0xFC)


def set_run(run, size=14, bold=False, color=WHITE, name="Calibri"):
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
    """Image centered covering the full slide (cover crop)."""
    path = Path(path)
    if not path.exists():
        return None
    from PIL import Image

    slide_w, slide_h = prs.slide_width, prs.slide_height
    with Image.open(path) as im:
        iw, ih = im.size
    # scale to cover
    scale = max(slide_w / iw, slide_h / ih)
    pic_w = int(iw * scale)
    pic_h = int(ih * scale)
    left = int((slide_w - pic_w) / 2)
    top = int((slide_h - pic_h) / 2)
    pic = slide.shapes.add_picture(str(path), left, top, width=pic_w, height=pic_h)
    return pic


def caption_bar(slide, prs, title, line1, line2=None):
    """Dark translucent bar at bottom with small title + 1–2 lines."""
    bar_h = Inches(1.15) if line2 else Inches(0.95)
    bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        0,
        prs.slide_height - bar_h,
        prs.slide_width,
        bar_h,
    )
    fill(bar, RGBColor(0x0A, 0x1E, 0x2A))
    # slight transparency isn't easy in pptx without theme; use solid dark + accent strip
    no_line(bar)
    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        0,
        prs.slide_height - bar_h,
        prs.slide_width,
        Inches(0.06),
    )
    fill(strip, ACCENT)
    no_line(strip)

    box = slide.shapes.add_textbox(
        Inches(0.55),
        prs.slide_height - bar_h + Inches(0.16),
        prs.slide_width - Inches(1.1),
        bar_h - Inches(0.22),
    )
    tf = box.text_frame
    tf.word_wrap = True
    p0 = tf.paragraphs[0]
    r0 = p0.add_run()
    r0.text = title
    set_run(r0, size=16, bold=True, color=WHITE)

    p1 = tf.add_paragraph()
    r1 = p1.add_run()
    r1.text = line1
    set_run(r1, size=12, bold=False, color=MUTED)

    if line2:
        p2 = tf.add_paragraph()
        r2 = p2.add_run()
        r2.text = line2
        set_run(r2, size=12, bold=False, color=MUTED)


FEATURES = [
    {
        "title": "3D Mandovi Digital Twin",
        "line1": "Full 3D twin of the Mandovi estuary — terrain, river, bridges, and settlements.",
        "line2": "Navigate chainage live while staying in your current camera view.",
        "image": ASSETS / "feat-3d.jpg",
    },
    {
        "title": "Casino Ships & Boats",
        "line1": "Casino and river vessels rendered in 3D with real AIS LOA × beam sizes.",
        "line2": "Ships stay visible by default in every submenu — toggle On/Off from the left.",
        "image": ASSETS / "feat-ships.jpg",
    },
    {
        "title": "Live BOD & COD",
        "line1": "Always-on BOD and COD (mg/L) beside live weather on the twin.",
        "line2": "Updates with chainage click and joining-stream outlet lat/long.",
        "image": ASSETS / "feat-bodcod.jpg",
    },
    {
        "title": "Salinity — Smoothed Classes",
        "line1": "Mandovi salinity classes painted on the river — green → yellow → orange → red PSU bands.",
        "line2": "Same smoothed-class product as Google Earth, shown in the 3D twin.",
        "image": ASSETS / "feat-salinity.jpg",
    },
    {
        "title": "Chlorophyll-a (NDCI)",
        "line1": "Chlorophyll / NDCI water-quality paint for Mandovi water pixels.",
        "line2": "One click in Water Quality shows class colours with a compact legend.",
        "image": ASSETS / "feat-chlorophyll.jpg",
    },
    {
        "title": "Coliform (E. coli Class)",
        "line1": "Coliform / E. coli class overlay for bathing-water risk bands.",
        "line2": "Blue → green → orange class map across the estuary reach.",
        "image": ASSETS / "feat-coliform.jpg",
    },
    {
        "title": "Nitrogen Risk",
        "line1": "Nitrogen high-risk class layer under Pollution — Low / Moderate / High.",
        "line2": "Reads on the 3D river with live BOD·COD and weather still visible.",
        "image": ASSETS / "feat-nitrogen.jpg",
    },
    {
        "title": "Eutrophication",
        "line1": "Eutrophication trophic-class paint for Mandovi water quality.",
        "line2": "Spot oligotrophic to hypereutrophic bands without leaving the twin.",
        "image": ASSETS / "feat-eutro.jpg",
    },
    {
        "title": "Silt Analysis",
        "line1": "Silt classification & volume on the river — period picker and colour ramp.",
        "line2": "Draw an area for Surface / Cutaway silt prism from bed to surface.",
        "image": ASSETS / "feat-silt.jpg",
    },
    {
        "title": "Silt Area Selection",
        "line1": "Pick P1–P4 on the water to run silt area analysis in 3D.",
        "line2": "Surface and Cutaway modes for the selected prism.",
        "image": ASSETS / "feat-silt-area.jpg",
    },
    {
        "title": "Live Weather Details",
        "line1": "Live temperature, condition, and wind next to the twin.",
        "line2": "Open the weather icon for past/future Open-Meteo detail graphs.",
        "image": ASSETS / "feat-weather.jpg",
    },
]


def title_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    # bright wash
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT_BG)
    no_line(bg)
    # hero image soft
    cover = ASSETS / "feat-3d.jpg"
    if cover.exists():
        pic = cover_picture(slide, cover, prs)
        # light overlay for readability
        veil = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
        )
        fill(veil, RGBColor(0xF7, 0xFB, 0xFD))
        # simulate light veil via solid — actually too opaque. Use dark bottom only.
        slide.shapes._spTree.remove(veil._element)

    # white card
    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(3.2),
        Inches(1.6),
        Inches(6.9),
        Inches(4.2),
    )
    fill(card, WHITE)
    card.line.color.rgb = RGBColor(0xD0, 0xE6, 0xEE)

    logo = ASSETS / "logo.png"
    if logo.exists():
        slide.shapes.add_picture(str(logo), Inches(5.55), Inches(1.9), height=Inches(1.55))

    box = slide.shapes.add_textbox(Inches(3.5), Inches(3.6), Inches(6.3), Inches(1.8))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "Mandovi River Eye"
    set_run(r, size=30, bold=True, color=INK)
    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Feature Highlights"
    set_run(r2, size=18, bold=True, color=ACCENT)
    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = "3D twin · Ships · BOD/COD · Salinity · Chlorophyll · Coliform\nNitrogen · Eutrophication · Silt · Live Weather"
    set_run(r3, size=12, bold=False, color=RGBColor(0x4A, 0x6A, 0x78))


def feature_slide(prs, feat):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    # fallback bright bg under image
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, RGBColor(0xEA, 0xF4, 0xF8))
    no_line(bg)
    cover_picture(slide, feat["image"], prs)
    caption_bar(slide, prs, feat["title"], feat["line1"], feat.get("line2"))


def end_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT_BG)
    no_line(bg)
    if (ASSETS / "feat-bridge.jpg").exists():
        cover_picture(slide, ASSETS / "feat-bridge.jpg", prs)
        veil = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
        )
        fill(veil, RGBColor(0x08, 0x1C, 0x28))
        # can't set alpha easily — skip heavy veil; use caption style card instead
        slide.shapes._spTree.remove(veil._element)

    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(2.8),
        Inches(2.4),
        Inches(7.7),
        Inches(2.6),
    )
    fill(card, WHITE)
    card.line.color.rgb = RGBColor(0xD0, 0xE6, 0xEE)
    box = slide.shapes.add_textbox(Inches(3.1), Inches(2.7), Inches(7.1), Inches(2.1))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "All key Mandovi twin features covered"
    set_run(r, size=22, bold=True, color=INK)
    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Ships on by default · camera stays where you are · live BOD·COD & weather"
    set_run(r2, size=13, bold=False, color=RGBColor(0x4A, 0x6A, 0x78))
    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = "Thank you"
    set_run(r3, size=16, bold=True, color=ACCENT)


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
