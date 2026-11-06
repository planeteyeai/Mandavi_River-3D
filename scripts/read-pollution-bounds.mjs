import fs from "fs";

const files = [
  "public/data/mandovi/WATERQ-Pollution/coliform_ecoli_class (1).kml",
  "public/data/mandovi/WATERQ-Pollution/nitrogen_risk_class (1).kml",
  "public/data/mandovi/WATERQ-Pollution/eutrophication_trophic_class (1).kml",
];

function tag(text, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>\\s*([^<]+)`, "i");
  return text.match(re)?.[1]?.trim() ?? null;
}

for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  console.log(f.split("/").pop(), {
    north: tag(t, "north"),
    south: tag(t, "south"),
    east: tag(t, "east"),
    west: tag(t, "west"),
    sizeMB: (fs.statSync(f).size / 1e6).toFixed(2),
  });
}
