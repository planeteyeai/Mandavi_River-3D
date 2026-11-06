// ============================================================
// Chainage Utilities — master navigation system
// All chainage operations go through here.
// ============================================================

/**
 * Format a chainage in metres to "K+MMM" notation.
 * e.g. formatChainage(4000) => "4+000"
 */
export function formatChainage(chainageM) {
  const metres = Math.round(Number(chainageM) || 0);
  const km = Math.floor(metres / 1000);
  const remainder = String(metres % 1000).padStart(3, "0");
  return `${km}+${remainder}`;
}

/**
 * Find index of the station nearest to chainageM.
 */
export function getNearestStationIndex(data, chainageM) {
  const chainages = data.chainage_m || data.chainage || [];
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < chainages.length; i++) {
    const d = Math.abs(chainages[i] - chainageM);
    if (d < bestDistance) { bestDistance = d; bestIndex = i; }
  }
  return bestIndex;
}

/**
 * Return a full station object for the nearest station to chainageM.
 */
export function getStationAtChainage(data, chainageM) {
  const index = getNearestStationIndex(data, chainageM);
  const chainages = data.chainage_m || data.chainage || [];
  return {
    index,
    chainageM: chainages[index] ?? chainageM,
    chainageKm: (chainages[index] ?? chainageM) / 1000,
    lat: (data.lat || data.latitude || [])[index] ?? null,
    lon: (data.lon || data.longitude || [])[index] ?? null,
    width: (data.real_width_m || data.width_m || data.width || [])[index] ?? null,
    depth: (data.real_depth_m || data.depth_m || data.depth || [])[index] ?? null,
    flagged: (data.depth_flagged || [])[index] ?? false,
  };
}

/**
 * Return the total reach length in metres from the dataset.
 */
export function getReachLength(data) {
  const vals = data.chainage_m || data.chainage || [];
  if (!vals.length) return 0;
  return Math.max(...vals);
}

/**
 * Generate tick positions for the slider (every tickInterval metres).
 */
export function generateTicks(maxM, tickInterval = 2000) {
  const ticks = [];
  for (let v = 0; v <= maxM; v += tickInterval) ticks.push(v);
  return ticks;
}

import { geoToWorld } from "../eye/geo/geoReference.js";

/**
 * Convert geographic lon/lat to local metric XZ coordinates.
 * Uses shared geoToWorld service when initialized, matching all 3D layers.
 */
export function lonLatToLocal(lon, lat, originLon, originLat) {
  try {
    const pt = geoToWorld(lon, lat);
    if (Number.isFinite(pt.x) && Number.isFinite(pt.z)) {
      return { x: pt.x, z: pt.z };
    }
  } catch {}
  const cosLat = Math.cos(((originLat || 15.5) * Math.PI) / 180);
  const x = (lon - (originLon || 73.83)) * cosLat * 111320;
  const z = (lat - (originLat || 15.5)) * 110540;
  return { x, z };
}
