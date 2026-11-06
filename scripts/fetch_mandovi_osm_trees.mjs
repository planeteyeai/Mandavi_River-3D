/**
 * Fetch OSM tree nodes + tree_row ways for Mandovi corridor bbox.
 * Writes public/data/mandovi/osm_mandovi_trees.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../public/data/mandovi/osm_mandovi_trees.json");

const BOUNDS = { west: 73.76, south: 15.46, east: 73.895, north: 15.535 };

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

function sampleTreeRow(el, spacingM = 8) {
  const geom = el.geometry || [];
  if (geom.length < 2) return [];
  const tags = el.tags || {};
  const out = [];
  let carry = 0;
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1];
    const b = geom[i];
    const dx = (b.lon - a.lon) * 107270;
    const dy = (b.lat - a.lat) * 110540;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    let t = (spacingM - carry) / len;
    while (t <= 1) {
      out.push({
        id: `row_${el.id}_${out.length}`,
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        natural: "tree",
        genus: tags.genus || null,
        species: tags.species || null,
        leaf_type: tags.leaf_type || null,
        heightM: tags.height ? Number(tags.height) : null,
        from_tree_row: true,
        source: "OPENSTREETMAP",
      });
      t += spacingM / len;
    }
    carry = (carry + len) % spacingM;
  }
  return out;
}

async function queryOnce(url) {
  const b = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
  const q = `[out:json][timeout:90];
(
  node["natural"="tree"](${b});
  node["natural"="shrub"](${b});
  way["natural"="tree_row"](${b});
);
out body geom;`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  let data = null;
  for (const url of ENDPOINTS) {
    try {
      console.info("[fetch] try", url);
      data = await queryOnce(url);
      break;
    } catch (err) {
      console.warn("[fetch]", err?.message || err);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  if (!data) throw new Error("Overpass unavailable");

  const trees = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    if (el.type === "node" && (tags.natural === "tree" || tags.natural === "shrub")) {
      trees.push({
        id: el.id,
        lon: el.lon,
        lat: el.lat,
        natural: tags.natural,
        genus: tags.genus || null,
        species: tags.species || null,
        leaf_type: tags.leaf_type || null,
        heightM: tags.height ? Number(tags.height) : null,
        source: "OPENSTREETMAP",
      });
    } else if (el.type === "way" && tags.natural === "tree_row") {
      trees.push(...sampleTreeRow(el));
    }
  }

  const payload = {
    metadata: {
      source: "OpenStreetMap",
      attribution: "© OpenStreetMap contributors",
      river: "Mandovi River, Goa, India",
      bounds: BOUNDS,
      fetchedAt: new Date().toISOString(),
      counts: { trees: trees.length },
    },
    trees,
    buildings: [],
    landuse: [],
  };
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.info("[fetch] wrote", outPath, "trees=", trees.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
