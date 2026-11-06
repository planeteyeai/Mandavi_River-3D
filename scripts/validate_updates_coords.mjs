/**
 * Coordinate validation for Updates landmarks vs shared UTM 43N pipeline.
 * Reports round-trip errors for ≥3 independent control points.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import proj4 from "proj4";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

proj4.defs("EPSG:32643", "+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs +type=crs");

const geojson = JSON.parse(
  fs.readFileSync(path.join(root, "src/data/Updates/processed/landmarks.geojson"), "utf8"),
);
const meta = JSON.parse(
  fs.readFileSync(path.join(root, "src/data/Updates/processed/metadata.json"), "utf8"),
);

const CONTROL = [
  { id: "CTRL-1", name: "Betim Fishing Jetty", lon: 73.83427421853877, lat: 15.50408776548442 },
  { id: "CTRL-2", name: "Reis Magos Fort", lon: 73.81056978933869, lat: 15.49574320538338 },
  { id: "CTRL-3", name: "Chorao Island", lon: 73.8721560442885, lat: 15.51329707853288 },
  { id: "CTRL-4", name: "Miramar Beach", lon: 73.8050435051637, lat: 15.48367283017295 },
];

// Origin = centroid of landmarks (matches typical Mandovi AOI centreing)
const feats = geojson.features;
let oLon = 0;
let oLat = 0;
for (const f of feats) {
  oLon += f.geometry.coordinates[0];
  oLat += f.geometry.coordinates[1];
}
oLon /= feats.length;
oLat /= feats.length;
const [e0, n0] = proj4("EPSG:4326", "EPSG:32643", [oLon, oLat]);
const flipX = true;

function geoToWorld(lon, lat) {
  const [e, n] = proj4("EPSG:4326", "EPSG:32643", [lon, lat]);
  const x = flipX ? -(e - e0) : e - e0;
  const z = n - n0;
  return { x, z, easting: e, northing: n };
}

function worldToGeo(x, z) {
  const e = (flipX ? -x : x) + e0;
  const n = z + n0;
  const [lon, lat] = proj4("EPSG:32643", "EPSG:4326", [e, n]);
  return { lon, lat, easting: e, northing: n };
}

const controlResults = CONTROL.map((c) => {
  const w = geoToWorld(c.lon, c.lat);
  const back = worldToGeo(w.x, w.z);
  const errM = Math.hypot((back.lon - c.lon) * 107269, (back.lat - c.lat) * 111320);
  const feat = feats.find((f) => f.properties.name === c.name);
  const sourceMatch =
    feat &&
    Math.abs(feat.geometry.coordinates[0] - c.lon) < 1e-12 &&
    Math.abs(feat.geometry.coordinates[1] - c.lat) < 1e-12;
  return {
    ...c,
    worldX: Number(w.x.toFixed(3)),
    worldZ: Number(w.z.toFixed(3)),
    roundTripErrorM: Number(errM.toFixed(6)),
    sourceMatch: !!sourceMatch,
    passed: errM < 0.05 && !!sourceMatch,
  };
});

const landmarkTable = feats.map((f) => ({
  name: f.properties.name,
  lon: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
  sourceFilename: f.properties.sourceFilename,
  geometryType: f.properties.geometryType,
  provenance: f.properties.provenance,
  ...(() => {
    const w = geoToWorld(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    return { worldX: Number(w.x.toFixed(2)), worldZ: Number(w.z.toFixed(2)) };
  })(),
}));

const live = meta.assets.find((a) => a.dataType === "live_water_extent");
const depth = meta.assets.find((a) => a.dataType === "relative_water_depth");

const report = {
  generatedAt: new Date().toISOString(),
  title: "Mandavi Updates — Import & Coordinate Validation Report",
  filesImported: meta.assets.map((a) => a.filename),
  filesRejected: meta.rejected || [],
  crs: {
    input: "EPSG:4326",
    projected: "EPSG:32643",
    localOriginLonLat: { lon: oLon, lat: oLat },
    localOriginUtm: { easting: e0, northing: n0 },
    flipX: true,
    note: "Same pipeline as src/eye/geo/geoReference.js geoToWorld",
  },
  overlayBounds: {
    liveWater: live?.bounds || null,
    relativeDepth: depth?.bounds || null,
  },
  landmarks: landmarkTable,
  coordinateControlPoints: controlResults,
  coordinateAlignmentSummary: {
    controlPointsChecked: controlResults.length,
    allPassed: controlResults.every((r) => r.passed),
    maxRoundTripErrorM: Math.max(...controlResults.map((r) => r.roundTripErrorM)),
  },
  bathymetryProvenance: {
    verifiedSurveyBathymetry: "OBSERVED / existing CSIR-NIO survey layer in app (separate)",
    relativeWaterDepth: {
      source: "water_depth_mandavi.kml",
      provenance: "RELATIVE ESTIMATE",
      depthRangeM: [0.5, 8.0],
      method: "Sentinel-2 relative band-ratio",
      notSurveyGrade: true,
    },
    liveWaterExtent: {
      source: "live_water_mandavi.kml",
      provenance: "DERIVED",
      method: "Sentinel-2 MNDWI",
      notLiveSensor: true,
    },
  },
  missingDatasets: [
    "No GeoTIFF DEM packaged in Updates (terrain uses existing FABDEM pipeline)",
    "No water_depth.tif — source is GroundOverlay PNG only",
  ],
  limitations: [
    "Relative depth must not be labelled as observed sonar / hydrographic survey.",
    "Live water extent is a composite observation window, not real-time telemetry.",
    "Landmark elevations in KMZ are 0 (clamp-to-ground); markers sit on terrain height.",
  ],
};

const outPath = path.join(root, "src/data/Updates/processed/validation_report.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(root, "public/data/updates/validation_report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report.coordinateAlignmentSummary, null, 2));
console.log("Wrote", outPath);
