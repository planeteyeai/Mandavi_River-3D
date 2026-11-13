/**
 * Snap corridor bank left/right to permanent / live water edges.
 * Chainage stays on the water centreline; width is water face, not dry banks.
 */

/**
 * @param {Array<{x:number,z:number,flowX?:number,flowZ?:number,leftX?:number,leftZ?:number,rightX?:number,rightZ?:number,width?:number,halfWidth?:number}>} stations
 * @param {(x:number,z:number)=>boolean} isWaterAtLocal
 * @param {{ maxScanM?: number, stepM?: number, minWidthM?: number, maxWidthM?: number }} [opts]
 * @returns {{ snapped: number, skipped: number }}
 */
export function snapStationsToWaterMask(stations, isWaterAtLocal, opts = {}) {
  if (!stations?.length || typeof isWaterAtLocal !== "function") {
    return { snapped: 0, skipped: stations?.length || 0 };
  }

  const maxScan = Number(opts.maxScanM) || 2200;
  const step = Math.max(0.5, Number(opts.stepM) || 2);
  const minW = Number(opts.minWidthM) || 8;
  const maxW = Number(opts.maxWidthM) || 3500;

  let snapped = 0;
  let skipped = 0;

  for (const s of stations) {
    const axis = crossAxis(s);
    if (!axis) {
      skipped += 1;
      continue;
    }
    const { ax, az } = axis;
    const segment = waterSegmentAlong(s.x, s.z, ax, az, isWaterAtLocal, maxScan, step);
    if (!segment) {
      skipped += 1;
      continue;
    }
    const span = segment.tMax - segment.tMin;
    if (!(span >= minW && span <= maxW)) {
      skipped += 1;
      continue;
    }

    s.leftX = s.x + ax * segment.tMin;
    s.leftZ = s.z + az * segment.tMin;
    s.rightX = s.x + ax * segment.tMax;
    s.rightZ = s.z + az * segment.tMax;
    s.halfWidth = span * 0.5;
    s.width = span;
    s.waterBankSource = "permanent_or_live_water";
    snapped += 1;
  }

  return { snapped, skipped };
}

/**
 * Prefer JalNetra / permanent-water depth at a local XZ; fall back to bathymetry grid.
 * Always samples the water centreline column when using corridor depths.
 *
 * @param {object} dataset
 * @param {number} x
 * @param {number} z
 * @param {{ nearestStationU?: Function }} [helpers]
 * @returns {number|null}
 */
export function depthInWaterAtLocal(dataset, x, z, helpers = {}) {
  const mask = dataset?.waterDepthMask;
  if (mask?.depthAtLocal) {
    const d = mask.depthAtLocal(x, z);
    if (Number.isFinite(d) && d > 0) return d;
  }
  if (mask?.sampleAtLonLat && dataset?.frame?.toLonLat) {
    try {
      const ll = dataset.frame.toLonLat(x, z);
      const s = mask.sampleAtLonLat(ll.lon, ll.lat);
      if (s?.water && Number.isFinite(s.depth_m) && s.depth_m > 0) return s.depth_m;
    } catch {
      /* ignore */
    }
  }

  const stations = dataset?.corridor?.stations || [];
  const depths = dataset?.bathymetry?.depths;
  if (!stations.length || !depths?.length) return null;
  const cols = (dataset.bathymetry?.across || 40) + 1;
  const uFn = helpers.nearestStationU;
  let row = 0;
  if (typeof uFn === "function") {
    const u = uFn(stations, x, z);
    row = Math.min(stations.length - 1, Math.max(0, Math.round(u * Math.max(0, stations.length - 1))));
  } else {
    let best = Infinity;
    for (let i = 0; i < stations.length; i++) {
      const d2 = (stations[i].x - x) ** 2 + (stations[i].z - z) ** 2;
      if (d2 < best) {
        best = d2;
        row = i;
      }
    }
  }
  // Centre column = mid-channel water, not bank sides.
  const centerIndex = row * cols + Math.floor((cols - 1) / 2);
  const d = depths[centerIndex];
  return Number.isFinite(d) ? d : null;
}

/**
 * Overwrite corridor bathymetry depths with permanent-water depth raster where wet.
 * Dry / bank cells stay shallow so the mesh stays continuous.
 */
export function fuseBathymetryFromWaterDepth(dataset, mask) {
  const bath = dataset?.bathymetry;
  const stations = dataset?.corridor?.stations || [];
  if (!bath?.depths?.length || !stations.length || !mask?.sampleAtLonLat) {
    return { fused: 0 };
  }
  const across = dataset.corridor?.across ?? bath.across ?? 36;
  const cols = across + 1;
  const frame = dataset.frame;
  if (!frame?.toLonLat) return { fused: 0 };

  let fused = 0;
  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < bath.depths.length; i++) {
    const sIdx = Math.min(stations.length - 1, Math.floor(i / cols));
    const st = stations[sIdx];
    const u = bath.acrossU?.[i] ?? (i % cols) / across;
    const x = st.leftX + (st.rightX - st.leftX) * u;
    const z = st.leftZ + (st.rightZ - st.leftZ) * u;
    let sample = null;
    try {
      const ll = frame.toLonLat(x, z);
      sample = mask.sampleAtLonLat(ll.lon, ll.lat);
    } catch {
      sample = null;
    }
    if (sample?.water && Number.isFinite(sample.depth_m) && sample.depth_m > 0) {
      bath.depths[i] = sample.depth_m;
      if (bath.exact) bath.exact[i] = 0.75;
      fused += 1;
      minD = Math.min(minD, sample.depth_m);
      maxD = Math.max(maxD, sample.depth_m);
    } else if (sample && !sample.water) {
      // Outside permanent water — keep shallow bank placeholder, not side-channel invent.
      const bankDist = Math.abs(u * 2 - 1);
      bath.depths[i] = bankDist > 0.75 ? 0.6 : 1.0;
      if (bath.exact) bath.exact[i] = 0;
      minD = Math.min(minD, bath.depths[i]);
      maxD = Math.max(maxD, bath.depths[i]);
    }
  }

  if (Number.isFinite(minD) && Number.isFinite(maxD) && fused > 0) {
    dataset.minDepth = Math.min(dataset.minDepth ?? minD, minD);
    dataset.maxDepth = Math.max(dataset.maxDepth ?? maxD, maxD);
    bath.minDepth = dataset.minDepth;
    bath.maxDepth = dataset.maxDepth;
    bath.waterDepthFused = true;
    bath.waterDepthSource = "permanent_water + water_depth.kml";
  }

  for (const st of stations) {
    try {
      const ll = frame.toLonLat(st.x, st.z);
      const s = mask.sampleAtLonLat(ll.lon, ll.lat);
      if (s?.water && Number.isFinite(s.depth_m)) st.depth = s.depth_m;
    } catch {
      /* keep prior */
    }
  }

  return { fused, depthRange: [dataset.minDepth, dataset.maxDepth] };
}

function crossAxis(s) {
  let ax = -(s.flowZ || 0);
  let az = s.flowX || 0;
  let alen = Math.hypot(ax, az);
  if (alen < 1e-6) {
    ax = (s.rightX ?? s.x) - (s.leftX ?? s.x);
    az = (s.rightZ ?? s.z) - (s.leftZ ?? s.z);
    alen = Math.hypot(ax, az);
  }
  if (alen < 1e-6) return null;
  return { ax: ax / alen, az: az / alen };
}

/**
 * Find the water segment along the cross-section that contains the centreline,
 * else the longest water run (permanent water face).
 */
function waterSegmentAlong(cx, cz, ax, az, isWater, maxScan, step) {
  const samples = [];
  for (let t = -maxScan; t <= maxScan + 1e-6; t += step) {
    samples.push({ t, wet: !!isWater(cx + ax * t, cz + az * t) });
  }

  const runs = [];
  let start = null;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].wet && start == null) start = samples[i].t;
    if ((!samples[i].wet || i === samples.length - 1) && start != null) {
      const endT = samples[i].wet ? samples[i].t : samples[i - 1].t;
      runs.push({ tMin: start, tMax: endT });
      start = null;
    }
  }
  if (!runs.length) return null;

  const containing = runs.find((r) => r.tMin <= 0 && r.tMax >= 0);
  if (containing) return containing;

  runs.sort((a, b) => b.tMax - b.tMin - (a.tMax - a.tMin));
  return runs[0];
}
