/**
 * Fuse Sentinel-2 MNDWI (optical live water) + Sentinel-1 SAR (JalNetra permanent water).
 *
 * Fast path: functional sampler (no full-res pixel loop) so the UI never freezes.
 * Optional downsampled raster (≤ MAX_FUSE_EDGE) only for rebuilding the live-water mesh.
 *
 * Rules:
 *  1. Optical → keep
 *  2. Optical ∩ SAR → keep (consensus)
 *  3. SAR only → keep if near optical edge OR near corridor
 */
import { localToLonLat } from "./geoReference.js";
import { LIVE_WATER_BOUNDS } from "./liveWaterMask.js";

/** Max raster edge for mesh rebuild — keeps fusion under ~0.5M cells. */
const MAX_FUSE_EDGE = 640;

/**
 * @param {object|null} optical  loadLiveWaterMask() result
 * @param {object|null} sar      JalNetra permanent-water mask
 * @param {{
 *   stations?: Array<{x:number,z:number,halfWidth?:number,width?:number}>,
 *   corridorBufferM?: number,
 *   buildRaster?: boolean,
 * }} [opts]
 */
export function createFusedWaterMask(optical, sar, opts = {}) {
  const hasOptical = !!(optical?.available && typeof optical.isWaterAtLonLat === "function");
  const hasSar = !!(sar && typeof sar.isWaterAtLonLat === "function");

  if (!hasOptical && !hasSar) return emptyFused("NONE");
  if (!hasOptical && hasSar) return wrapSarOnly(sar);
  if (hasOptical && !hasSar) return wrapOpticalOnly(optical);

  const bounds = { ...(optical.bounds || LIVE_WATER_BOUNDS) };
  const { north, south, east, west } = bounds;
  const lonSpan = Math.max(1e-12, east - west);
  const latSpan = Math.max(1e-12, north - south);
  // Keep SAR fill tight to the channel — wide buffers bled water onto creek endings.
  const corridorBufferM = Number(opts.corridorBufferM) || 90;
  const stationsLL = precomputeStations(opts.stations || []);

  // ~2 optical pixels in degrees (for SAR-near-optical test)
  const optW = Math.max(1, optical.width || 512);
  const optH = Math.max(1, optical.height || 512);
  const dLon = (lonSpan / optW) * 2.5;
  const dLat = (latSpan / optH) * 2.5;

  const isWaterAtLonLat = (lon, lat) => {
    const opt = optical.isWaterAtLonLat(lon, lat);
    if (opt) return true;
    if (!sar.isWaterAtLonLat(lon, lat)) return false;
    // SAR-only: keep if beside optical water or near the river corridor
    if (nearOptical(optical, lon, lat, dLon, dLat)) return true;
    if (nearCorridor(stationsLL, lon, lat, corridorBufferM)) return true;
    // Outside optical box but still on SAR + corridor (estuary edge)
    if (!(lon >= west && lon <= east && lat >= south && lat <= north)) {
      return nearCorridor(stationsLL, lon, lat, corridorBufferM * 1.25);
    }
    return false;
  };

  const isWaterAtLocal = (x, z) => {
    try {
      const ll = localToLonLat(x, z);
      return isWaterAtLonLat(ll.lon, ll.lat);
    } catch {
      return false;
    }
  };

  const buildRaster = opts.buildRaster !== false;
  let width = 0;
  let height = 0;
  let mask = null;
  let stats = { mode: "functional" };

  if (buildRaster && optical.mask && optical.width && optical.height) {
    const raster = buildDownsampledRaster(optical, isWaterAtLonLat, bounds);
    width = raster.width;
    height = raster.height;
    mask = raster.mask;
    stats = raster.stats;
  }

  console.info("[fusedWaterMask] optical∪SAR ready", stats);

  return {
    available: true,
    bounds,
    width,
    height,
    mask,
    isWaterAtLonLat,
    isWaterAtLocal,
    source: "Sentinel-2 MNDWI ∪ Sentinel-1 SAR",
    provenance: "FUSED_OPTICAL_SAR",
    optical,
    sar,
    stats,
    textureUrl: optical.textureUrl || null,
  };
}

/**
 * Downsample optical grid, evaluate fused wetness once per coarse cell.
 * Used only for live-water mesh rebuild — clip/banks use the functional sampler.
 */
function buildDownsampledRaster(optical, isWaterAtLonLat, bounds) {
  const srcW = optical.width;
  const srcH = optical.height;
  const scale = Math.min(1, MAX_FUSE_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const { north, south, east, west } = bounds;
  const lonSpan = Math.max(1e-12, east - west);
  const latSpan = Math.max(1e-12, north - south);
  const mask = new Uint8Array(width * height);
  const bits = optical.mask;

  let opticalCount = 0;
  let fusedCount = 0;
  let sarAdded = 0;

  for (let y = 0; y < height; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * (srcH / height)));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * (srcW / width)));
      const opt = bits[sy * srcW + sx] === 1;
      if (opt) opticalCount += 1;

      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const lon = west + u * lonSpan;
      const lat = north - v * latSpan;

      // Always keep optical; only call fused sampler for dry cells (SAR fill).
      let wet = opt;
      if (!opt) wet = isWaterAtLonLat(lon, lat);
      if (wet) {
        mask[y * width + x] = 1;
        fusedCount += 1;
        if (!opt) sarAdded += 1;
      }
    }
  }

  return {
    width,
    height,
    mask,
    stats: {
      mode: "downsampled",
      grid: `${width}x${height}`,
      srcGrid: `${srcW}x${srcH}`,
      opticalPixels: opticalCount,
      fusedPixels: fusedCount,
      sarAdded,
      coveragePct: Number(((100 * fusedCount) / mask.length).toFixed(2)),
    },
  };
}

function nearOptical(optical, lon, lat, dLon, dLat) {
  // 8-neighbour ring around the point in geographic space
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (optical.isWaterAtLonLat(lon + dx * dLon, lat + dy * dLat)) return true;
    }
  }
  return false;
}

function precomputeStations(stations) {
  if (!stations?.length) return [];
  // Cap samples so near-corridor tests stay O(1)-ish (~64 along-river points).
  const step = Math.max(1, Math.floor(stations.length / 64));
  const out = [];
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    try {
      const ll = localToLonLat(s.x, s.z);
      out.push({
        lon: ll.lon,
        lat: ll.lat,
        half: Math.max(40, Number(s.halfWidth) || Number(s.width) * 0.5 || 80),
      });
    } catch {
      /* skip */
    }
  }
  // Always include ends
  for (const idx of [0, stations.length - 1]) {
    const s = stations[idx];
    if (!s) continue;
    try {
      const ll = localToLonLat(s.x, s.z);
      out.push({
        lon: ll.lon,
        lat: ll.lat,
        half: Math.max(40, Number(s.halfWidth) || Number(s.width) * 0.5 || 80),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

function nearCorridor(stationsLL, lon, lat, bufferM) {
  if (!stationsLL.length) return false;
  const mPerDegLat = 110540;
  const mPerDegLon = 110540 * Math.cos((15.5 * Math.PI) / 180);
  for (const s of stationsLL) {
    const dx = (lon - s.lon) * mPerDegLon;
    const dz = (lat - s.lat) * mPerDegLat;
    if (Math.hypot(dx, dz) <= s.half + bufferM) return true;
  }
  return false;
}

function wrapOpticalOnly(optical) {
  return {
    available: true,
    bounds: optical.bounds,
    width: optical.width,
    height: optical.height,
    mask: optical.mask,
    isWaterAtLonLat: optical.isWaterAtLonLat,
    isWaterAtLocal: optical.isWaterAtLocal,
    source: optical.source || "live_water_mandavi.kml",
    provenance: "OPTICAL_ONLY",
    optical,
    sar: null,
    stats: { fusedPixels: null, note: "SAR unavailable — optical only" },
    textureUrl: optical.textureUrl || null,
  };
}

function wrapSarOnly(sar) {
  return {
    available: true,
    bounds: sar.north
      ? { north: sar.north, south: sar.south, east: sar.east, west: sar.west }
      : { ...LIVE_WATER_BOUNDS },
    width: 0,
    height: 0,
    mask: null,
    isWaterAtLonLat: sar.isWaterAtLonLat || (() => false),
    isWaterAtLocal: sar.isWaterAtLocal || (() => false),
    source: "Sentinel-1 SAR permanent_water",
    provenance: "SAR_ONLY",
    optical: null,
    sar,
    stats: { note: "Optical unavailable — SAR only" },
    textureUrl: null,
  };
}

function emptyFused(reason) {
  return {
    available: false,
    bounds: { ...LIVE_WATER_BOUNDS },
    width: 0,
    height: 0,
    mask: null,
    isWaterAtLonLat: () => false,
    isWaterAtLocal: () => false,
    source: "UNAVAILABLE",
    provenance: reason,
    optical: null,
    sar: null,
    stats: {},
    textureUrl: null,
  };
}
