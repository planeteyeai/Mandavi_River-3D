/**
 * Sea / mouth connection stub.
 *
 * Mandovi water must follow ONLY the user-provided live_water_mandavi.kml
 * (water_extent.png). Do not invent Aguada Bay polygons or corridor aprons.
 */
import * as THREE from "three";

export const MANDOVI_SEA_MOUTH = {
  lon: 73.765714,
  lat: 15.490669,
  station67: { lon: 73.796333, lat: 15.480389 },
  liveWaterWest: 73.76545998,
  liveWaterSouth: 15.4593098,
  liveWaterNorth: 15.52859903,
};

/**
 * @param {object} _dataset
 * @param {{ liveWaterMask?: object }} [opts]
 */
export function createSeaConnectionLayer(_dataset, opts = {}) {
  const group = new THREE.Group();
  group.name = "seaConnection";
  group.visible = false;
  group.userData = {
    built: false,
    stats: {
      built: false,
      reason: "live_water_mandavi.kml is the only water extent — no invented sea apron / bay fill",
      liveWater: !!opts.liveWaterMask?.available,
      source: "live_water_mandavi.kml",
    },
    setVisible() {},
  };
  console.info("[seaConnection] skipped inventing water — using live_water_mandavi.kml only", group.userData.stats);
  return group;
}
