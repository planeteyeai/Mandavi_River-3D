"""Mandovi River Eye PPT — uses ONLY docs/ppt-assets/user-shots (user-provided)."""
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

ROOT = Path(__file__).resolve().parent
SHOTS = ROOT / "ppt-assets" / "user-shots"
LOGO = ROOT / "ppt-assets" / "logo.png"
OUT = ROOT / "Mandovi_RiverEye_Features_USER.pptx"

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x10, 0x10, 0x10)
MUTED = RGBColor(0x3A, 0x45, 0x4E)
TEAL = RGBColor(0x0A, 0x7C, 0xA0)
AMBER = RGBColor(0xC4, 0x5C, 0x26)
GREEN = RGBColor(0x1B, 0x7A, 0x4E)
SOFT = RGBColor(0xF0, 0xF6, 0xF9)
BAR_LINE = RGBColor(0xC5, 0xD8, 0xE2)


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


def must(name):
    p = SHOTS / name
    if not p.exists():
        raise FileNotFoundError(f"Missing user shot: {p}")
    return p


def cover_picture(slide, path, prs, bottom_pad=0):
    from PIL import Image

    slide_w = prs.slide_width
    slide_h = prs.slide_height - bottom_pad
    with Image.open(path) as im:
        iw, ih = im.size
    scale = max(slide_w / iw, slide_h / ih)
    pic_w = int(iw * scale)
    pic_h = int(ih * scale)
    left = int((slide_w - pic_w) / 2)
    top = int((slide_h - pic_h) / 2)
    return slide.shapes.add_picture(str(path), left, top, width=pic_w, height=pic_h)


def light_caption(slide, prs, step, title, lines, accent=TEAL):
    bar_h = Inches(1.35) if len(lines) > 1 else Inches(1.1)
    plate = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, prs.slide_height - bar_h, prs.slide_width, bar_h
    )
    fill(plate, WHITE)
    plate.line.color.rgb = BAR_LINE

    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, prs.slide_height - bar_h, Inches(0.14), bar_h
    )
    fill(strip, accent)
    no_line(strip)

    left = Inches(0.4)
    if step:
        badge = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(0.35),
            prs.slide_height - bar_h + Inches(0.18),
            Inches(0.72),
            Inches(0.36),
        )
        fill(badge, accent)
        no_line(badge)
        tfb = badge.text_frame
        p = tfb.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = step
        set_run(r, size=11, bold=True, color=WHITE)
        left = Inches(1.2)

    box = slide.shapes.add_textbox(
        left,
        prs.slide_height - bar_h + Inches(0.12),
        prs.slide_width - left - Inches(0.35),
        bar_h - Inches(0.18),
    )
    tf = box.text_frame
    tf.word_wrap = True
    p0 = tf.paragraphs[0]
    r0 = p0.add_run()
    r0.text = title
    set_run(r0, size=17, bold=True, color=accent)
    for line in lines:
        p = tf.add_paragraph()
        r = p.add_run()
        r.text = line
        set_run(r, size=12, bold=False, color=INK)


# ONLY the 13 images you provided — in presentation order
FEATURES = [
    {
        "file": "01-3d-twin.png",
        "title": "3D Mandovi Digital Twin",
        "lines": [
            "Full River Eye twin of the Mandovi — terrain, buildings, vegetation, ships and live chainage.",
            "BOD · COD and live weather stay on screen while you move along the reach (e.g. 6+800).",
        ],
        "accent": TEAL,
    },
    {
        "file": "02-ships.png",
        "title": "Casino Ships & Vessel Details",
        "lines": [
            "3D casino / passenger vessels with real size (LOA × beam) — Ships toggle On by default.",
            "Select a vessel (e.g. Lucky Seven) for type, berth status, model and exact coordinates.",
        ],
        "accent": TEAL,
    },
    {
        "file": "03-bod-cod-streams.png",
        "title": "Live BOD & COD + Joining Streams",
        "lines": [
            "Always-on BOD and COD (mg/L) update with chainage and joining-stream outlets.",
            "Upstream confluence cards show connected status, lon/lat and BOD/COD ranges.",
        ],
        "accent": TEAL,
    },
    {
        "file": "04-water-depth-2d.jpg",
        "title": "2D Water Depth View",
        "lines": [
            "Top-down Mandovi map with water-depth colour scale from shallow to deep channel.",
            "River Data reads live depth at the selected chainage; Ships remain On.",
        ],
        "accent": TEAL,
    },
    {
        "file": "05-chlorophyll.jpg",
        "title": "Chlorophyll-a (NDCI)",
        "lines": [
            "NDCI water-quality paint — Low (light green) to High (dark green) across the estuary.",
            "One click in Water Quality; vessels stay visible for spatial context.",
        ],
        "accent": GREEN,
    },
    {
        "file": "06-salinity.jpg",
        "title": "Salinity — Smoothed Classes",
        "lines": [
            "Smoothed PSU classes: <0.5 · 0.5–5 · 5–18 · 18–30 · >30 (green → yellow → orange → red).",
            "Same class product as Google Earth, shown live on the Mandovi twin.",
        ],
        "accent": AMBER,
    },
    {
        "file": "07-coliform.png",
        "title": "Coliform (E. coli Risk)",
        "lines": [
            "Bathing-water risk bands in CFU/100 ml — Good → Moderate → High → Highly Risk.",
            "Hotspots near offshore casinos and berths while Ships stay On.",
        ],
        "accent": AMBER,
    },
    {
        "file": "08-nitrogen.png",
        "title": "Nitrogen Risk",
        "lines": [
            "Nitrogen Low / Moderate / High class overlay on the 3D river.",
            "Sangam-side navigation keeps you oriented while reading nutrient risk.",
        ],
        "accent": GREEN,
    },
    {
        "file": "09-eutrophication.png",
        "title": "Eutrophication (Trophic Class)",
        "lines": [
            "Oligotrophic → Mesotrophic → Eutrophic → Hypereutrophic bands on the water body.",
            "Elevated trophic colour along chainage with ships and place labels still in view.",
        ],
        "accent": AMBER,
    },
    {
        "file": "11-silt-underwater.png",
        "step": "01",
        "title": "Silt — Inner Water Simulated View",
        "lines": [
            "After placing P1→P2→P3→P4, switch to Underwater (Cutaway).",
            "Camera dives into the water column — simulated silt from bed to surface is clearly visible.",
        ],
        "accent": AMBER,
    },
    {
        "file": "10-silt-dashboard.png",
        "step": "02",
        "title": "Silt Area Analysis Dashboard",
        "lines": [
            "Locked 4-point area: cross-section (WSE vs bed), silt/deposition profile, area · volume · coverage.",
            "Example readout: 59,275 m² · 99.9% coverage · 81,722 m³ · Oct 2026 class mix.",
        ],
        "accent": AMBER,
    },
    {
        "file": "12-weather-past.png",
        "title": "Live Weather — Past 7 Days",
        "lines": [
            "Open-Meteo weather overview at the selected station: temperature, rain, wind, PM2.5, PM10.",
            "Past-week archived estimates sit beside the twin with Ships and River Data still available.",
        ],
        "accent": TEAL,
    },
    {
        "file": "13-weather-next.png",
        "title": "Live Weather — Next 7 Days Forecast",
        "lines": [
            "Same dashboard for the next 7 days — forecast temperature, precip, wind and particulates.",
            "Station lat/long and Open-Meteo grid shown under the charts.",
        ],
        "accent": TEAL,
    },
]


def title_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT)
    no_line(bg)
    cover_picture(slide, must("01-3d-twin.png"), prs)

    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(2.9), Inches(1.35), Inches(7.5), Inches(4.7)
    )
    fill(card, WHITE)
    card.line.color.rgb = BAR_LINE
    accent = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(2.9), Inches(1.35), Inches(0.14), Inches(4.7)
    )
    fill(accent, TEAL)
    no_line(accent)

    if LOGO.exists():
        slide.shapes.add_picture(str(LOGO), Inches(5.5), Inches(1.55), height=Inches(1.35))

    box = slide.shapes.add_textbox(Inches(3.3), Inches(3.1), Inches(6.7), Inches(2.7))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "Mandovi River Eye"
    set_run(r, size=34, bold=True, color=INK)

    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Feature Highlights — Your Product Screenshots"
    set_run(r2, size=16, bold=True, color=TEAL)

    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = (
        "3D Twin · Ships · BOD/COD · Depth · Chlorophyll · Salinity\n"
        "Coliform · Nitrogen · Eutrophication · Silt Underwater · Weather"
    )
    set_run(r3, size=12, bold=False, color=MUTED)


def feature_slide(prs, feat):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT)
    no_line(bg)
    pad = Inches(1.35)
    cover_picture(slide, must(feat["file"]), prs, bottom_pad=int(pad))
    light_caption(
        slide,
        prs,
        feat.get("step"),
        feat["title"],
        feat["lines"],
        accent=feat.get("accent", TEAL),
    )


def end_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    fill(bg, SOFT)
    no_line(bg)
    cover_picture(slide, must("11-silt-underwater.png"), prs)

    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(2.5), Inches(2.1), Inches(8.3), Inches(3.2)
    )
    fill(card, WHITE)
    card.line.color.rgb = BAR_LINE
    strip = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(2.5), Inches(2.1), Inches(0.14), Inches(3.2)
    )
    fill(strip, AMBER)
    no_line(strip)

    box = slide.shapes.add_textbox(Inches(2.9), Inches(2.4), Inches(7.6), Inches(2.7))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "All key Mandovi twin features covered"
    set_run(r, size=24, bold=True, color=INK)

    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run()
    r2.text = "Silt: 4 points → underwater simulated view → full area dashboard"
    set_run(r2, size=14, bold=False, color=AMBER)

    p3 = tf.add_paragraph()
    p3.alignment = PP_ALIGN.CENTER
    r3 = p3.add_run()
    r3.text = "Ships on by default · live BOD·COD & weather · your screenshots only"
    set_run(r3, size=13, bold=False, color=MUTED)

    p4 = tf.add_paragraph()
    p4.alignment = PP_ALIGN.CENTER
    r4 = p4.add_run()
    r4.text = "Thank you — Planet Eye · River Eye"
    set_run(r4, size=15, bold=True, color=TEAL)


def main():
    for feat in FEATURES:
        must(feat["file"])

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    title_slide(prs)
    for feat in FEATURES:
        feature_slide(prs, feat)
    end_slide(prs)

    prs.save(OUT)
    print(f"Wrote {OUT} ({2 + len(FEATURES)} slides) using only {SHOTS}")


if __name__ == "__main__":
    main()
