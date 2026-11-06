/**
 * Climate impact for the uploaded river.
 * Periods and areas come from JalNetra POST /api/flood-water for that KML.
 * Heat points are sampled from that scene's flood overlay, not a fixed city file.
 */

import { downloadText, kmlDownloadUrl, waitForEndpoint } from "../session/jalnetraClient.js";
import { getRiverSession } from "../session/riverSession.js";
import { riverFingerprint, riverIsMulaMutha } from "./areaLive.js";

const REMOTE_BASE = "https://rivereye-production.up.railway.app";

/** Override with VITE_RIVEREYE_ASSET_BASE to force remote (needs CORS) or a proxy. */
export const CLIMATE_IMPACT_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_RIVEREYE_ASSET_BASE) ||
  null;

function appBase() {
  const b =
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  return String(b).endsWith("/") ? String(b) : `${b}/`;
}

/** @type {object | null} */
let indexCache = null;
/** @type {Map<string, object>} */
const periodCache = new Map();

/**
 * @returns {Promise<{
 *   name:string, note:string, bounds:object, default_period:number,
 *   classes:{ water:{label:string,color:string}, flood:{label:string,color:string} },
 *   periods: Array<{
 *     id:number, pre_date:string, post_date:string,
 *     water_area_ha:number, flood_area_ha:number,
 *     n_flood:number, n_water:number, points:string, label:string
 *   }>
 * }>}
 */
export async function fetchClimateImpactIndex() {
  const session = getRiverSession();
  const key = riverFingerprint(session);
  if (indexCache?._key === key && indexCache.periods?.length) return indexCache;

  let body = session.results?.["flood-water"] || null;
  if (!body && session.pending?.["flood-water"] !== false) {
    body = await waitForEndpoint("flood-water", 120000);
  }
  const errText = session.errors?.["flood-water"];
  const rows = Array.isArray(body?.datewise) ? body.datewise : [];
  if (!rows.length) {
    throw new Error(errText || "No flood scenes for this river in the selected dates");
  }

  const periods = rows.map((row, id) => ({
    id,
    pre_date: row.pre_date || row.date || "",
    post_date: row.post_date || row.date || "",
    water_area_ha: numberOrNull(row.water_area_ha),
    flood_area_ha: numberOrNull(row.flood_area_ha),
    kml_id: row.kml_id || null,
    kml_download_url: row.kml_download_url || null,
    label: formatPeriodLabel(row.pre_date || row.date, row.post_date || row.date),
  })).filter((p) => p.kml_id || p.kml_download_url);

  if (!periods.length) throw new Error("Flood scenes for this river have no map");

  const data = {
    _key: key,
    name: session.riverName || "River",
    note: "JalNetra flood water for this river",
    default_period: periods[periods.length - 1].id,
    classes: {
      flood: { label: "Flood water", color: "#c2372a" },
      water: { label: "Surface water", color: "#2f9bd6" },
    },
    periods,
  };
  indexCache = data;
  periodCache.clear();
  return data;
}

/**
 * Period points sampled from this river's flood overlay.
 * @param {number} periodId
 */
export async function fetchClimateImpactPeriod(periodId) {
  const index = await fetchClimateImpactIndex();
  const id = Number(periodId);
  const period = index.periods.find((p) => p.id === id) || index.periods[0];
  if (!period) throw new Error("Climate period not found");
  const cacheKey = `${index._key}:${period.id}`;
  if (periodCache.has(cacheKey)) return periodCache.get(cacheKey);

  const href = kmlDownloadUrl("flood-water", period.kml_download_url || period.kml_id);
  if (!href) throw new Error("Flood scene has no download link");
  const kml = await downloadText(href);
  const overlay = parseOverlay(kml);
  const sampled = await sampleOverlay(overlay);
  const payload = {
    periodId: period.id,
    period,
    flood: sampled.flood,
    water: sampled.water,
    classes: index.classes,
  };
  periodCache.set(cacheKey, payload);
  return payload;
}

export function formatPeriodLabel(pre, post) {
  try {
    const a = new Date(`${pre}T12:00:00Z`);
    const b = new Date(`${post}T12:00:00Z`);
    const sameMonth = a.getUTCMonth() === b.getUTCMonth();
    const fmtDay = (d) => d.getUTCDate();
    const fmtMon = (d) =>
      d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
    if (sameMonth) {
      return `${fmtDay(a)}–${fmtDay(b)} ${fmtMon(a)}`;
    }
    return `${fmtDay(a)} ${fmtMon(a)}–${fmtDay(b)} ${fmtMon(b)}`;
  } catch {
    return `${pre} → ${post}`;
  }
}

/**
 * @param {string} path
 * @param {number} periodId
 * @param {boolean} preferLocal
 */
function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOverlay(kmlText) {
  const box = {};
  for (const key of ["north", "south", "east", "west"]) {
    const m = String(kmlText).match(new RegExp(`<(?:\\w+:)?${key}>\\s*([\\d.+-eE]+)\\s*<\\/(?:\\w+:)?${key}>`, "i"));
    if (m) box[key] = Number(m[1]);
  }
  if (![box.north, box.south, box.east, box.west].every((n) => Number.isFinite(n))) {
    throw new Error("Flood overlay is missing its map bounds");
  }
  const hrefM = String(kmlText).match(/<(?:\w+:)?href>\s*([^<]+?)\s*<\/(?:\w+:)?href>/i);
  const href = (hrefM?.[1] || "").replace(/\s+/g, "");
  if (!/^data:image\//i.test(href)) throw new Error("Flood overlay has no image");
  return { ...box, imageDataUrl: href };
}

function floodPixel(r, g, b, a) {
  if (a < 8) return false;
  if (r >= 120 && r > g + 25 && r > b + 25) return true;
  return r >= 150 && g <= 110 && b <= 130 && r >= g && r >= b;
}

function waterPixel(r, g, b, a) {
  if (a < 8 || floodPixel(r, g, b, a)) return false;
  return b >= 90 && b > r + 20 && b >= g - 15;
}

function sampleOverlay(overlay) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const lonSpan = overlay.east - overlay.west;
      const latSpan = overlay.north - overlay.south;
      const target = 1600;
      const stride = Math.max(1, Math.round(Math.sqrt((width * height) / target)));
      const flood = [];
      const water = [];
      for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
          const i = (y * width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          const isFlood = floodPixel(r, g, b, a);
          const isWater = !isFlood && waterPixel(r, g, b, a);
          if (!isFlood && !isWater) continue;
          const lon = overlay.west + ((x + 0.5) / width) * lonSpan;
          const lat = overlay.north - ((y + 0.5) / height) * latSpan;
          if (isFlood) flood.push([lon, lat]);
          else water.push([lon, lat]);
        }
      }
      resolve({ flood, water });
    };
    img.onerror = () => reject(new Error("Could not read this river's flood image"));
    img.src = overlay.imageDataUrl;
  });
}

export function clearClimateImpactCache() {
  indexCache = null;
  periodCache.clear();
  wrdCache = null;
}

/** WRD survey flood/bank lines (blue / red / green). Independent of image period. */
const WRD_FILE = "mula-mutha-wrd-floodlines.geojson";

/** @type {object | null} */
let wrdCache = null;

export const WRD_FLOODLINE_LEGEND = [
  { id: "blue", label: "Blue flood line", color: "#1565c0", kind: "survey" },
  { id: "red", label: "Red flood line", color: "#c62828", kind: "survey" },
  { id: "green", label: "Green bank line", color: "#2e7d32", kind: "survey" },
];

/**
 * @returns {Promise<{
 *   type:string,
 *   features: Array<{
 *     line:string, color:string, sheet_title?:string, note?:string,
 *     coordinates:number[][]
 *   }>
 * }>}
 */
export async function fetchWrdFloodLines() {
  if (!riverIsMulaMutha()) {
    return { type: "FeatureCollection", features: [] };
  }
  if (wrdCache) return wrdCache;
  const urls = [
    `${appBase()}data/hydrology/climate/${WRD_FILE}`,
  ];
  if (CLIMATE_IMPACT_BASE) {
    urls.push(
      `${String(CLIMATE_IMPACT_BASE).replace(/\/$/, "")}/asset/${WRD_FILE}`,
    );
  }
  urls.push(`${REMOTE_BASE}/asset/${WRD_FILE}`);

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`WRD flood lines HTTP ${res.status}`);
      const text = await res.text();
      // Vite SPA fallback returns HTML when a public asset is watcher-ignored
      if (/^\s*</.test(text)) {
        throw new Error(`WRD asset returned HTML instead of GeoJSON (${url})`);
      }
      const raw = JSON.parse(text);
      const features = [];
      for (const f of raw?.features || []) {
        const geom = f?.geometry;
        if (!geom) continue;
        const rings =
          geom.type === "MultiLineString"
            ? geom.coordinates
            : geom.type === "LineString"
              ? [geom.coordinates]
              : [];
        for (const coords of rings) {
          if (!Array.isArray(coords) || coords.length < 2) continue;
          const line = String(f?.properties?.line || "").toLowerCase();
          const color =
            f?.properties?.color ||
            WRD_FLOODLINE_LEGEND.find((x) => x.id === line)?.color ||
            "#888888";
          features.push({
            line: line || "unknown",
            color,
            sheet_title: f?.properties?.sheet_title || "",
            note: f?.properties?.note || "",
            coordinates: coords
              .map((c) => [Number(c[0]), Number(c[1])])
              .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)),
          });
        }
      }
      if (!features.length) throw new Error("WRD flood lines empty");
      wrdCache = {
        type: "FeatureCollection",
        name: raw?.name || "WRD flood lines",
        features,
        legend: WRD_FLOODLINE_LEGEND,
      };
      return wrdCache;
    } catch (err) {
      lastErr = err;
      console.warn("[climate-impact] WRD fetch failed", url, err?.message || err);
    }
  }
  throw lastErr || new Error("WRD flood lines unavailable");
}
