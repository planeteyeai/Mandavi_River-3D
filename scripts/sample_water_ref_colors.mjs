import fs from "node:fs";
import { PNG } from "pngjs";

const p =
  "C:/Users/Sahil.Rajankar/.cursor/projects/c-Users-Sahil-Rajankar-Desktop-Shweta-Mnadavi-River/assets/c__Users_Sahil.Rajankar_AppData_Roaming_Cursor_User_workspaceStorage_bb95689ac639b8521ca269683988066c_images_image-b8f014e0-1a8e-4e27-ad8f-70f3087cc05e.png";
const png = PNG.sync.read(fs.readFileSync(p));
const hex = (r, g, b) =>
  "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

const samples = [
  [0.2, 0.3],
  [0.5, 0.4],
  [0.7, 0.5],
  [0.3, 0.6],
  [0.8, 0.3],
  [0.15, 0.5],
  [0.6, 0.7],
  [0.4, 0.2],
];
for (const [u, v] of samples) {
  const x = Math.floor(u * png.width);
  const y = Math.floor(v * png.height);
  const i = (png.width * y + x) * 4;
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  console.log(u, v, `rgb(${r},${g},${b})`, hex(r, g, b));
}

let sr = 0;
let sg = 0;
let sb = 0;
let n = 0;
let minB = Infinity;
let maxB = 0;
const hist = new Map();
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r + g + b < 90) continue;
    if (!(b > r && b > 70)) continue;
    sr += r;
    sg += g;
    sb += b;
    n++;
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
    const key = hex((r / 16) | 0 << 4, (g / 16) | 0 << 4, (b / 16) | 0 << 4);
    // bucket
    const bk = `${(r / 20) | 0},${(g / 20) | 0},${(b / 20) | 0}`;
    hist.set(bk, (hist.get(bk) || 0) + 1);
  }
}
console.log("avg", n, hex((sr / n) | 0, (sg / n) | 0, (sb / n) | 0));
console.log("b range", minB, maxB);
console.log(
  "top buckets",
  [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, c]) => {
      const [r, g, b] = k.split(",").map((x) => Number(x) * 20 + 10);
      return [hex(r, g, b), c];
    }),
);
