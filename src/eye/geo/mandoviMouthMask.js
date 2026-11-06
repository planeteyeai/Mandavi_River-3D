/**
 * Mandovi river-mouth / Aguada Bay land-use mask from satellite ground truth.
 *
 * Open bay water + Miramar Beach sand must stay clear of trees/buildings canopy.
 * Fort Aguada / Reis Magos headland forest and inland Panaji stay plantable.
 *
 * Bounds verified against Google Earth / Maps:
 *   Miramar Beach ~15.466°N, 73.805°E
 *   Aguada Bay mouth ~15.49°N, 73.77–73.82°E
 */
import { localToLonLat } from "./geoReference.js";

/** Open water of Aguada Bay / Mandovi mouth (clockwise, WGS84). */
export const AGUADA_BAY_WATER_RING = [
  [73.7680, 15.4925], // seaward NW
  [73.7755, 15.5055], // north toward Aguada shore
  [73.7920, 15.5040], // Reis Magos waterfront
  [73.8100, 15.4950], // mid bay north
  [73.8220, 15.4850], // toward Panaji channel
  [73.8180, 15.4720], // Miramar north beach water
  [73.8045, 15.4645], // Miramar Beach
  [73.7900, 15.4680], // mid south beach
  [73.7750, 15.4780], // SW bay
  [73.7680, 15.4925],
];

/**
 * Miramar / Campal beach sand strip — open sand, no canopy (Google Earth ground truth).
 * Slightly inland of the wet shoreline so beach remains clear.
 */
export const MIRAMAR_BEACH_RING = [
  [73.7920, 15.4620],
  [73.8200, 15.4700],
  [73.8225, 15.4785],
  [73.8100, 15.4820],
  [73.7950, 15.4760],
  [73.7900, 15.4685],
  [73.7920, 15.4620],
];

/**
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean} true = open bay water or beach sand — do NOT plant trees
 */
export function isMandoviMouthClearOfVegetation(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (pointInRing(lon, lat, AGUADA_BAY_WATER_RING)) return true;
  if (pointInRing(lon, lat, MIRAMAR_BEACH_RING)) return true;
  return false;
}

/**
 * Local-scene helper.
 * @param {number} x
 * @param {number} z
 */
export function isMandoviMouthClearOfVegetationLocal(x, z) {
  try {
    const ll = localToLonLat(x, z);
    return isMandoviMouthClearOfVegetation(ll.lon, ll.lat);
  } catch {
    return false;
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
