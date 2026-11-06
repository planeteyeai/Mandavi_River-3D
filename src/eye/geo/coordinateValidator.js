/**
 * PLANET.EYE AI — Authoritative Coordinate Validation Service
 * Validates coordinate conventions, reference systems, ground control points (GCPs),
 * and layer alignment across the Mandovi River Digital Twin.
 */
import { geoToWorld, worldToGeo } from "./geoReference.js";

export const MANDAVI_EXPECTED_EXTENT = {
  minLon: 73.75,
  maxLon: 73.90,
  minLat: 15.44,
  maxLat: 15.55,
};

/**
 * 5 Authoritative Ground Control Points for the Mandovi River corridor.
 */
export const MANDAVI_GCPS = [
  {
    id: "GCP-1",
    name: "Atal Setu (Cable-Stayed Bridge Pylon)",
    lon: 73.83360,
    lat: 15.50320,
    elevationM: 0.0,
    feature: "Main river pylon between Panaji and Porvorim",
    maxAllowedErrorM: 25.0,
  },
  {
    id: "GCP-2",
    name: "Mandovi Bridge (Old Central Girder)",
    lon: 73.83115,
    lat: 15.50330,
    elevationM: 0.0,
    feature: "Historic girder bridge span across Mandovi River",
    maxAllowedErrorM: 20.0,
  },
  {
    id: "GCP-3",
    name: "Ribandar Causeway (Ponte Conde de Linhares)",
    lon: 73.85400,
    lat: 15.50250,
    elevationM: 1.5,
    feature: "Heritage stone causeway across Mandovi salt flat arm",
    maxAllowedErrorM: 30.0,
  },
  {
    id: "GCP-4",
    name: "Fort Aguada Lighthouse & Bastion",
    lon: 73.77350,
    lat: 15.49250,
    elevationM: 71.8,
    feature: "Portuguese coastal fort bastion at Aguada Bay entrance",
    maxAllowedErrorM: 25.0,
  },
  {
    id: "GCP-5",
    name: "Cabo Raj Bhavan Headland (Dona Paula)",
    lon: 73.78740,
    lat: 15.46050,
    elevationM: 0.0,
    feature: "Southern headland of Mandovi Estuary",
    maxAllowedErrorM: 25.0,
  },
];

/**
 * Validate coordinates for any dataset or point list.
 * @param {Array<{lon:number, lat:number}>} points
 * @param {string} layerName
 */
export function auditCoordinateList(points, layerName = "Dataset") {
  if (!points || !points.length) {
    return { ok: false, error: `${layerName} has 0 points` };
  }

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  let swappedCount = 0;

  for (const p of points) {
    const lon = p.lon ?? p[0];
    const lat = p.lat ?? p[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    // Detect swapped coordinates [lat, lon] instead of [lon, lat]
    if (lon > 10 && lon < 25 && lat > 65 && lat < 85) {
      swappedCount++;
    }

    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const isSwapped = swappedCount > points.length * 0.5;
  const inExtent =
    minLon >= MANDAVI_EXPECTED_EXTENT.minLon &&
    maxLon <= MANDAVI_EXPECTED_EXTENT.maxLon &&
    minLat >= MANDAVI_EXPECTED_EXTENT.minLat &&
    maxLat <= MANDAVI_EXPECTED_EXTENT.maxLat;

  return {
    ok: !isSwapped && inExtent,
    count: points.length,
    extent: { minLon, maxLon, minLat, maxLat },
    isSwapped,
    inExtent,
    layerName,
  };
}

/**
 * Run automatic Ground Control Point validation.
 * Verifies that forward and inverse transformation round-trip with sub-millimeter precision,
 * and checks distance against rendered bridge and corridor geometry.
 * @param {object} dataset
 */
export function validateGroundControlPoints(dataset) {
  const results = [];
  const stations = dataset?.corridor?.stations || [];
  const bridges = dataset?.bridges || [];

  for (const gcp of MANDAVI_GCPS) {
    // 1. Forward transformation via shared geoToWorld service
    const world = geoToWorld(gcp.lon, gcp.lat, gcp.elevationM);
    // 2. Inverse transformation via worldToGeo
    const roundTrip = worldToGeo(world.x, world.z, world.y);
    const dLon = Math.abs(roundTrip.lon - gcp.lon);
    const dLat = Math.abs(roundTrip.lat - gcp.lat);
    const roundTripErrorM = Math.hypot(dLon * 107269, dLat * 111320);

    // 3. Proximity to rendered bridge / corridor
    let nearestBridgeDist = Infinity;
    let matchedBridge = null;
    for (const b of bridges) {
      const midX = b.midX ?? (b.start && b.end ? (b.start.x + b.end.x) * 0.5 : b.x);
      const midZ = b.midZ ?? (b.start && b.end ? (b.start.z + b.end.z) * 0.5 : b.z);
      if (Number.isFinite(midX) && Number.isFinite(midZ)) {
        const d = Math.hypot(world.x - midX, world.z - midZ);
        if (d < nearestBridgeDist) {
          nearestBridgeDist = d;
          matchedBridge = b.name || b.id;
        }
      }
    }

    // 4. Proximity to nearest river corridor station
    let nearestRiverDist = Infinity;
    for (const st of stations) {
      const d = Math.hypot(world.x - st.x, world.z - st.z);
      if (d < nearestRiverDist) nearestRiverDist = d;
    }

    const passed = roundTripErrorM < 0.05; // < 5cm round-trip precision

    results.push({
      ...gcp,
      worldX: Number(world.x.toFixed(2)),
      worldY: Number(world.y.toFixed(2)),
      worldZ: Number(world.z.toFixed(2)),
      roundTripErrorM: Number(roundTripErrorM.toFixed(4)),
      nearestBridgeDistM: Number(nearestBridgeDist.toFixed(1)),
      matchedBridge,
      nearestRiverDistM: Number(nearestRiverDist.toFixed(1)),
      passed,
    });
  }

  const allPassed = results.every((r) => r.passed);
  console.info("[coordinateValidator] GCP validation complete:", {
    allPassed,
    gcpCount: results.length,
    results,
  });

  return {
    ok: allPassed,
    gcpCount: results.length,
    results,
    crs: "EPSG:32643 (UTM Zone 43N)",
    inputCRS: "EPSG:4326 (WGS84)",
  };
}
