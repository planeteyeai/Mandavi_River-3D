import fs from "fs";

const src = "public/data/mandovi/WATERQ-Pollution/nitrogen_risk_class (1).kml";
const t = fs.readFileSync(src, "utf8");
const m = t.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
if (!m) {
  console.error("no png");
  process.exit(1);
}
const b64 = m[1].replace(/\s+/g, "");
const buf = Buffer.from(b64, "base64");
fs.writeFileSync("scripts/_nitrogen_preview.png", buf);
const w = buf.readUInt32BE(16);
const h = buf.readUInt32BE(20);
console.log({ bytes: buf.length, w, h, mb: (buf.length / 1e6).toFixed(2) });

// sample opaque pixel ratio via pngjs if available, else skip
try {
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(buf);
  let opaque = 0;
  let colored = 0;
  const step = 16;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (png.width * y + x) << 2;
      const a = png.data[i + 3];
      if (a > 20) {
        opaque++;
        if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 30) colored++;
      }
    }
  }
  const samples = Math.ceil(png.width / step) * Math.ceil(png.height / step);
  console.log({
    samples,
    opaque,
    colored,
    opaquePct: ((opaque / samples) * 100).toFixed(2),
  });
} catch (e) {
  console.log("png sample skip", e.message);
}
