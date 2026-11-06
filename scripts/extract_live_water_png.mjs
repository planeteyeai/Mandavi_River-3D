import fs from "node:fs";
import path from "node:path";

const kmlPath = path.resolve("public/data/mandovi/live_water_mandavi.kml");
const outPath = path.resolve("public/data/mandovi/live_water_extent.png");
const t = fs.readFileSync(kmlPath, "utf8");

const box = {};
for (const key of ["north", "south", "east", "west"]) {
  const m = t.match(new RegExp(`<(?:ns0:)?${key}>\\s*([^<]+)\\s*</(?:ns0:)?${key}>`, "i"));
  if (m) box[key] = Number(m[1].trim());
}

const m = t.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
if (!m) {
  console.error("No embedded PNG found in KML");
  process.exit(1);
}
const buf = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
fs.writeFileSync(outPath, buf);
fs.writeFileSync(
  path.resolve("public/data/mandovi/live_water_extent.json"),
  JSON.stringify(
    {
      sourceKml: "public/data/mandovi/live_water_mandavi.kml",
      overlay: "/data/mandovi/live_water_extent.png",
      bounds: box,
      extractedBytes: buf.length,
      extractedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.info("Extracted", outPath, buf.length, "bytes", box);
