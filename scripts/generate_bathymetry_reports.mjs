import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../src/data/Updates/river_bathymetry");
fs.mkdirSync(root, { recursive: true });

const survey = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../public/data/mandovi/mandovi_bathymetry_survey.json"), "utf8"),
);
const meta = survey.metadata || {};
const stations = survey.survey_stations || [];
const cs = survey.cross_sections || [];
const pts = survey.sounding_points || [];
const depths = pts.map((p) => p.depthM).filter(Number.isFinite);

fs.writeFileSync(
  path.join(root, "bathymetry_source_report.md"),
  `# Bathymetry Source Report

## Primary measured source
- **Authority:** ${meta.survey_institution || "CSIR-NIO"}
- **Report:** ${meta.official_report || "Mandovi geomorphology / EIA EMP August 2021"}
- **Instrument:** Bathy-500HD echosounder + Squid 500 sparker
- **Vertical datum:** Chart Datum (CD) / MSL (Mormugao)
- **Stations:** ${stations.length} (NIO-MAND-67 … 100)
- **Cross-sections:** ${cs.length}
- **Sounding / profile points:** ${pts.length}
- **Depth range (profile points):** ${Math.min(...depths).toFixed(2)} – ${Math.max(...depths).toFixed(2)} m

## Satellite / derived (NOT used as OBSERVED bed)
- \`src/data/Updates/original/water_depth_mandavi.kml\` — RELATIVE ESTIMATE (Sentinel-2), display overlay only
- \`live_water_mandavi.kml\` — DERIVED MNDWI water extent, sea/river extent reference

## Scene integration
- Corridor vertex depths replaced via \`applySurveyBathymetry\` using \`bathymetryService.getBathymetryAt\`
- Provenance per vertex: OBSERVED / INTERPOLATED / UNAVAILABLE
- Relation: \`riverbedY = SURFACE_Y - depthM\`
- Sea mouth apron: \`seaConnectionLayer\` guided by survey CH 0+000 (${cs[0]?.lon}, ${cs[0]?.lat})

## Not overwritten
Original survey JSON and Updates originals are left unchanged.
`,
);

const csv = ["chainage_m,lat,lon,depth_m,bed_elevation_msl,provenance,nearest_station"];
for (const p of pts) {
  csv.push(
    [p.chainageMeters, p.lat, p.lon, p.depthM, p.bedElevationMsl, p.provenance, p.nearestStation].join(","),
  );
}
fs.writeFileSync(path.join(root, "bathymetry_validation.csv"), csv.join("\n"));

const geo = {
  type: "FeatureCollection",
  name: "riverbed_elevation",
  features: pts
    .filter((_, i) => i % 4 === 0)
    .map((p) => ({
      type: "Feature",
      properties: {
        depth_m: p.depthM,
        bed_elevation_msl: p.bedElevationMsl,
        chainage_m: p.chainageMeters,
        provenance: p.provenance,
        source: "CSIR-NIO",
      },
      geometry: { type: "Point", coordinates: [p.lon, p.lat, p.bedElevationMsl] },
    })),
};
fs.writeFileSync(path.join(root, "riverbed_elevation.geojson"), JSON.stringify(geo));

fs.writeFileSync(
  path.join(root, "depth_coverage_report.md"),
  `# Depth Coverage Report

| Metric | Value |
|--------|-------|
| Survey stations | ${stations.length} |
| Cross-sections | ${cs.length} |
| Profile points | ${pts.length} |
| Min depth (m) | ${Math.min(...depths).toFixed(2)} |
| Max depth (m) | ${Math.max(...depths).toFixed(2)} |
| Lon span | ${Math.min(...pts.map((p) => p.lon)).toFixed(6)} – ${Math.max(...pts.map((p) => p.lon)).toFixed(6)} |
| Lat span | ${Math.min(...pts.map((p) => p.lat)).toFixed(6)} – ${Math.max(...pts.map((p) => p.lat)).toFixed(6)} |
| Mouth (CH 0) | ${cs[0]?.lon}, ${cs[0]?.lat} |
| Station 67 Miramar Mouth | ${stations[0]?.lon}, ${stations[0]?.lat} |

## Classification
- **OBSERVED:** official CSIR-NIO station locations / nearby samples
- **INTERPOLATED:** between surveyed cross-sections (bank-aware)
- **RELATIVE ESTIMATE:** Updates Sentinel depth overlay (not bed mesh)
- **UNAVAILABLE:** outside survey envelope
`,
);

fs.writeFileSync(
  path.join(root, "river_mouth_validation.md"),
  `# River Mouth Validation

## Target
Connect Mandovi estuary continuously to the Arabian Sea using measured mouth geography.

## Control points
| ID | Name | Lon | Lat | Role |
|----|------|-----|-----|------|
| CS0 | Survey CH 0+000 | ${cs[0]?.lon} | ${cs[0]?.lat} | Sea / Aguada reference |
| NIO-67 | Miramar / Mandovi Mouth | ${stations[0]?.lon} | ${stations[0]?.lat} | Official mouth station |
| LiveWater west | Updates LatLonBox | 73.76545998 | — | Sea extent west bound |

## Implementation
- \`applySurveyBathymetry\` maps corridor chainage so CH 0 aligns with survey mouth.
- \`seaConnectionLayer\` builds a water+bed apron from corridor tip to CS0 when gap > 80 m.
- Live-water / OSM water used as water-mask guidance where available.
- Depths on the apron follow mouth survey profile (MODELLED seam fill), not invented inland channels.

## Pass criteria
- No dry terrain strip between estuary tip and Aguada Bay reference
- Water surface elevation continuous at SURFACE_Y
- Riverbed remains below water (bedY = SURFACE_Y - depth)
`,
);

console.log("Wrote", fs.readdirSync(root).join(", "));
