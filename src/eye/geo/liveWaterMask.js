/**
 * Live Water Extent from the user Mandovi KML GroundOverlay.
 * Canonical source: public/data/mandovi/live_water_mandavi.kml
 * Extracted overlay: /data/mandovi/live_water_extent.png
 *
 * Authoritative Mandovi water footprint — do not invent bay polygons.
 */
import { localToLonLat } from "./geoReference.js";

export const LIVE_WATER_KML_URL = "/data/mandovi/live_water_mandavi.kml";
export const LIVE_WATER_PNG_URL = "/data/mandovi/live_water_extent.png";
export const LIVE_WATER_META_URL = "/data/mandovi/live_water_extent.json";

export const LIVE_WATER_BOUNDS = {
  north: 15.52859903,
  south: 15.4593098,
  east: 73.88313675,
  west: 73.76545998,
};

let _promise = null;

/**
 * @returns {Promise<{
 *   available: boolean,
 *   bounds: {north:number,south:number,east:number,west:number},
 *   width: number,
 *   height: number,
 *   mask: Uint8Array|null,
 *   isWaterAtLonLat:(lon:number,lat:number)=>boolean,
 *   isWaterAtLocal:(x:number,z:number)=>boolean,
 *   source: string,
 *   textureUrl: string,
 * }>}
 */
export function loadLiveWaterMask() {
  if (!_promise) {
    _promise = decode().catch((err) => {
      console.warn("[liveWaterMask] unavailable", err?.message || err);
      _promise = null;
      return empty();
    });
  }
  return _promise;
}

async function decode() {
  let bounds = { ...LIVE_WATER_BOUNDS };
  try {
    const meta = await fetch(LIVE_WATER_META_URL, { cache: "force-cache" }).then((r) =>
      r.ok ? r.json() : null,
    );
    if (meta?.bounds) bounds = { ...bounds, ...meta.bounds };
  } catch {
    /* use defaults from KML LatLonBox */
  }

  // Prefer extracted PNG; fall back to parsing the KML data-URI if needed.
  let blob = null;
  const pngRes = await fetch(LIVE_WATER_PNG_URL, { cache: "force-cache" });
  if (pngRes.ok) {
    blob = await pngRes.blob();
  } else {
    blob = await extractPngFromKml(LIVE_WATER_KML_URL);
  }
  if (!blob) throw new Error("live_water_mandavi.kml overlay image missing");

  const bitmap = await createImageBitmap(blob);
  // Keep good resolution for estuary mouth fidelity
  const maxW = 2800;
  const scale = Math.min(1, maxW / Math.max(1, bitmap.width));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const px = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  let waterCount = 0;
  // Auto-calibrate: sample brightest blue-ish non-transparent pixels
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (isLiveWaterPixel(px[p], px[p + 1], px[p + 2], px[p + 3])) {
      mask[i] = 1;
      waterCount++;
    }
  }

  const { north, south, east, west } = bounds;
  const isWaterAtLonLat = (lon, lat) => {
    if (!(lon >= west && lon <= east && lat >= south && lat <= north)) return false;
    const u = (lon - west) / Math.max(1e-12, east - west);
    const v = (north - lat) / Math.max(1e-12, north - south);
    const ix = Math.max(0, Math.min(width - 1, Math.floor(u * width)));
    const iy = Math.max(0, Math.min(height - 1, Math.floor(v * height)));
    return mask[iy * width + ix] === 1;
  };
  const isWaterAtLocal = (x, z) => {
    try {
      const ll = localToLonLat(x, z);
      return isWaterAtLonLat(ll.lon, ll.lat);
    } catch {
      return false;
    }
  };

  console.info("[liveWaterMask] ready", {
    grid: `${width}x${height}`,
    waterPixels: waterCount,
    coveragePct: Number(((100 * waterCount) / mask.length).toFixed(2)),
    bounds,
    source: "public/data/mandovi/live_water_mandavi.kml",
  });

  return {
    available: waterCount > 0,
    bounds,
    width,
    height,
    mask,
    isWaterAtLonLat,
    isWaterAtLocal,
    source: "live_water_mandavi.kml",
    textureUrl: LIVE_WATER_PNG_URL,
  };
}

async function extractPngFromKml(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) return null;
  const text = await res.text();
  const m = text.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
  if (!m) return null;
  const bin = atob(m[1].replace(/\s+/g, ""));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/png" });
}

/** Blue live-water pixels in the Mandovi MNDWI GroundOverlay. */
function isLiveWaterPixel(r, g, b, a) {
  if (a < 20) return false;
  // Solid bright blue (as shown in Google Earth KML overlay)
  if (b > 60 && b >= r && b >= g && (b - r >= 12 || b - g >= 8)) return true;
  if (b > 80 && g > 40 && r < 140 && b >= r * 0.9) return true;
  // Near-opaque medium blue fill
  if (a > 160 && b > 50 && b > r && b > g * 0.85) return true;
  return false;
}

function empty() {
  return {
    available: false,
    bounds: { ...LIVE_WATER_BOUNDS },
    width: 0,
    height: 0,
    mask: null,
    isWaterAtLonLat: () => false,
    isWaterAtLocal: () => false,
    source: "UNAVAILABLE",
    textureUrl: LIVE_WATER_PNG_URL,
  };
}
