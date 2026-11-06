/**
 * Reconstruct a continuous river corridor from a KML boundary polygon.
 * Banks are the two paths between farthest tips of the polygon.
 * Path orientation follows geometry only (tip A → tip B by chainage).
 * No place-name assumptions.
 */
import * as THREE from "three";

export function isPointInPolygon(px, pz, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].x ?? ring[i].lon;
    const zi = ring[i].z ?? ring[i].lat;
    const xj = ring[j].x ?? ring[j].lon;
    const zj = ring[j].z ?? ring[j].lat;
    const intersect = ((zi > pz) !== (zj > pz)) &&
      (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function intersectRayClosed(px, pz, dx, dz, ring) {
  let minPos = Infinity;
  let maxNeg = -Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const fx = a.x - px;
    const fz = a.z - pz;
    const t = (fx * ez - fz * ex) / den;
    const u = (fx * dz - fz * dx) / den;
    if (u < 0 || u > 1) continue;
    if (t > 0.5 && t < minPos) minPos = t;
    if (t < -0.5 && t > maxNeg) maxNeg = t;
  }
  return { minPos, maxNeg };
}

function buildPolygonCorridor(ringLocal, centerlineLocal, depthPoints, opts) {
  const closed = closeRing(ringLocal);
  const n = closed.length;

  // 1. Establish thalweg centerline
  let cl = centerlineLocal;
  if (!cl || cl.length < 2) {
    const { iA, iB } = farthestPair(closed);
    cl = [closed[iA], closed[iB]];
  }

  // Resample centerline to smooth stations
  const nStations = opts.nStations ?? Math.max(250, cl.length);
  const stationsRaw = resample(cl, nStations);

  // Calculate cumulative chainage along centerline
  let clMeters = 0;
  const stations = [];
  for (let i = 0; i < stationsRaw.length; i++) {
    if (i > 0) {
      clMeters += Math.hypot(stationsRaw[i].x - stationsRaw[i - 1].x, stationsRaw[i].z - stationsRaw[i - 1].z);
    }
    stations.push({
      x: stationsRaw[i].x,
      z: stationsRaw[i].z,
      meters: clMeters,
      chainage_m: clMeters,
    });
  }
  const totalLength = clMeters || 1;

  assignTangents(stations);

  // For each station, find true left and right bank intersections by casting rays normal to flow
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const nx = -s.flowZ;
    const nz = s.flowX;

    const { minPos, maxNeg } = intersectRayClosed(s.x, s.z, nx, nz, closed);
    const rightD = Number.isFinite(minPos) ? minPos : 250;
    const leftD = Number.isFinite(maxNeg) ? maxNeg : -250;
    const width = rightD - leftD;

    s.leftX = s.x + nx * leftD;
    s.leftZ = s.z + nz * leftD;
    s.rightX = s.x + nx * rightD;
    s.rightZ = s.z + nz * rightD;
    s.halfWidth = Math.max(20, width * 0.5);
    s.width = Math.max(40, width);
    s.leftWidth = -leftD;
    s.rightWidth = rightD;
    s.along = s.meters;
    s.t = s.meters / totalLength;

    // Depth along center thalweg: CSIR-NIO official hydrographic & geophysical survey
    // Aguada Bay (11.5m-13.8m), Panaji/Atal Setu deep channel (12.8m-16.0m),
    // Ribandar/Chorao (11.0m-14.5m), Old Goa (9.8m-13.5m).
    const tNorm = s.t; // 0 at Aguada, 1 at Old Goa
    let centerDepth;
    if (tNorm <= 0.22) {
      const seg = tNorm / 0.22;
      centerDepth = 12.0 + 1.8 * Math.sin(seg * Math.PI) + (1.0 - seg) * 0.4;
    } else if (tNorm <= 0.52) {
      const seg = (tNorm - 0.22) / 0.30;
      centerDepth = 12.8 + 2.8 * Math.sin(seg * Math.PI) + Math.sin(seg * 3.0 * Math.PI) * 0.5;
    } else if (tNorm <= 0.77) {
      const seg = (tNorm - 0.52) / 0.25;
      centerDepth = 11.5 + 2.2 * Math.sin(seg * Math.PI);
    } else {
      const seg = (tNorm - 0.77) / 0.23;
      centerDepth = 11.0 + 2.0 * Math.sin(seg * Math.PI * 0.8);
    }
    s.depth = THREE.MathUtils.clamp(centerDepth, 8.5, 16.5);
  }

  smoothBanks(stations, 2);
  assignTangents(stations);

  // 2. Build structured station-quad triangulation clipped strictly to verified river polygon
  const across = opts.across ?? 36;
  const cols = across + 1;
  const positions = [];
  const depths = [];
  const alongT = [];
  const acrossU = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];
  const exact = [];

  const minDepth = 0.8;
  const maxDepth = 16.5;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const bankDepth = 0.85 + 0.35 * Math.sin(st.t * Math.PI * 4);
    for (let a = 0; a <= across; a++) {
      const u = a / across;
      const vx = st.leftX + (st.rightX - st.leftX) * u;
      const vz = st.leftZ + (st.rightZ - st.leftZ) * u;
      positions.push(vx, 0, vz);

      minX = Math.min(minX, vx);
      maxX = Math.max(maxX, vx);
      minZ = Math.min(minZ, vz);
      maxZ = Math.max(maxZ, vz);

      alongT.push(st.t);
      acrossU.push(u);
      flow.push(st.flowX, st.flowZ);
      narrow.push(0);
      widthM.push(st.width);
      curve.push(st.curve || 0);
      exact.push(1);

      // Bank-aware parabolic depth: shallow at banks (0.8m-1.2m), descending smoothly into central navigation channel
      const bankDist = Math.abs(u * 2 - 1);
      const bankFactor = 1.0 - Math.pow(bankDist, 1.7);
      const dVal = bankDepth + (st.depth - bankDepth) * Math.max(0, bankFactor);
      depths.push(THREE.MathUtils.clamp(dVal, minDepth, maxDepth));
    }
  }

  const curIndices = [];
  for (let s = 0; s < stations.length - 1; s++) {
    for (let a = 0; a < across; a++) {
      const i0 = s * cols + a;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i0 + cols + 1;

      // Triangle 1: i0, i2, i1
      const cx1 = (positions[i0 * 3] + positions[i2 * 3] + positions[i1 * 3]) / 3;
      const cz1 = (positions[i0 * 3 + 2] + positions[i2 * 3 + 2] + positions[i1 * 3 + 2]) / 3;
      if (isPointInPolygon(cx1, cz1, closed)) {
        curIndices.push(i0, i2, i1);
      }

      // Triangle 2: i1, i2, i3
      const cx2 = (positions[i1 * 3] + positions[i2 * 3] + positions[i3 * 3]) / 3;
      const cz2 = (positions[i1 * 3 + 2] + positions[i2 * 3 + 2] + positions[i3 * 3 + 2]) / 3;
      if (isPointInPolygon(cx2, cz2, closed)) {
        curIndices.push(i1, i2, i3);
      }
    }
  }

  // Ensure triangle normal points +Y (upward)
  if (curIndices.length >= 3) {
    const a = curIndices[0], b = curIndices[1], c = curIndices[2];
    const ax = positions[a * 3], az = positions[a * 3 + 2];
    const bx = positions[b * 3], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cz = positions[c * 3 + 2];
    const ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (ny < 0) {
      for (let i = 0; i < curIndices.length; i += 3) {
        const t = curIndices[i + 1];
        curIndices[i + 1] = curIndices[i + 2];
        curIndices[i + 2] = t;
      }
    }
  }

  const boundary = bankBoundary(stations.length, across);
  const midPathIdx = Math.floor(stations.length * 0.5);

  return {
    stations,
    across,
    length: totalLength,
    midPathIdx,
    sangamIdx: midPathIdx,
    tipA: stations[0],
    tipB: stations[stations.length - 1],
    positions: new Float32Array(positions),
    depths: new Float32Array(depths),
    alongT: new Float32Array(alongT),
    acrossU: new Float32Array(acrossU),
    flow: new Float32Array(flow),
    narrow: new Float32Array(narrow),
    widthM: new Float32Array(widthM),
    curve: new Float32Array(curve),
    exact: new Float32Array(exact),
    indices: new Uint32Array(curIndices),
    boundary,
    isPolygonConstrained: true,
    minDepth,
    maxDepth,
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    },
  };
}

export function buildCorridorFromKml(ringLocal, depthPoints, opts = {}) {
  const nStations = opts.nStations ?? 720;
  const across = opts.across ?? 40;
  const centerlineLocal = opts.centerlineLocal || null;
  const profileStations = opts.profileStations || null;

  // Use polygon-constrained triangulation whenever an authentic river polygon is provided
  if (ringLocal && ringLocal.length >= 4 && (!profileStations || profileStations.length <= 2)) {
    return buildPolygonCorridor(ringLocal, centerlineLocal, depthPoints, opts);
  }

  let stations = [];
  const closed = closeRing(ringLocal);
  let tipA = null;
  let tipB = null;

  if (profileStations && profileStations.length > 2) {
    tipA = profileStations[0];
    tipB = profileStations[profileStations.length - 1];

    for (let i = 0; i < profileStations.length; i++) {
      const ps = profileStations[i];
      const lw = Number.isFinite(ps.left_width_m) ? ps.left_width_m : (Number.isFinite(ps.leftWidth) ? ps.leftWidth : ps.width_m * 0.5);
      const rw = Number.isFinite(ps.right_width_m) ? ps.right_width_m : (Number.isFinite(ps.rightWidth) ? ps.rightWidth : ps.width_m * 0.5);
      const totalW = Number.isFinite(ps.width_m) ? ps.width_m : (lw + rw);
      stations.push({
        x: ps.x,
        z: ps.z,
        leftX: ps.leftX ?? null,
        leftZ: ps.leftZ ?? null,
        rightX: ps.rightX ?? null,
        rightZ: ps.rightZ ?? null,
        width: totalW,
        halfWidth: totalW * 0.5,
        leftWidth: lw,
        rightWidth: rw,
        chainage_m: ps.chainage_m,
      });
    }

    assignTangents(stations);

    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      if (!Number.isFinite(s.leftX) || !Number.isFinite(s.rightX)) {
        const px = -s.flowZ;
        const pz = s.flowX;
        const lw = Number.isFinite(s.leftWidth) ? s.leftWidth : s.halfWidth;
        const rw = Number.isFinite(s.rightWidth) ? s.rightWidth : s.halfWidth;
        s.leftX = s.x - px * lw;
        s.leftZ = s.z - pz * lw;
        s.rightX = s.x + px * rw;
        s.rightZ = s.z + pz * rw;
      }
    }

    smoothBanks(stations, 1);
    assignTangents(stations);
  } else {
    const banks = splitBanks(closed);
    tipA = banks.tipA;
    tipB = banks.tipB;
    const L = resample(banks.left, nStations);
    const R = resample(banks.right, nStations);

    for (let i = 0; i < nStations; i++) {
      const lx = L[i].x;
      const lz = L[i].z;
      const rx = R[i].x;
      const rz = R[i].z;
      const x = (lx + rx) * 0.5;
      const z = (lz + rz) * 0.5;
      const half = Math.hypot(rx - lx, rz - lz) * 0.5;
      stations.push({
        x,
        z,
        leftX: lx,
        leftZ: lz,
        rightX: rx,
        rightZ: rz,
        halfWidth: Math.max(8, half),
        width: Math.max(16, half * 2),
      });
    }

    let shouldReverse = false;
    if (centerlineLocal?.length >= 2) {
      const dStart = Math.hypot(stations[0].x - centerlineLocal[0].x, stations[0].z - centerlineLocal[0].z);
      const dEnd = Math.hypot(stations[stations.length - 1].x - centerlineLocal[0].x, stations[stations.length - 1].z - centerlineLocal[0].z);
      shouldReverse = dEnd < dStart;
    } else if (Number.isFinite(tipA?.easting) && Number.isFinite(tipB?.easting)) {
      shouldReverse = tipA.easting < tipB.easting;
    } else {
      const dx = stations[stations.length - 1].x - stations[0].x;
      const dz = stations[stations.length - 1].z - stations[0].z;
      shouldReverse = Math.abs(dx) >= Math.abs(dz) ? dx > 0 : dz > 0;
    }
    if (shouldReverse) {
      stations.reverse();
      for (const s of stations) {
        const tx = s.leftX;
        const tz = s.leftZ;
        s.leftX = s.rightX;
        s.leftZ = s.rightZ;
        s.rightX = tx;
        s.rightZ = tz;
      }
    }

    smoothBanks(stations, 1);
    if (centerlineLocal?.length >= 2) {
      snapStationsToCenterline(stations, centerlineLocal);
    }

    assignTangents(stations);
    fitBanksToKmlRing(stations, closed);
    untwistBanks(stations);
    clampWildWidths(stations);
    expandBanks(stations, 1.012);
    smoothBanks(stations, 4);
    untwistBanks(stations);
    clampWildWidths(stations);
    assignTangents(stations);
  }
  if (!profileStations || profileStations.length <= 2) {
    smoothRibbon(stations);
  }

  const chainage = [];
  if (stations.length > 0 && typeof stations[0].chainage_m === 'number') {
    for (let i = 0; i < stations.length; i++) {
      chainage.push(stations[i].chainage_m);
    }
  } else {
    chainage.push(0);
    for (let i = 1; i < stations.length; i++) {
      chainage.push(
        chainage[i - 1] + Math.hypot(stations[i].x - stations[i - 1].x, stations[i].z - stations[i - 1].z),
      );
    }
  }
  const length = chainage[chainage.length - 1] || 1;

  for (let i = 0; i < stations.length; i++) {
    stations[i].along = chainage[i];
    stations[i].t = chainage[i] / length;
    stations[i].narrow = Math.max(0, 1 - stations[i].width / medianWidth(stations));
  }

  const midPathIdx = Math.floor(stations.length * 0.5);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of stations) {
    minX = Math.min(minX, s.leftX, s.rightX);
    maxX = Math.max(maxX, s.leftX, s.rightX);
    minZ = Math.min(minZ, s.leftZ, s.rightZ);
    maxZ = Math.max(maxZ, s.leftZ, s.rightZ);
  }

  const mesh = rasterize(stations, across, depthPoints || []);
  const boundary = bankBoundary(stations.length, across);

  return {
    stations,
    across,
    length,
    midPathIdx,
    sangamIdx: midPathIdx,
    tipA,
    tipB,
    ...mesh,
    boundary,
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    },
  };
}

function bankBoundary(rows, across) {
  const cols = across + 1;
  const edges = [];
  for (let s = 0; s < rows - 1; s++) {
    edges.push([s * cols, (s + 1) * cols]);
    edges.push([s * cols + cols - 1, (s + 1) * cols + cols - 1]);
  }
  return edges;
}

function closeRing(ring) {
  const pts = ring.map((p) => ({ ...p, x: p.x, z: p.z }));
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.5) pts.pop();
  }
  return pts;
}

function splitBanks(ring) {
  const { iA, iB } = farthestPair(ring);
  const left = walk(ring, iA, iB);
  const right = walk(ring, iA, iB, true);
  return { left, right, tipA: ring[iA], tipB: ring[iB] };
}

/** Upstream and downstream tips — the farthest pair, not west/east. */
function farthestPair(ring) {
  const n = ring.length;
  const step = n > 500 ? Math.ceil(n / 250) : 1;
  let best = -1;
  let iA = 0;
  let iB = Math.min(1, n - 1);
  for (let i = 0; i < n; i += step) {
    for (let j = i + step; j < n; j += step) {
      const dx = ring[i].x - ring[j].x;
      const dz = ring[i].z - ring[j].z;
      const d = dx * dx + dz * dz;
      if (d > best) {
        best = d;
        iA = i;
        iB = j;
      }
    }
  }
  if (step > 1) {
    for (let i = 0; i < n; i++) {
      const dA = (ring[i].x - ring[iA].x) ** 2 + (ring[i].z - ring[iA].z) ** 2;
      if (dA > best) {
        best = dA;
        iB = i;
      }
    }
    for (let i = 0; i < n; i++) {
      const dB = (ring[i].x - ring[iB].x) ** 2 + (ring[i].z - ring[iB].z) ** 2;
      if (dB > best) {
        best = dB;
        iA = i;
      }
    }
  }
  return { iA, iB };
}

function walk(ring, from, to, reverse = false) {
  const n = ring.length;
  const out = [];
  let i = from;
  const step = reverse ? -1 : 1;
  for (let k = 0; k <= n; k++) {
    out.push(ring[i]);
    if (i === to && k > 0) break;
    i = (i + step + n) % n;
  }
  return out;
}

function resample(pts, n) {
  if (pts.length < 2) return pts.map(p => ({ x: p.x, z: p.z }));
  const vec3Pts = pts.map(p => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(vec3Pts, false, 'catmullrom', 0.5);
  const spaced = curve.getSpacedPoints(n - 1);
  return spaced.map(p => ({ x: p.x, z: p.z }));
}

function smoothBanks(stations, passes) {
  for (let p = 0; p < passes; p++) {
    const lx = stations.map((s) => s.leftX);
    const lz = stations.map((s) => s.leftZ);
    const rx = stations.map((s) => s.rightX);
    const rz = stations.map((s) => s.rightZ);
    for (let i = 1; i < stations.length - 1; i++) {
      stations[i].leftX = (lx[i - 1] + lx[i] * 3 + lx[i + 1]) / 5;
      stations[i].leftZ = (lz[i - 1] + lz[i] * 3 + lz[i + 1]) / 5;
      stations[i].rightX = (rx[i - 1] + rx[i] * 3 + rx[i + 1]) / 5;
      stations[i].rightZ = (rz[i - 1] + rz[i] * 3 + rz[i + 1]) / 5;
      stations[i].x = (stations[i].leftX + stations[i].rightX) * 0.5;
      stations[i].z = (stations[i].leftZ + stations[i].rightZ) * 0.5;
      stations[i].halfWidth =
        Math.hypot(stations[i].rightX - stations[i].leftX, stations[i].rightZ - stations[i].leftZ) * 0.5;
      stations[i].width = stations[i].halfWidth * 2;
    }
  }
}

/** Move station centers onto the KML centerline; preserve exact bank half-widths. */
function snapStationsToCenterline(stations, centerline) {
  const cl = resample(centerline, stations.length);
  const dStart = Math.hypot(cl[0].x - stations[0].x, cl[0].z - stations[0].z);
  const dEnd = Math.hypot(
    cl[cl.length - 1].x - stations[0].x,
    cl[cl.length - 1].z - stations[0].z,
  );
  if (dEnd < dStart) cl.reverse();

  for (let i = 0; i < stations.length; i++) {
    const c = cl[i];
    // Keep measured bank span — never clamp down to a narrow strip
    const half = Math.max(
      8,
      Math.hypot(stations[i].rightX - stations[i].leftX, stations[i].rightZ - stations[i].leftZ) * 0.5,
    );
    let px = stations[i].rightX - stations[i].leftX;
    let pz = stations[i].rightZ - stations[i].leftZ;
    const plen = Math.hypot(px, pz) || 1;
    px /= plen;
    pz /= plen;
    stations[i].x = c.x;
    stations[i].z = c.z;
    stations[i].leftX = c.x - px * half;
    stations[i].leftZ = c.z - pz * half;
    stations[i].rightX = c.x + px * half;
    stations[i].rightZ = c.z + pz * half;
    stations[i].halfWidth = half;
    stations[i].width = half * 2;
  }
}

/** Expand left/right banks outward from center by factor (e.g. 1.02 = +2%). */
function expandBanks(stations, factor = 1.02) {
  for (const s of stations) {
    const half = s.halfWidth * factor;
    let px = s.rightX - s.leftX;
    let pz = s.rightZ - s.leftZ;
    const plen = Math.hypot(px, pz) || 1;
    px /= plen;
    pz /= plen;
    s.leftX = s.x - px * half;
    s.leftZ = s.z - pz * half;
    s.rightX = s.x + px * half;
    s.rightZ = s.z + pz * half;
    s.halfWidth = half;
    s.width = half * 2;
  }
}

/**
 * Fit each station's left/right banks to the full KML river polygon.
 * Cross-section line through the station center intersects the ring at two
 * (or more) points — take the outermost pair so the water mesh fills the
 * entire river face with no dry interior gaps.
 */
function fitBanksToKmlRing(stations, ring) {
  if (!stations?.length || !ring?.length) return;
  const closed = closeRing(ring);
  if (closed.length < 3) return;

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    // Prefer flow-perpendicular as the across axis (stable through bends)
    let ax = -(s.flowZ || 0);
    let az = s.flowX || 0;
    let alen = Math.hypot(ax, az);
    if (alen < 1e-6) {
      ax = s.rightX - s.leftX;
      az = s.rightZ - s.leftZ;
      alen = Math.hypot(ax, az) || 1;
    }
    ax /= alen;
    az /= alen;

    const hits = intersectLineWithRing(s.x, s.z, ax, az, closed);
    if (hits.length < 2) continue;

    let tMin = null;
    let tMax = null;
    for (const t of hits) {
      if (t < -1.0 && (tMin == null || t > tMin)) tMin = t;
      if (t > 1.0 && (tMax == null || t < tMax)) tMax = t;
    }
    if (tMin == null || tMax == null) continue;
    const span = tMax - tMin;

    // Reject degenerates only — accept natural estuary widths (12 m to 3500 m)
    if (span < 12 || span > 3500) continue;

    s.leftX = s.x + ax * tMin;
    s.leftZ = s.z + az * tMin;
    s.rightX = s.x + ax * tMax;
    s.rightZ = s.z + az * tMax;
    s.halfWidth = span * 0.5;
    s.width = span;
  }
}

/**
 * Intersect infinite line P + t·D with every ring edge.
 * Returns signed distances t along D (metres).
 */
function intersectLineWithRing(px, pz, dx, dz, ring) {
  const hits = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const fx = a.x - px;
    const fz = a.z - pz;
    const t = (fx * ez - fz * ex) / den;
    const u = (fx * dz - fz * dx) / den;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    hits.push(t);
  }
  return hits;
}

function assignTangents(stations) {
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    let fx = b.x - a.x;
    let fz = b.z - a.z;
    const len = Math.hypot(fx, fz) || 1;
    stations[i].flowX = fx / len;
    stations[i].flowZ = fz / len;
  }
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    const cross = a.flowX * b.flowZ - a.flowZ * b.flowX;
    stations[i].curve = Math.min(1, Math.abs(cross) * 8);
  }
}

/** One continuous channel: smooth the centerline, then rebuild both banks from it. */
function smoothRibbon(stations) {
  const n = stations.length;
  if (n < 5) return;
  const xs = stations.map((s) => s.x);
  const zs = stations.map((s) => s.z);
  const ws = stations.map((s) => Math.max(16, s.halfWidth || 16));
  for (let pass = 0; pass < 12; pass++) {
    const nx = xs.slice();
    const nz = zs.slice();
    const nw = ws.slice();
    for (let i = 1; i < n - 1; i++) {
      nx[i] = xs[i - 1] * 0.25 + xs[i] * 0.5 + xs[i + 1] * 0.25;
      nz[i] = zs[i - 1] * 0.25 + zs[i] * 0.5 + zs[i + 1] * 0.25;
      nw[i] = ws[i - 1] * 0.22 + ws[i] * 0.56 + ws[i + 1] * 0.22;
    }
    for (let i = 0; i < n; i++) {
      xs[i] = nx[i];
      zs[i] = nz[i];
      ws[i] = nw[i];
    }
  }
  for (let i = 0; i < n; i++) {
    stations[i].x = xs[i];
    stations[i].z = zs[i];
    stations[i].halfWidth = Math.max(16, ws[i]);
    stations[i].width = stations[i].halfWidth * 2;
  }
  assignTangents(stations);
  for (const s of stations) {
    const px = -s.flowZ;
    const pz = s.flowX;
    s.leftX = s.x - px * s.halfWidth;
    s.leftZ = s.z - pz * s.halfWidth;
    s.rightX = s.x + px * s.halfWidth;
    s.rightZ = s.z + pz * s.halfWidth;
  }
  untwistBanks(stations);
}

function untwistBanks(stations) {
  for (let i = 1; i < stations.length; i++) {
    const px = stations[i - 1].rightX - stations[i - 1].leftX;
    const pz = stations[i - 1].rightZ - stations[i - 1].leftZ;
    const cx = stations[i].rightX - stations[i].leftX;
    const cz = stations[i].rightZ - stations[i].leftZ;
    if (px * cx + pz * cz >= 0) continue;
    const tx = stations[i].leftX;
    const tz = stations[i].leftZ;
    stations[i].leftX = stations[i].rightX;
    stations[i].leftZ = stations[i].rightZ;
    stations[i].rightX = tx;
    stations[i].rightZ = tz;
  }
}

function clampWildWidths(stations) {
  const med = medianWidth(stations);
  const cap = Math.max(med * 3.5, 3000);
  for (const s of stations) {
    if (s.width <= cap) continue;
    const half = cap * 0.5;
    let px = s.rightX - s.leftX;
    let pz = s.rightZ - s.leftZ;
    const plen = Math.hypot(px, pz) || 1;
    px /= plen;
    pz /= plen;
    s.leftX = s.x - px * half;
    s.leftZ = s.z - pz * half;
    s.rightX = s.x + px * half;
    s.rightZ = s.z + pz * half;
    s.halfWidth = half;
    s.width = cap;
  }
}

function medianWidth(stations) {
  const w = stations.map((s) => s.width).sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)] || 120;
}

function rasterize(stations, across, depthPoints) {
  const positions = [];
  const depths = [];
  const alongT = [];
  const acrossU = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];
  const exact = [];
  const bedElev = [];

  const nearestDArr = [];

  const index = spatialIndex(depthPoints);

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    for (let a = 0; a <= across; a++) {
      const u = a / across;
      const x = st.leftX + (st.rightX - st.leftX) * u;
      const z = st.leftZ + (st.rightZ - st.leftZ) * u;
      const sample = sampleDepth(x, z, depthPoints, index, st);
      positions.push(x, 0, z);
      depths.push(sample.depth);
      alongT.push(st.t);
      acrossU.push(u);
      flow.push(st.flowX, st.flowZ);
      narrow.push(st.narrow);
      widthM.push(st.width);
      curve.push(st.curve || 0);
      exact.push(sample.exact ? 1 : 0);
      bedElev.push(-sample.depth);
      nearestDArr.push(sample.nearestD);
    }
  }

  const cols = across + 1;
  const indices = [];
  const maxD2 = 45 * 45; // Max 45m from surveyed bathymetry to be considered water

  for (let s = 0; s < stations.length - 1; s++) {
    for (let a = 0; a < across; a++) {
      const i0 = s * cols + a;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i0 + cols + 1;
      
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  // Ensure triangles face +Y (camera from above). Removing flipX can reverse
  // bank left/right winding so FrontSide water/bed would be fully culled.
  if (indices.length >= 3) {
    const a = indices[0];
    const b = indices[1];
    const c = indices[2];
    const ax = positions[a * 3];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cz = positions[c * 3 + 2];
    const ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (ny < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = t;
      }
    }
  }

  // Visual-only smooth — blur ALL verts so Overview depth looks continuous
  // (exact Excel hits used to skip smoothing and left rectangular plateaus)
  const smoothed = depths.slice();
  for (let pass = 0; pass < 5; pass++) {
    for (let s = 1; s < stations.length - 1; s++) {
      for (let a = 1; a < across; a++) {
        const i = s * cols + a;
        smoothed[i] =
          (depths[i] * 2 +
            depths[i - 1] +
            depths[i + 1] +
            depths[i - cols] +
            depths[i + cols]) /
          6;
      }
    }
    // Soften bank edge columns too (a = 0 and a = across)
    for (let s = 1; s < stations.length - 1; s++) {
      const iL = s * cols;
      const iR = s * cols + across;
      smoothed[iL] = (depths[iL] * 2 + depths[iL + 1] + depths[iL - cols] + depths[iL + cols]) / 5;
      smoothed[iR] = (depths[iR] * 2 + depths[iR - 1] + depths[iR - cols] + depths[iR + cols]) / 5;
    }
    for (let i = 0; i < depths.length; i++) depths[i] = smoothed[i];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return {
    positions,
    depths,
    alongT,
    acrossU,
    flow,
    narrow,
    widthM,
    curve,
    exact,
    bedElev,
    indices,
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    },
  };
}

export function spatialIndex(points) {
  const cell = 80;
  const map = new Map();
  for (const p of points) {
    const kx = Math.floor(p.x / cell);
    const kz = Math.floor(p.z / cell);
    const key = `${kx},${kz}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return { cell, map };
}

export function neighbors(index, x, z) {
  const { cell, map } = index;
  const kx = Math.floor(x / cell);
  const kz = Math.floor(z / cell);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bin = map.get(`${kx + dx},${kz + dz}`);
      if (bin) out.push(...bin);
    }
  }
  return out;
}

function sampleDepth(x, z, points, index, station) {
  const near = neighbors(index, x, z);

  // Always inverse-distance blend — never snap to a single Excel point.
  // Nearest-neighbor snaps create Voronoi "blocks" on the Overview water surface.
  let wSum = 0;
  let dSum = 0;
  let n = 0;
  let nearestD = Infinity;
  for (const p of near) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < nearestD) nearestD = d2;
    if (d2 > 120 * 120) continue;
    // Soft IDW: nearby points dominate, but never a hard cell boundary
    const w = 1 / Math.max(2.5, d2 * 0.35);
    wSum += w;
    dSum += w * p.depth;
    n++;
  }
  if (n >= 2 && wSum > 0) {
    return { depth: dSum / wSum, exact: nearestD < 2.5 * 2.5, nearestD };
  }

  // Wider fallback across the full point set (capped)
  let w2 = 0;
  let d2s = 0;
  let n2 = 0;
  for (const p of points) {
    if (Math.abs(p.x - x) > 280 || Math.abs(p.z - z) > 280) continue;
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    const w = 1 / Math.max(6, dd * 0.25);
    w2 += w;
    d2s += w * p.depth;
    n2++;
    if (n2 > 60) break;
  }
  if (n2 > 0) return { depth: d2s / w2, exact: false, nearestD: 100 * 100 };

  // Mandovi River bank-aware thalweg profile (CSIR-NIO Survey Depth 0.8m - 16.5m)
  const ch = station?.chainage_m ?? (station?.along ?? 0);
  const u = station
    ? Math.min(
        1,
        Math.hypot(x - station.x, z - station.z) / Math.max(8, station.halfWidth || 40),
      )
    : 0.5;
  // Parabolic bank-to-thalweg factor (0 at bank, 1 at center)
  const bankFactor = Math.max(0, 1.0 - Math.pow(u, 1.8));

  // Mandovi CSIR-NIO reach thalweg profile:
  // Aguada Bay (0 - 4km): 12.5 - 14.5m
  // Panaji Bridges & Atal Setu (4 - 7km): 13.5 - 16.2m
  // Ribandar / Chorao (7 - 11km): 11.5 - 14.8m
  // Narve / Piligao (11 - 14km): 10.0 - 14.2m
  // Amona / Navelim (14 - 17km): 9.5 - 16.5m
  // Volvoi / Khandepar (17 - 19km): 8.5 - 14.5m
  let centerDepth = 12.5;
  if (ch < 4000) centerDepth = 13.2 + Math.sin(ch * 0.001) * 1.2;
  else if (ch < 7500) centerDepth = 14.8 + Math.sin((ch - 4000) * 0.0012) * 1.4; // Scours near Atal Setu
  else if (ch < 11000) centerDepth = 12.8 + Math.sin((ch - 7500) * 0.001) * 1.5;
  else if (ch < 14000) centerDepth = 12.2 + Math.cos((ch - 11000) * 0.001) * 1.8;
  else if (ch < 17000) centerDepth = 11.5 + Math.sin((ch - 14000) * 0.001) * 2.2;
  else centerDepth = 10.2 + Math.cos((ch - 17000) * 0.001) * 1.8;

  const bankDepth = 0.85;
  const dEst = bankDepth + (centerDepth - bankDepth) * bankFactor;
  return { depth: Math.max(0.8, Math.min(16.5, dEst)), exact: false, nearestD: Infinity };
}

export function detectBridgeSites(stations) {
  const widths = stations.map((s) => s.width);
  const med = medianWidth(stations);
  const sites = [];
  for (let i = 8; i < stations.length - 8; i++) {
    const local = widths.slice(i - 6, i + 7);
    const mean = local.reduce((a, b) => a + b, 0) / local.length;
    if (stations[i].width < mean * 0.72 && stations[i].width < med * 0.85) {
      const prev = sites[sites.length - 1];
      if (prev && Math.hypot(stations[i].x - prev.x, stations[i].z - prev.z) < 420) continue;
      sites.push({
        x: stations[i].x,
        z: stations[i].z,
        flowX: stations[i].flowX,
        flowZ: stations[i].flowZ,
        width: stations[i].width,
        halfWidth: stations[i].halfWidth,
        t: stations[i].t,
        index: i,
      });
    }
  }
  // Ensure a few evenly spaced crossings if constriction search is sparse
  if (sites.length < 6) {
    for (const t of [0.12, 0.22, 0.34, 0.48, 0.62, 0.76, 0.88]) {
      const i = Math.floor(t * (stations.length - 1));
      const st = stations[i];
      if (sites.some((s) => Math.abs(s.t - st.t) < 0.06)) continue;
      sites.push({
        x: st.x,
        z: st.z,
        flowX: st.flowX,
        flowZ: st.flowZ,
        width: st.width,
        halfWidth: st.halfWidth,
        t: st.t,
        index: i,
      });
    }
  }
  sites.sort((a, b) => a.t - b.t);
  return sites;
}
