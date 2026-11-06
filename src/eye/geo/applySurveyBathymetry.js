/**
 * Replace procedural corridor depths with CSIR-NIO survey interpolations.
 * Riverbed: bedY = SURFACE_Y - depthM (same frame as river.js).
 * Does not invent deep-channel depths outside the survey envelope.
 */
import { bathymetryService } from "../services/hydrology/bathymetryService.js";

/**
 * @param {object} dataset
 * @returns {Promise<object>}
 */
export async function applySurveyBathymetry(dataset) {
  await bathymetryService.init();
  const bath = dataset?.bathymetry;
  const stations = dataset?.corridor?.stations || [];
  if (!bath?.depths || !stations.length || !bathymetryService.ready) {
    return {
      applied: 0,
      observed: 0,
      interpolated: 0,
      unavailable: bath?.depths?.length || 0,
      depthRange: [dataset?.minDepth ?? 0, dataset?.maxDepth ?? 0],
      source: "UNAVAILABLE",
    };
  }

  const mouth = resolveMouthOrientation(dataset);
  const totalLen = stations[stations.length - 1]?.meters || stations[stations.length - 1]?.along || 1;
  const n = bath.depths.length;
  const across = dataset.corridor?.across ?? 36;
  const cols = across + 1;
  const provenance = new Array(n).fill("UNAVAILABLE");
  let observed = 0;
  let interpolated = 0;
  let unavailable = 0;
  let minD = Infinity;
  let maxD = -Infinity;

  for (let i = 0; i < n; i++) {
    const sIdx = Math.min(stations.length - 1, Math.floor(i / cols));
    const st = stations[sIdx];
    const u = bath.acrossU?.[i] ?? (i % cols) / across;
    const width = st.width || bath.widthM?.[i] || 80;
    const lateralOffsetMeters = (u - 0.5) * width;
    const rawCh = st.along ?? st.meters ?? st.chainage_m ?? 0;
    // Survey CH 0+000 = Arabian Sea / Aguada mouth
    const chainageMeters = mouth.reversed ? Math.max(0, totalLen - rawCh) : rawCh;

    const sample = bathymetryService.getBathymetryAt({
      chainageMeters,
      lateralOffsetMeters,
    });

    if (sample?.depthM != null && Number.isFinite(sample.depthM)) {
      bath.depths[i] = sample.depthM;
      const prov = String(sample.provenance || "INTERPOLATED");
      provenance[i] = /OBSERVED/i.test(prov) ? "OBSERVED" : "INTERPOLATED";
      if (provenance[i] === "OBSERVED") observed++;
      else interpolated++;
      if (bath.exact) bath.exact[i] = provenance[i] === "OBSERVED" ? 1 : 0.5;
      minD = Math.min(minD, sample.depthM);
      maxD = Math.max(maxD, sample.depthM);
    } else {
      // Outside survey envelope: do not invent deep channels. Keep only a
      // conservative bank-shallow placeholder so the mesh stays continuous.
      const bankDist = Math.abs(u * 2 - 1);
      bath.depths[i] = bankDist > 0.7 ? 0.8 : 1.2;
      provenance[i] = "UNAVAILABLE";
      unavailable++;
      if (bath.exact) bath.exact[i] = 0;
      minD = Math.min(minD, bath.depths[i]);
      maxD = Math.max(maxD, bath.depths[i]);
    }
  }

  for (const st of stations) {
    const rawCh = st.along ?? st.meters ?? 0;
    const chainageMeters = mouth.reversed ? Math.max(0, totalLen - rawCh) : rawCh;
    const mid = bathymetryService.getBathymetryAt({
      chainageMeters,
      lateralOffsetMeters: 0,
    });
    if (mid?.depthM != null) st.depth = mid.depthM;
    st.surveyChainageMeters = chainageMeters;
  }

  dataset.minDepth = Number.isFinite(minD) ? minD : 0.8;
  dataset.maxDepth = Number.isFinite(maxD) ? maxD : 16.5;
  bath.minDepth = dataset.minDepth;
  bath.maxDepth = dataset.maxDepth;
  bath.source = "CSIR-NIO Mandovi Geophysical & Bathymetric Survey (August 2021)";
  bath.verticalDatum = "Chart Datum (CD) / MSL (Mormugao Port Baseline)";
  bath.provenance = provenance;
  bath.surveyApplied = true;
  bath.mouthOrientation = mouth;

  const report = {
    applied: observed + interpolated,
    observed,
    interpolated,
    unavailable,
    depthRange: [dataset.minDepth, dataset.maxDepth],
    source: bath.source,
    verticalDatum: bath.verticalDatum,
    mouthReversed: mouth.reversed,
    mouthLon: mouth.mouthLon,
    mouthLat: mouth.mouthLat,
    stations: stations.length,
    vertices: n,
  };
  dataset.bathymetryAudit = report;
  console.info("[applySurveyBathymetry]", report);
  return report;
}

function resolveMouthOrientation(dataset) {
  const stations = dataset?.corridor?.stations || [];
  const frame = dataset?.frame;
  const cs0 = bathymetryService.crossSections?.[0];
  if (!stations.length || !frame?.toLonLat || !cs0) {
    return { reversed: false, mouthLon: null, mouthLat: null };
  }
  const tipA = frame.toLonLat(stations[0].x, stations[0].z);
  const tipB = frame.toLonLat(
    stations[stations.length - 1].x,
    stations[stations.length - 1].z,
  );
  const dA = Math.hypot(tipA.lon - cs0.lon, tipA.lat - cs0.lat);
  const dB = Math.hypot(tipB.lon - cs0.lon, tipB.lat - cs0.lat);
  const reversed = dB < dA;
  const mouth = reversed ? tipB : tipA;
  return {
    reversed,
    mouthLon: mouth.lon,
    mouthLat: mouth.lat,
    surveyCs0: { lon: cs0.lon, lat: cs0.lat },
  };
}
