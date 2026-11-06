// ============================================================
// Data Loader — loads all river datasets from /public/data
// ============================================================

import { parseKML } from "./kmlParser.js";

/**
 * Load all Mula-Mutha datasets and merge into a single riverData object.
 * Falls back gracefully if a file is missing.
 */
export async function loadRiverData(riverName = "mula_mutha") {
  const kmlText = localStorage.getItem('uploaded_kml');
  if (kmlText) {
    try {
      return parseKML(kmlText);
    } catch (e) {
      console.error("Error parsing stored KML:", e);
      localStorage.removeItem('uploaded_kml');
    }
  }

  const base = `/data/${riverName}`;

  const [chainage, depth, landmarks, polygon] = await Promise.all([
    fetchJson(`${base}/chainage_profile.json`),
    fetchJson(`${base}/depth_profile.json`),
    fetchJson(`${base}/landmarks.json`),
    fetchJson(`${base}/reach_polygon.json`),
  ]);

  // Normalize: chainage_profile.json may be an array-of-objects or an object-of-arrays
  let merged = {};
  if (Array.isArray(chainage)) {
    // Array format: [{chainage_m, lon, lat, width_m}, ...]  → transpose to column arrays
    merged.chainage_m  = chainage.map(r => r.chainage_m);
    merged.lon         = chainage.map(r => r.lon);
    merged.lat         = chainage.map(r => r.lat);
    merged.width_m     = chainage.map(r => r.width_m);
    merged._rows       = chainage; // keep raw rows for convenience
  } else if (chainage) {
    merged = { ...chainage };
  }

  // Merge depth profile (may also be array-of-objects)
  if (Array.isArray(depth)) {
    if (depth[0]?.depth_m !== undefined || depth[0]?.Depth_m !== undefined) {
      merged.depth_m = depth.map(r => r.depth_m ?? r.Depth_m ?? null);
    }
    if (depth[0]?.real_depth_m !== undefined || depth[0]?.Real_depth_m !== undefined) {
      merged.real_depth_m = depth.map(r => r.real_depth_m ?? r.Real_depth_m ?? null);
    }
    if (depth[0]?.depth_flagged !== undefined || depth[0]?.flagged !== undefined) {
      merged.depth_flagged = depth.map(r => r.depth_flagged ?? r.flagged ?? null);
    }
    if (depth[0]?.real_width_m !== undefined || depth[0]?.Real_width_m !== undefined) {
      merged.real_width_m = depth.map(r => r.real_width_m ?? r.Real_width_m ?? null);
    }
    if (depth[0]?.nearest_survey_m !== undefined) {
      merged.nearest_survey_m = depth.map(r => r.nearest_survey_m ?? null);
    }
  } else if (depth) {
    if (depth.depth_m)       merged.depth_m       = depth.depth_m;
    if (depth.real_depth_m)  merged.real_depth_m  = depth.real_depth_m;
    if (depth.depth_flagged) merged.depth_flagged = depth.depth_flagged;
    if (depth.real_width_m)  merged.real_width_m  = depth.real_width_m;
  }

  merged.landmarks    = landmarks?.features || landmarks || [];
  merged.reachPolygon = polygon;

  return merged;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) { console.warn(`[dataLoader] ${url} → ${r.status}`); return null; }
    return r.json();
  } catch (e) {
    console.warn(`[dataLoader] Failed to load ${url}:`, e);
    return null;
  }
}
