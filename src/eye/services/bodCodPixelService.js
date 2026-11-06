/**
 * Mandovi BOD/COD from pixelwise CSV (lat/lon grid).
 * Source: public/data/mandovi/BOD_COD_pixelwise_latlon.csv
 */
import { interpolateChainage } from "../geo/chainage.js";
import { classFromBod } from "./bodCodService.js";
import { localToLonLat } from "../geo/geoReference.js";

export const BOD_COD_PIXEL_CSV_URL = "/data/mandovi/BOD_COD_pixelwise_latlon.csv";

/** Grid cell size in degrees (~220 m). */
const CELL = 0.002;

/** @type {Promise<{ points: Float64Array, count: number, grid: Map<string, number[]> }> | null} */
let loadPromise = null;
/** @type {{ points: Float64Array, count: number, grid: Map<string, number[]> } | null} */
let cache = null;

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;
}

/**
 * Load + index the pixel CSV once.
 * Packed as [lon, lat, bod, cod] * N in a Float64Array.
 */
export function ensureBodCodPixels() {
  if (cache) return Promise.resolve(cache);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const res = await fetch(BOD_COD_PIXEL_CSV_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error(`BOD/COD CSV HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const vals = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(",");
      if (parts.length < 4) continue;
      const lat = Number(parts[0]);
      const lon = Number(parts[1]);
      const bod = Number(parts[2]);
      const cod = Number(parts[3]);
      if (![lat, lon, bod, cod].every(Number.isFinite)) continue;
      vals.push(lon, lat, bod, cod);
    }
    const count = vals.length >> 2;
    if (!count) throw new Error("BOD/COD CSV has no samples");
    const points = Float64Array.from(vals);
    const grid = new Map();
    for (let i = 0; i < count; i++) {
      const lon = points[i * 4];
      const lat = points[i * 4 + 1];
      const key = cellKey(lon, lat);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
    cache = { points, count, grid };
    console.info(`[bod-cod-csv] loaded ${count} Mandovi pixels`);
    return cache;
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

/**
 * Nearest pixel BOD/COD at WGS84 lon/lat.
 * @returns {{ bod: number, cod: number, distDeg2: number } | null}
 */
export function sampleBodCodAtLonLat(lon, lat) {
  if (!cache || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const { points, grid } = cache;
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  let bestI = -1;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx}:${cy + dy}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const dlon = points[i * 4] - lon;
        const dlat = points[i * 4 + 1] - lat;
        const d2 = dlon * dlon + dlat * dlat;
        if (d2 < bestD) {
          bestD = d2;
          bestI = i;
        }
      }
    }
  }
  if (bestI < 0) return null;
  // Reject if farther than ~1.5 km (0.014°)
  if (bestD > 0.014 * 0.014) return null;
  return {
    bod: points[bestI * 4 + 2],
    cod: points[bestI * 4 + 3],
    distDeg2: bestD,
  };
}

function lonLatForChainage(chainage, meters) {
  const p = interpolateChainage(chainage, meters);
  if (!p) return null;
  if (Number.isFinite(p.lon) && Number.isFinite(p.lat)) {
    return { lon: p.lon, lat: p.lat, meters: p.meters, x: p.x, z: p.z };
  }
  if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
    try {
      const ll = localToLonLat(p.x, p.z);
      if (Number.isFinite(ll?.lon) && Number.isFinite(ll?.lat)) {
        return { lon: ll.lon, lat: ll.lat, meters: p.meters, x: p.x, z: p.z };
      }
    } catch {
      /* geo frame not ready */
    }
  }
  return null;
}

/**
 * Sample BOD/COD at a river chainage (nearest pixel to that station).
 * @returns {{ bod: number, cod: number, meters: number } | null}
 */
export function sampleBodCodAtChainage(chainage, meters) {
  const ll = lonLatForChainage(chainage, meters);
  if (!ll) return null;
  const hit = sampleBodCodAtLonLat(ll.lon, ll.lat);
  if (!hit) return null;
  return { bod: hit.bod, cod: hit.cod, meters: ll.meters ?? meters };
}

/**
 * Build a JalNetra-compatible BOD/COD payload from the pixel CSV + chainage.
 * Used by ribbon HUD / layer when the live API is unavailable.
 */
export async function buildMandoviBodCodFromCsv(chainage) {
  await ensureBodCodPixels();
  const chain = Array.isArray(chainage) ? chainage : [];
  if (chain.length < 2) throw new Error("BOD/COD CSV needs chainage geometry");

  const first = chain[0].meters ?? 0;
  const last = chain[chain.length - 1].meters ?? first;
  const stepM = 500;
  const reaches = [];
  let reachIdx = 0;

  for (let m0 = first; m0 < last - 1; m0 += stepM) {
    const m1 = Math.min(last, m0 + stepM);
    const bods = [];
    const cods = [];
    for (let m = m0; m <= m1; m += 50) {
      const s = sampleBodCodAtChainage(chain, m);
      if (!s) continue;
      bods.push(s.bod);
      cods.push(s.cod);
    }
    if (!bods.length) continue;
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const bod = mean(bods);
    const cod = mean(cods);
    const cls = classFromBod(bod);
    const km0 = m0 / 1000;
    const km1 = m1 / 1000;
    reachIdx += 1;
    reaches.push({
      id: `M${String(reachIdx).padStart(2, "0")}`,
      name: `${km0.toFixed(1)}–${km1.toFixed(1)} km`,
      km: [km0, km1],
      today: {
        p10: bod * 0.92,
        p50: bod,
        p90: bod * 1.08,
        cod_p10: cod * 0.92,
        cod_p50: cod,
        cod_p90: cod * 1.08,
        cls,
        support: "sat",
        tier: "Observed",
      },
      history: {
        dates: [new Date().toISOString()],
        p10: [bod * 0.92],
        p50: [bod],
        p90: [bod * 1.08],
        cod_p10: [cod * 0.92],
        cod_p50: [cod],
        cod_p90: [cod * 1.08],
        support: ["sat"],
      },
      forecast: { dates: [], p10: [], p50: [], p90: [], cod_p10: [], cod_p50: [], cod_p90: [] },
    });
  }

  if (!reaches.length) throw new Error("BOD/COD CSV produced no reaches along chainage");

  return {
    river_name: "Mandovi",
    tagline: "Pixel BOD/COD (Mandovi survey grid)",
    generated: new Date().toISOString(),
    bod_edges: [2, 3, 6, 10],
    class_colors: {
      A: "#2E7DD1",
      B: "#3AA76D",
      C: "#E3C51E",
      D: "#E08A2E",
      E: "#D14B3A",
    },
    reaches,
    alerts: [],
    _source: "mandovi-csv",
    _viewerId: "mandovi-pixel-csv",
  };
}

/** True when the Mandovi pixel CSV is available (cached after first successful load). */
export function hasBodCodPixels() {
  return !!cache?.count;
}
