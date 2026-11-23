/**
 * Rank Mandovi pollution hotspots from ALL real pollution sources:
 *   BOD/COD CSV + Eutrophication KML + Nitrogen KML + Coliform KML
 * Highest / thickest zones get deeper red shades. No invented numbers.
 */
import fs from "fs";
import { PNG } from "pngjs";

const SIDES = [
  { id: "miramar_aguada", name: "Miramar / Aguada Bay", lon: 73.80504, lat: 15.48367 },
  { id: "reis_magos_betim", name: "Reis Magos / Betim", lon: 73.8115, lat: 15.4965 },
  { id: "panaji", name: "Panaji / Santa Monica", lon: 73.82821, lat: 15.50186 },
  { id: "ribandar", name: "Ribandar", lon: 73.8455, lat: 15.5052 },
  { id: "chorao_chimbel", name: "Chorao / Chimbel", lon: 73.86206, lat: 15.50445 },
  { id: "old_goa_divar", name: "Old Goa / Divar", lon: 73.8805, lat: 15.5038 },
];

/**
 * Official legend numbers from the Mandovi WATERQ KML / GEE export script.
 * KML pixels are class colours only — ranges below are the source legend, not invented.
 */
const KML_LAYERS = [
  {
    id: "eutrophication",
    label: "Eutrophication",
    unit: "µg/L Chl-a · TSI",
    path: "public/data/mandovi/WATERQ-Pollution/eutrophication_trophic_class (1).kml",
    classes: [
      {
        id: "oligo",
        label: "Oligotrophic",
        color: "#2c7bb6",
        severity: 0.15,
        valueText: "< 2.6 µg/L",
        range: { chlUgL: [null, 2.6], tsi: [null, 40] },
        display: "< 2.6 µg/L (TSI < 40)",
      },
      {
        id: "meso",
        label: "Mesotrophic",
        color: "#abd9e9",
        severity: 0.35,
        valueText: "2.6–7.3 µg/L",
        range: { chlUgL: [2.6, 7.3], tsi: [40, 50] },
        display: "2.6–7.3 µg/L (TSI 40–50)",
      },
      {
        id: "eutro",
        label: "Eutrophic",
        color: "#fdae61",
        severity: 0.7,
        valueText: "7.3–56 µg/L",
        range: { chlUgL: [7.3, 56], tsi: [50, 70] },
        display: "7.3–56 µg/L (TSI 50–70)",
      },
      {
        id: "hyper",
        label: "Hypereutrophic",
        color: "#d7191c",
        severity: 1,
        valueText: "> 56 µg/L",
        range: { chlUgL: [56, null], tsi: [70, null] },
        display: "> 56 µg/L (TSI > 70)",
      },
    ],
  },
  {
    id: "nitrogen",
    label: "Nitrogen",
    unit: "risk class (not mg N/L)",
    note: "KML is high-nitrogen risk class — not concentration. Mandovi file: High class pixels = 0.",
    path: "public/data/mandovi/WATERQ-Pollution/nitrogen_risk_class (1).kml",
    classes: [
      {
        id: "low",
        label: "Low",
        color: "#1a9641",
        severity: 0.2,
        classIndex: 1,
        classOf: 3,
        valueText: "1 / 3",
        display: "Low risk (class 1 of 3)",
      },
      {
        id: "moderate",
        label: "Moderate",
        color: "#ffffbf",
        severity: 0.55,
        classIndex: 2,
        classOf: 3,
        valueText: "2 / 3",
        display: "Moderate risk (class 2 of 3)",
      },
      {
        id: "high",
        label: "High",
        color: "#d7191c",
        severity: 1,
        classIndex: 3,
        classOf: 3,
        valueText: "3 / 3",
        display: "High risk (class 3 of 3)",
      },
    ],
  },
  {
    id: "coliform",
    label: "Coliform",
    unit: "CFU/100 ml",
    path: "public/data/mandovi/WATERQ-Pollution/coliform_ecoli_class (1).kml",
    classes: [
      {
        id: "good",
        label: "Good",
        color: "#2c7bb6",
        severity: 0.15,
        valueText: "≤ 250",
        range: { cfu: [null, 250] },
        display: "≤ 250 CFU/100 ml",
      },
      {
        id: "moderate",
        label: "Moderate",
        color: "#91cf60",
        severity: 0.4,
        valueText: "260–500",
        range: { cfu: [260, 500] },
        display: "260–500 CFU/100 ml",
      },
      {
        id: "high",
        label: "High",
        color: "#fdae61",
        severity: 0.75,
        valueText: "500–2000",
        range: { cfu: [500, 2000] },
        display: "500–2000 CFU/100 ml",
      },
      {
        id: "highly_risk",
        label: "Highly risk",
        color: "#d7191c",
        severity: 1,
        valueText: "> 2000",
        range: { cfu: [2000, null] },
        display: "> 2000 CFU/100 ml",
      },
    ],
  },
];

/** Red shade ramp — light → deepest red by combined severity. */
const RED_SHADES = [
  { id: "light", label: "Elevated", hex: "#FF8A80", min: 0, max: 0.35 },
  { id: "medium", label: "High", hex: "#EF5350", min: 0.35, max: 0.55 },
  { id: "strong", label: "Very High", hex: "#E53935", min: 0.55, max: 0.75 },
  { id: "severe", label: "Severe", hex: "#C62828", min: 0.75, max: 0.9 },
  { id: "extreme", label: "Extreme", hex: "#8B0000", min: 0.9, max: 1.01 },
];

function nearestSide(lon, lat) {
  let best = SIDES[0];
  let bestD = Infinity;
  for (const s of SIDES) {
    const d = (s.lon - lon) ** 2 + (s.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function classFromRgb(r, g, b, classes) {
  let best = null;
  let bestD = Infinity;
  for (const c of classes) {
    const rgb = hexToRgb(c.color);
    const d = (r - rgb.r) ** 2 + (g - rgb.g) ** 2 + (b - rgb.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // Reject near-black / near-transparent noise
  if (bestD > 70 * 70) return null;
  return best;
}

function shadeFor(score01) {
  const s = Math.max(0, Math.min(1, score01));
  return RED_SHADES.find((r) => s >= r.min && s < r.max) || RED_SHADES[RED_SHADES.length - 1];
}

function tag(text, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>\\s*([^<]+)`, "i");
  return text.match(re)?.[1]?.trim() ?? null;
}

function parseKmlOverlay(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const north = Number(tag(text, "north"));
  const south = Number(tag(text, "south"));
  const east = Number(tag(text, "east"));
  const west = Number(tag(text, "west"));
  const m = text.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
  if (!m) throw new Error(`No PNG in ${filePath}`);
  const buf = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
  const png = PNG.sync.read(buf);
  return { north, south, east, west, png, bytes: buf.length };
}

function packClassInfo(layerDef, cls, extra = {}) {
  if (!cls) return null;
  return {
    label: layerDef.label,
    classId: cls.id,
    classLabel: cls.label,
    severity: cls.severity,
    unit: layerDef.unit || "",
    valueText: cls.valueText || cls.label,
    display: cls.display || cls.label,
    range: cls.range || null,
    classIndex: cls.classIndex ?? null,
    classOf: cls.classOf ?? null,
    ...extra,
  };
}

/** Sample class at WGS84 lon/lat from a parsed overlay (3×3 majority). */
function sampleOverlayAt(overlay, layerDef, lon, lat) {
  const { north, south, east, west, png } = overlay;
  if (!(east > west) || !(north > south)) return null;
  const u = (lon - west) / (east - west);
  const v = (north - lat) / (north - south);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const cx = Math.round(u * (png.width - 1));
  const cy = Math.round(v * (png.height - 1));

  function voteAt(px, py, rad = 1) {
    const votes = new Map();
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = Math.max(0, Math.min(png.width - 1, px + dx));
        const y = Math.max(0, Math.min(png.height - 1, py + dy));
        const i = (png.width * y + x) << 2;
        if (png.data[i + 3] < 40) continue;
        const cls = classFromRgb(png.data[i], png.data[i + 1], png.data[i + 2], layerDef.classes);
        if (!cls) continue;
        votes.set(cls.id, (votes.get(cls.id) || 0) + 1);
      }
    }
    if (!votes.size) return null;
    let bestId = null;
    let bestN = -1;
    for (const [id, n] of votes) {
      if (n > bestN) {
        bestN = n;
        bestId = id;
      }
    }
    const cls = layerDef.classes.find((c) => c.id === bestId);
    return packClassInfo(layerDef, cls, { pixelCount: bestN, sampledAt: { lon, lat } });
  }

  let hit = voteAt(cx, cy, 1) || voteAt(cx, cy, 3);
  if (hit) return hit;

  // Search outward for nearest classified water pixel (~±40 px ≈ local neighbourhood).
  let best = null;
  let bestD = Infinity;
  for (let rad = 4; rad <= 40; rad += 2) {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < rad - 1) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const i = (png.width * y + x) << 2;
        if (png.data[i + 3] < 40) continue;
        const cls = classFromRgb(png.data[i], png.data[i + 1], png.data[i + 2], layerDef.classes);
        if (!cls) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          const lonHit = west + (x / (png.width - 1)) * (east - west);
          const latHit = north - (y / (png.height - 1)) * (north - south);
          best = packClassInfo(layerDef, cls, {
            pixelCount: 1,
            sampledAt: { lon: +lonHit.toFixed(6), lat: +latHit.toFixed(6) },
            nearestPx: Math.round(Math.sqrt(d)),
          });
        }
      }
    }
    if (best) break;
  }
  return best;
}

/**
 * Sample high-severity class pixels from a pollution KML overlay.
 * Returns weighted hotspot votes in ~0.008° cells.
 */
function sampleKmlLayer(layerDef) {
  const { north, south, east, west, png } = parseKmlOverlay(layerDef.path);
  const step = Math.max(4, Math.floor(Math.min(png.width, png.height) / 180));
  const cells = new Map();
  let highPixels = 0;
  let sampled = 0;
  const classCounts = Object.fromEntries(layerDef.classes.map((c) => [c.id, 0]));

  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (png.width * y + x) << 2;
      const a = png.data[i + 3];
      if (a < 40) continue;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (r + g + b < 40) continue;
      sampled++;
      const cls = classFromRgb(r, g, b, layerDef.classes);
      if (!cls) continue;
      classCounts[cls.id] = (classCounts[cls.id] || 0) + 1;
      // Keep elevated+ classes (eutrophic / N-moderate / coliform-high+).
      // Mandovi nitrogen KML currently has no "High" pixels — Moderate still counts.
      if (cls.severity < 0.5) continue;
      highPixels++;
      const u = x / Math.max(1, png.width - 1);
      const v = y / Math.max(1, png.height - 1);
      const lon = west + u * (east - west);
      const lat = north - v * (north - south);
      const lonKey = (Math.floor(lon / 0.008) * 0.008).toFixed(3);
      const latKey = (Math.floor(lat / 0.008) * 0.008).toFixed(3);
      const key = `${lonKey}:${latKey}`;
      let c = cells.get(key);
      if (!c) {
        c = {
          lon: 0,
          lat: 0,
          n: 0,
          severitySum: 0,
          maxSeverity: 0,
          peakLon: lon,
          peakLat: lat,
          classId: cls.id,
          classLabel: cls.label,
          valueText: cls.valueText,
          display: cls.display,
          range: cls.range || null,
          classIndex: cls.classIndex ?? null,
          classOf: cls.classOf ?? null,
        };
        cells.set(key, c);
      }
      c.lon += lon;
      c.lat += lat;
      c.n += 1;
      c.severitySum += cls.severity;
      if (cls.severity > c.maxSeverity) {
        c.maxSeverity = cls.severity;
        c.peakLon = lon;
        c.peakLat = lat;
        c.classId = cls.id;
        c.classLabel = cls.label;
        c.valueText = cls.valueText;
        c.display = cls.display;
        c.range = cls.range || null;
        c.classIndex = cls.classIndex ?? null;
        c.classOf = cls.classOf ?? null;
      }
    }
  }

  return {
    id: layerDef.id,
    label: layerDef.label,
    bounds: { north, south, east, west },
    sampled,
    highPixels,
    classCounts,
    cells,
  };
}

function bodLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 3 ? "good" : v <= 6 ? "moderate" : "high";
}
function codLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 10 ? "good" : v <= 30 ? "moderate" : "high";
}

// ── BOD/COD CSV ─────────────────────────────────────────────
const csvText = fs.readFileSync("public/data/mandovi/BOD_COD_pixelwise_latlon.csv", "utf8");
const csvLines = csvText.split(/\r?\n/).slice(1).filter(Boolean);
const bodPts = [];
let maxBodRow = null;
let maxBod = -1;
let maxCod = -1;

for (const line of csvLines) {
  const [lat, lon, bod, cod] = line.split(",").map(Number);
  if (![lat, lon, bod, cod].every(Number.isFinite)) continue;
  const row = { lat, lon, bod, cod, score: bod / 10 + cod / 30 };
  bodPts.push(row);
  if (bod > maxBod || (bod === maxBod && cod > maxCod)) {
    maxBod = bod;
    maxCod = cod;
    maxBodRow = row;
  }
}
bodPts.sort((a, b) => b.score - a.score);
const bodMaxScore = bodPts[0]?.score || 1;

const bodCells = new Map();
const topBod = bodPts.slice(0, Math.max(80, Math.floor(bodPts.length * 0.05)));
for (const p of topBod) {
  const lonKey = (Math.floor(p.lon / 0.008) * 0.008).toFixed(3);
  const latKey = (Math.floor(p.lat / 0.008) * 0.008).toFixed(3);
  const key = `${lonKey}:${latKey}`;
  let c = bodCells.get(key);
  if (!c) {
    c = {
      lon: 0,
      lat: 0,
      n: 0,
      bod: 0,
      cod: 0,
      maxBod: 0,
      maxCod: 0,
      peakLon: p.lon,
      peakLat: p.lat,
      score: 0,
    };
    bodCells.set(key, c);
  }
  c.lon += p.lon;
  c.lat += p.lat;
  c.n += 1;
  c.bod += p.bod;
  c.cod += p.cod;
  if (p.bod > c.maxBod || (p.bod === c.maxBod && p.cod > c.maxCod)) {
    c.maxBod = p.bod;
    c.maxCod = p.cod;
    c.peakLon = p.lon;
    c.peakLat = p.lat;
    c.score = p.score;
  }
}

// ── KML layers ──────────────────────────────────────────────
console.log("Sampling pollution KMLs…");
const kmlResults = [];
for (const def of KML_LAYERS) {
  const result = sampleKmlLayer(def);
  kmlResults.push(result);
  console.log(def.id, {
    highPixels: result.highPixels,
    cells: result.cells.size,
    classCounts: result.classCounts,
  });
}

// ── Merge all cells ─────────────────────────────────────────
const merged = new Map();

function ensureCell(key, lon, lat) {
  let c = merged.get(key);
  if (!c) {
    c = {
      id: key,
      lon,
      lat,
      layers: {},
      bod: null,
      thickness: 0,
      composite: 0,
    };
    merged.set(key, c);
  }
  return c;
}

for (const [key, c] of bodCells) {
  const cell = ensureCell(key, c.peakLon, c.peakLat);
  cell.bod = {
    maxBod: +c.maxBod.toFixed(3),
    maxCod: +c.maxCod.toFixed(3),
    meanBod: +(c.bod / c.n).toFixed(3),
    meanCod: +(c.cod / c.n).toFixed(3),
    pixelCount: c.n,
    score01: Math.min(1, c.score / bodMaxScore),
    bodLevel: bodLevel(c.maxBod),
    codLevel: codLevel(c.maxCod),
  };
  cell.thickness += c.n;
  cell.lon = c.peakLon;
  cell.lat = c.peakLat;
}

for (const layer of kmlResults) {
  for (const [key, c] of layer.cells) {
    const cell = ensureCell(key, c.peakLon, c.peakLat);
    const sev01 = c.maxSeverity;
    const clsDef = KML_LAYERS.find((d) => d.id === layer.id)?.classes.find((x) => x.id === c.classId);
    cell.layers[layer.id] = packClassInfo(
      KML_LAYERS.find((d) => d.id === layer.id),
      clsDef || {
        id: c.classId,
        label: c.classLabel,
        severity: sev01,
        valueText: c.valueText,
        display: c.display,
        range: c.range,
        classIndex: c.classIndex,
        classOf: c.classOf,
      },
      {
        severity: +sev01.toFixed(3),
        pixelCount: c.n,
        meanSeverity: +(c.severitySum / c.n).toFixed(3),
      },
    );
    cell.thickness += c.n;
    // Keep BOD peak coordinates when BOD exists (measured mg/L site).
    if (!cell.bod) {
      cell.lon = c.peakLon;
      cell.lat = c.peakLat;
    }
  }
}

const WEIGHTS = {
  bod: 0.3,
  eutrophication: 0.25,
  nitrogen: 0.2,
  coliform: 0.25,
};

const hotspots = [...merged.values()]
  .map((c) => {
    const parts = [];
    let wSum = 0;
    let sSum = 0;
    if (c.bod) {
      parts.push({ id: "bod_cod", label: "BOD–COD", score: c.bod.score01, weight: WEIGHTS.bod });
      sSum += c.bod.score01 * WEIGHTS.bod;
      wSum += WEIGHTS.bod;
    }
    for (const lid of ["eutrophication", "nitrogen", "coliform"]) {
      const L = c.layers[lid];
      if (!L) continue;
      parts.push({
        id: lid,
        label: L.label,
        score: L.severity,
        weight: WEIGHTS[lid],
        classLabel: L.classLabel,
        pixelCount: L.pixelCount,
      });
      sSum += L.severity * WEIGHTS[lid];
      wSum += WEIGHTS[lid];
    }
    if (!wSum) return null;
    const composite = sSum / wSum;
    // Multi-layer agreement + thickness push the deepest red shades.
    const layerBonus = Math.min(0.14, (parts.length - 1) * 0.045);
    const thickBonus = Math.min(0.1, Math.log10(1 + c.thickness) / 35);
    const score01 = Math.min(1, composite + layerBonus + thickBonus);
    const shade = shadeFor(score01);
    const side = nearestSide(c.lon, c.lat);
    return {
      id: c.id,
      rank: 0,
      name: side.name,
      sideId: side.id,
      lon: +c.lon.toFixed(6),
      lat: +c.lat.toFixed(6),
      composite: +score01.toFixed(4),
      shade: shade.id,
      shadeLabel: shade.label,
      color: shade.hex,
      thickness: c.thickness,
      layersPresent: parts.map((p) => p.id),
      layerScores: parts,
      maxBod: c.bod?.maxBod ?? null,
      maxCod: c.bod?.maxCod ?? null,
      meanBod: c.bod?.meanBod ?? null,
      meanCod: c.bod?.meanCod ?? null,
      bodPixelCount: c.bod?.pixelCount ?? 0,
      eutrophication: c.layers.eutrophication || null,
      nitrogen: c.layers.nitrogen || null,
      coliform: c.layers.coliform || null,
    };
  })
  .filter(Boolean)
  // Prefer multi-signal zones; allow single-layer only if extreme class + thick.
  .filter(
    (h) =>
      h.layersPresent.length >= 2 ||
      (h.layersPresent.length === 1 && h.composite >= 0.85 && h.thickness >= 8),
  )
  .sort((a, b) => b.composite - a.composite || b.thickness - a.thickness);

hotspots.forEach((h, i) => {
  h.rank = i + 1;
});

// Point-sample every KML at each hotspot lat/lon so all three layers get real legend numbers.
const overlaysById = new Map();
for (const def of KML_LAYERS) {
  overlaysById.set(def.id, { def, overlay: parseKmlOverlay(def.path) });
}
/** Nearest BOD/COD CSV pixel to lon/lat (full survey grid — not only top 5%). */
function nearestBodCod(lon, lat) {
  let best = null;
  let bestD = Infinity;
  for (const p of bodPts) {
    const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  // Reject if farther than ~1.2 km
  if (!best || bestD > 0.011 * 0.011) return null;
  return best;
}

function enrichPointLayers(h) {
  // Fill missing BOD/COD from nearest survey pixel at this hotspot.
  if (!Number.isFinite(h.maxBod) || !Number.isFinite(h.maxCod)) {
    const hit = nearestBodCod(h.lon, h.lat);
    if (hit) {
      h.maxBod = +hit.bod.toFixed(3);
      h.maxCod = +hit.cod.toFixed(3);
      h.meanBod = h.meanBod ?? h.maxBod;
      h.meanCod = h.meanCod ?? h.maxCod;
      h.bodFilledFrom = "nearest-csv";
      if (!h.layersPresent.includes("bod_cod")) h.layersPresent.push("bod_cod");
    }
  }

  for (const def of KML_LAYERS) {
    const pack = overlaysById.get(def.id);
    const hit = sampleOverlayAt(pack.overlay, def, h.lon, h.lat);
    const prev = h[def.id];
    if (!prev && hit) {
      // Fill missing layer from nearest KML class pixel at this lat/lon.
      h[def.id] = hit;
      if (!h.layersPresent.includes(def.id)) h.layersPresent.push(def.id);
    } else if (prev) {
      // Keep ranked class; attach official legend numbers for that class.
      const cls = def.classes.find((c) => c.id === prev.classId) || def.classes.find((c) => c.label === prev.classLabel);
      if (cls) {
        h[def.id] = {
          ...prev,
          unit: def.unit || prev.unit,
          valueText: cls.valueText,
          display: cls.display,
          range: cls.range || null,
          classIndex: cls.classIndex ?? prev.classIndex ?? null,
          classOf: cls.classOf ?? prev.classOf ?? null,
        };
      }
    }
  }
  h.eutrophicationValue = h.eutrophication?.valueText || h.eutrophication?.display || null;
  h.nitrogenValue = h.nitrogen?.valueText || h.nitrogen?.display || null;
  h.coliformValue = h.coliform?.valueText || h.coliform?.display || null;
}

const top = hotspots.slice(0, 12);
for (const h of top) enrichPointLayers(h);

const peak = top[0];
const peakSide = peak ? nearestSide(peak.lon, peak.lat) : nearestSide(maxBodRow.lon, maxBodRow.lat);
if (peak) enrichPointLayers(peak);

const legendNumbers = Object.fromEntries(
  KML_LAYERS.map((d) => [
    d.id,
    {
      label: d.label,
      unit: d.unit,
      note: d.note || null,
      classes: d.classes.map((c) => ({
        id: c.id,
        label: c.label,
        valueText: c.valueText,
        display: c.display,
        range: c.range || null,
        classIndex: c.classIndex ?? null,
        classOf: c.classOf ?? null,
      })),
    },
  ]),
);

const payload = {
  source: [
    "BOD_COD_pixelwise_latlon.csv",
    "eutrophication_trophic_class (1).kml",
    "nitrogen_risk_class (1).kml",
    "coliform_ecoli_class (1).kml",
  ],
  method:
    "Combined score = weighted BOD/COD (CSV) + Eutrophication + Nitrogen + Coliform (KML class severity). Red shades map composite 0–1. All values from source files — nothing invented.",
  generated: new Date().toISOString(),
  pixelCount: bodPts.length,
  weights: WEIGHTS,
  redShades: RED_SHADES,
  legendNumbers,
  kmlSummaries: kmlResults.map((r) => ({
    id: r.id,
    label: r.label,
    highPixels: r.highPixels,
    sampled: r.sampled,
    classCounts: r.classCounts,
    bounds: r.bounds,
  })),
  highest: peak
    ? {
        name: peakSide.name,
        sideId: peakSide.id,
        lat: peak.lat,
        lon: peak.lon,
        bod: peak.maxBod,
        cod: peak.maxCod,
        composite: peak.composite,
        shade: peak.shade,
        shadeLabel: peak.shadeLabel,
        color: peak.color,
        layers: peak.layerScores,
        eutrophication: peak.eutrophication,
        nitrogen: peak.nitrogen,
        coliform: peak.coliform,
        eutrophicationValue: peak.eutrophicationValue,
        nitrogenValue: peak.nitrogenValue,
        coliformValue: peak.coliformValue,
      }
    : {
        ...maxBodRow,
        name: nearestSide(maxBodRow.lon, maxBodRow.lat).name,
      },
  hotspots: top,
};

fs.writeFileSync("public/data/mandovi/pollution_hotspots.json", JSON.stringify(payload, null, 2));
console.log("\nHighest:", payload.highest.name, payload.highest.composite, payload.highest.color);
console.log(
  "Top:",
  top.map(
    (h) =>
      `#${h.rank} ${h.name} ${h.shadeLabel} ${h.color} score=${h.composite} layers=${h.layersPresent.join("+")} BOD=${h.maxBod ?? "—"} COD=${h.maxCod ?? "—"}`,
  ),
);
console.log("wrote public/data/mandovi/pollution_hotspots.json");
