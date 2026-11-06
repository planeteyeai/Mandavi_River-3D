import fs from "node:fs";
import { PNG } from "pngjs";

const buf = fs.readFileSync("public/data/mandovi/live_water_extent.png");
const png = PNG.sync.read(buf);
const hist = new Map();
let waterish = 0;
let opaque = 0;
let aHist = new Map();

for (let i = 0; i < png.width * png.height; i++) {
  const p = i * 4;
  const r = png.data[p];
  const g = png.data[p + 1];
  const b = png.data[p + 2];
  const a = png.data[p + 3];
  if (a > 20) opaque++;
  const aBucket = Math.floor(a / 32) * 32;
  aHist.set(aBucket, (aHist.get(aBucket) || 0) + 1);
  const key =
    a < 20
      ? "trans"
      : [Math.floor(r / 16) * 16, Math.floor(g / 16) * 16, Math.floor(b / 16) * 16].join(",");
  hist.set(key, (hist.get(key) || 0) + 1);
  if (a >= 20 && b > 60 && b >= r && b >= g && (b - r >= 12 || b - g >= 8)) waterish++;
}

const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log({
  w: png.width,
  h: png.height,
  opaque,
  waterish,
  coveragePct: ((100 * waterish) / (png.width * png.height)).toFixed(2),
  top,
  aHist: [...aHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
});
