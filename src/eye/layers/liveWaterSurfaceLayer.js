/**
 * Live Water Surface — footprint from fused optical (S2 MNDWI) + SAR (S1)
 * water mask when available, else live_water_mandavi.kml alone.
 * Appearance matches the corridor river: same water shader + hydrographic
 * depth colours driven by DTM / survey metres (legend 0.5–16.5 m).
 */
import * as THREE from "three";
import { geoToWorld } from "../geo/geoReference.js";
import { loadLiveWaterMask, LIVE_WATER_BOUNDS } from "../geo/liveWaterMask.js";
import {
  SURFACE_Y,
  DEPTH_LEGEND_MIN,
  DEPTH_LEGEND_MAX,
  getHydrographicColor,
  bedElevation,
} from "../scene/river.js";
import { createWaterMaterial, syncWaterMaterial } from "../scene/waterShader.js";
import { spatialIndex, neighbors, isPointInPolygon } from "../geo/corridor.js";
import { nearestStationU } from "../scene/riverCamera.js";
import { state } from "../state.js";

/**
 * @param {THREE.Scene} scene
 * @param {{
 *   dataset?: object,
 *   sharedMaterial?: THREE.ShaderMaterial,
 *   channelColor?: "deep"|"match",
 *   getTerrainY?: (x:number,z:number)=>number,
 *   getSurfaceY?: () => number,
 *   getVisibility?: () => boolean,
 *   mask?: object|null,
 * }} [opts]
 */
export async function addLiveWaterSurfaceLayer(scene, opts = {}) {
  const dataset = opts.dataset || null;
  const sharedMaterial = opts.sharedMaterial || null;
  /** deep = darker mid-channel fill over the light corridor halo */
  const channelColor = opts.channelColor === "deep" ? "deep" : "match";
  const getTerrainY = opts.getTerrainY || (() => SURFACE_Y - 2);
  const getSurfaceY = opts.getSurfaceY || (() => SURFACE_Y);
  const getVisibility = opts.getVisibility || (() => true);

  function applyDeepChannelTint(mat) {
    const u = mat?.uniforms;
    if (!u || channelColor !== "deep") return;
    // Lighter mid-channel (still a touch deeper than the bank ribbon).
    if (u.uC0) u.uC0.value.set("#5EC8F0");
    if (u.uC1) u.uC1.value.set("#4EB8E0");
    if (u.uC2) u.uC2.value.set("#3AA0D0");
    if (u.uC3) u.uC3.value.set("#2A79AB");
    if (u.uShowDepth) u.uShowDepth.value = 0;
    if (u.uOpacity) u.uOpacity.value = Math.max(0.92, Number(u.uOpacity.value) || 0.94);
  }

  let mask = opts.mask?.available ? opts.mask : await loadLiveWaterMask();
  if (!mask?.available) {
    console.warn("[liveWaterSurface] mask unavailable — skipping live water mesh");
    return { group: null, mask, material: null, dispose() {}, setVisible() {}, refresh() {}, rebuildFromMask() {} };
  }

  const group = new THREE.Group();
  group.name = "LiveWaterSurface_Mandovi_KML";
  scene.add(group);

  let surface = null;
  let bed = null;
  let material = null;
  let ownsMaterial = false;

  function clearMeshes() {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.geometry?.dispose?.();
      if (child.material && child.material !== sharedMaterial) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material.dispose?.();
      }
    }
    surface = null;
    bed = null;
  }

  function mountFromMask(nextMask) {
    if (!nextMask?.available || !nextMask.mask) return false;
    const depthAt = buildDepthSampler(dataset, getTerrainY);
    const built = buildHydroWaterMesh(nextMask, dataset, depthAt, getSurfaceY(), sharedMaterial);
    if (!built) return false;
    clearMeshes();
    mask = nextMask;
    surface = built.surface;
    bed = built.bed;
    material = built.material;
    ownsMaterial = built.ownsMaterial;
    group.add(surface);
    if (bed) {
      bed.visible = false;
      group.add(bed);
    }
    if (material?.uniforms && !sharedMaterial) {
      material.uniforms.uMinDepth.value = Number.isFinite(dataset?.minDepth)
        ? dataset.minDepth
        : DEPTH_LEGEND_MIN;
      material.uniforms.uMaxDepth.value = Number.isFinite(dataset?.maxDepth)
        ? dataset.maxDepth
        : DEPTH_LEGEND_MAX;
      syncWaterMaterial(material);
      applyDeepChannelTint(material);
    }
    const src = nextMask.source || nextMask.provenance || "live_water_mandavi.kml";
    if (surface?.userData) {
      surface.userData.source = src;
      surface.userData.provenance = nextMask.provenance || "OBSERVED";
    }
    return true;
  }

  if (!mountFromMask(mask)) {
    console.warn("[liveWaterSurface] failed to build mesh");
    return { group, mask, material: null, dispose() {}, setVisible() {}, refresh() {}, rebuildFromMask() {} };
  }

  const api = {
    group,
    get mask() {
      return mask;
    },
    get material() {
      return material;
    },
    get surface() {
      return surface;
    },
    get bed() {
      return bed;
    },
    setVisible(v) {
      group.visible = !!v;
    },
    /**
     * Rebuild the sheet from a fused optical∪SAR mask (or any compatible mask).
     * @param {object} nextMask
     */
    rebuildFromMask(nextMask) {
      if (!nextMask?.available) return false;
      const ok = mountFromMask(nextMask);
      if (ok) {
        api.refresh();
        console.info("[liveWaterSurface] rebuilt from fused mask", {
          source: nextMask.source,
          provenance: nextMask.provenance,
          verts: surface?.geometry?.attributes?.position?.count,
          stats: nextMask.stats || null,
        });
      }
      return ok;
    },
    refresh() {
      const y = getSurfaceY();
      group.visible = getVisibility();
      const rise =
        (state.floodMode === "api" ? Number(state.floodRiseM) || 0 : 0) +
        (Number(state.liveStageRiseM) || 0);
      group.position.y = y - SURFACE_Y + rise;
      // Own material: sync waves/opacity then re-assert darker mid-channel tint.
      if (material && ownsMaterial) {
        if (material.uniforms?.uTime) material.uniforms.uTime.value = state.elapsed || 0;
        syncWaterMaterial(material);
        applyDeepChannelTint(material);
      }
      const waterOn = state.showWater !== false;
      const depthLook = state.showDepthZones === true || state.bathymetryMode === true;
      // Keep a continuous filled water sheet under bathymetry (no empty channel gaps).
      if (surface) {
        surface.visible = waterOn;
        if (ownsMaterial && material?.uniforms?.uShowDepth) {
          material.uniforms.uShowDepth.value = depthLook ? 1 : 0;
        }
      }
      if (bed) bed.visible = false;
    },
    dispose() {
      scene.remove(group);
      clearMeshes();
    },
  };

  api.refresh();
  console.info("[liveWaterSurface] shared river material fill", {
    source: mask.source,
    provenance: mask.provenance || "OPTICAL",
    verts: surface?.geometry?.attributes?.position?.count,
    shared: !!sharedMaterial,
  });
  return api;
}

function buildDepthSampler(dataset, getTerrainY) {
  const bath = dataset?.bathymetry;
  const stations = dataset?.corridor?.stations || [];
  const points = [];
  if (bath?.positions && bath?.depths) {
    const n = bath.depths.length;
    for (let i = 0; i < n; i++) {
      const d = bath.depths[i];
      if (!Number.isFinite(d)) continue;
      points.push({
        x: bath.positions[i * 3],
        z: bath.positions[i * 3 + 2],
        depth: d,
      });
    }
  }
  const index = points.length ? spatialIndex(points) : null;
  const maxD = Number.isFinite(dataset?.maxDepth) ? dataset.maxDepth : DEPTH_LEGEND_MAX;
  const minD = Number.isFinite(dataset?.minDepth) ? dataset.minDepth : DEPTH_LEGEND_MIN;

  return (x, z) => {
    // 1) Survey / corridor IDW (observed metres)
    if (index) {
      const near = neighbors(index, x, z);
      let wSum = 0;
      let dSum = 0;
      let n = 0;
      for (const p of near) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 > 220 * 220) continue;
        const w = 1 / Math.max(2.5, d2 * 0.35);
        wSum += w;
        dSum += w * p.depth;
        n++;
      }
      if (n >= 2 && wSum > 0) {
        return THREE.MathUtils.clamp(dSum / wSum, minD * 0.5, maxD);
      }
    }

    // 2) DTM: depth = water surface − terrain (metres)
    const ty = getTerrainY(x, z);
    if (Number.isFinite(ty)) {
      const dtmDepth = SURFACE_Y - ty;
      if (dtmDepth > 0.12) {
        return THREE.MathUtils.clamp(dtmDepth, 0.3, maxD);
      }
    }

    // 3) Soft thalweg guess from nearest station when in open mouth
    if (stations.length) {
      const u = nearestStationU(stations, x, z);
      const st = stations[Math.min(stations.length - 1, Math.max(0, Math.round(u * (stations.length - 1))))];
      const half = Math.max(8, st?.halfWidth || 40);
      const dist = Math.hypot(x - st.x, z - st.z);
      const bank = Math.min(1, dist / half);
      const centerD = THREE.MathUtils.clamp(st?.depth ?? 3.5, minD, maxD);
      return THREE.MathUtils.clamp(centerD * (1 - bank * bank) + 0.6 * bank, 0.35, maxD);
    }

    return 2.0;
  };
}

/**
 * Build surface (same water shader) + bed (hydrographic vertex colours).
 * Shape is clipped to Mandovi ringLocal so creek/island endings do not spill onto land.
 */
function buildHydroWaterMesh(mask, dataset, depthAt, surfaceY, sharedMaterial = null) {
  // Prefer high-res optical raster for shoreline; wetness still uses fused sampler when present.
  const src = mask.optical?.mask && mask.optical.width >= (mask.width || 0) ? mask.optical : mask;
  const bits = src.mask || mask.mask;
  const width = src.width || mask.width;
  const height = src.height || mask.height;
  const bounds = mask.bounds || src.bounds || LIVE_WATER_BOUNDS;
  if (!bits || !width || !height) return null;

  const ring = dataset?.ringLocal || null;
  const stations = dataset?.corridor?.stations || [];
  const isWetLonLat =
    typeof mask.isWaterAtLonLat === "function"
      ? (lon, lat) => mask.isWaterAtLonLat(lon, lat)
      : null;

  // Finer grid → smoother shoreline (still capped for perf).
  const step = Math.max(1, Math.floor(Math.min(width, height) / 900));
  const cols = Math.floor((width - 1) / step) + 1;
  const rows = Math.floor((height - 1) / step) + 1;
  if (cols < 2 || rows < 2) return null;

  const { north, south, east, west } = bounds;

  function nearCorridor(x, z) {
    if (!stations.length) return true;
    let best = Infinity;
    let half = 80;
    for (let i = 0; i < stations.length; i += Math.max(1, Math.floor(stations.length / 80))) {
      const st = stations[i];
      const d = Math.hypot(x - st.x, z - st.z);
      if (d < best) {
        best = d;
        half = Math.max(40, Number(st.halfWidth) || Number(st.width) * 0.5 || 80);
      }
    }
    for (const st of [stations[0], stations[stations.length - 1]]) {
      if (!st) continue;
      const d = Math.hypot(x - st.x, z - st.z);
      if (d < best) {
        best = d;
        half = Math.max(40, Number(st.halfWidth) || Number(st.width) * 0.5 || 80);
      }
    }
    return best <= half * 1.55;
  }

  // Pre-sample wet cells, then majority-smooth so corners aren't stair-stepped.
  const rawWet = new Uint8Array(cols * rows);
  const worldXZ = new Float32Array(cols * rows * 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = Math.min(width - 1, col * step);
      const py = Math.min(height - 1, row * step);
      const u = px / Math.max(1, width - 1);
      const v = py / Math.max(1, height - 1);
      const lon = west + u * (east - west);
      const lat = north - v * (north - south);
      const wetBit = isWetLonLat ? isWetLonLat(lon, lat) : bits[py * width + px] === 1;
      if (!wetBit) continue;
      const w = geoToWorld(lon, lat, surfaceY);
      if (ring?.length >= 3 && !isPointInPolygon(w.x, w.z, ring)) continue;
      if (!nearCorridor(w.x, w.z)) continue;
      const i = row * cols + col;
      rawWet[i] = 1;
      worldXZ[i * 2] = w.x;
      worldXZ[i * 2 + 1] = w.z;
    }
  }

  // 1) Close single-cell holes  2) Drop isolated speckles (smooth corners).
  const smoothWet = new Uint8Array(rawWet);
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const i = row * cols + col;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          n += rawWet[(row + dy) * cols + (col + dx)];
        }
      }
      if (!rawWet[i] && n >= 5) smoothWet[i] = 1; // fill hole
      if (rawWet[i] && n <= 2) smoothWet[i] = 0; // drop speckles
    }
  }

  const positions = [];
  const depths = [];
  const along = [];
  const across = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];
  const bedPos = [];
  const bedCol = [];
  const indexOf = new Int32Array(cols * rows).fill(-1);
  const tmp = new THREE.Color();
  const exag = Math.max(1, Number(state.depthExaggeration) || 1);

  let vi = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (!smoothWet[i]) continue;

      const px = Math.min(width - 1, col * step);
      const py = Math.min(height - 1, row * step);
      const u = px / Math.max(1, width - 1);
      const v = py / Math.max(1, height - 1);
      let wx = worldXZ[i * 2];
      let wz = worldXZ[i * 2 + 1];
      if (!rawWet[i]) {
        // Hole-fill cell — recompute world pos
        const lon = west + u * (east - west);
        const lat = north - v * (north - south);
        const w = geoToWorld(lon, lat, surfaceY);
        if (ring?.length >= 3 && !isPointInPolygon(w.x, w.z, ring)) continue;
        wx = w.x;
        wz = w.z;
      }

      const d = depthAt(wx, wz);
      indexOf[i] = vi++;
      // Keep flush with SURFACE_Y so ships sit on the same plane (tiny lift vs bed z-fight).
      positions.push(wx, surfaceY + 0.08, wz);
      depths.push(d);
      along.push(THREE.MathUtils.clamp(u, 0, 1));

      let acrossU = 0.5;
      if (stations.length) {
        const st =
          stations[
            Math.min(
              stations.length - 1,
              Math.max(0, Math.round(nearestStationU(stations, wx, wz) * (stations.length - 1))),
            )
          ];
        if (st && Number.isFinite(st.leftX) && Number.isFinite(st.rightX)) {
          const lx = st.rightX - st.leftX;
          const lz = st.rightZ - st.leftZ;
          const len2 = lx * lx + lz * lz || 1;
          acrossU = THREE.MathUtils.clamp(
            ((wx - st.leftX) * lx + (wz - st.leftZ) * lz) / len2,
            0,
            1,
          );
        } else {
          const half = Math.max(20, Number(st?.halfWidth) || 40);
          const dist = Math.hypot(wx - (st?.x || 0), wz - (st?.z || 0));
          acrossU = THREE.MathUtils.clamp(dist / (2 * half), 0, 1);
        }
      }
      across.push(acrossU);
      flow.push(-1, 0);
      narrow.push(0);
      widthM.push(180);
      curve.push(0);

      const bedY = bedElevation(d, DEPTH_LEGEND_MIN, DEPTH_LEGEND_MAX, acrossU, exag);
      bedPos.push(wx, bedY, wz);
      getHydrographicColor(d, tmp);
      bedCol.push(tmp.r, tmp.g, tmp.b);
    }
  }

  const indices = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = indexOf[row * cols + col];
      const b = indexOf[row * cols + col + 1];
      const c = indexOf[(row + 1) * cols + col];
      const d = indexOf[(row + 1) * cols + col + 1];
      // Fill every possible triangle so the live-water polygon stays solid.
      if (a >= 0 && b >= 0 && c >= 0) indices.push(a, c, b);
      if (b >= 0 && c >= 0 && d >= 0) indices.push(b, c, d);
      else if (a >= 0 && b >= 0 && d >= 0) indices.push(a, b, d);
      else if (a >= 0 && c >= 0 && d >= 0) indices.push(a, c, d);
    }
  }

  if (positions.length < 9 || indices.length < 3) return null;

  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  surfGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));
  surfGeo.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  surfGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  surfGeo.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
  surfGeo.setAttribute("aNarrow", new THREE.Float32BufferAttribute(narrow, 1));
  surfGeo.setAttribute("aWidth", new THREE.Float32BufferAttribute(widthM, 1));
  surfGeo.setAttribute("aCurve", new THREE.Float32BufferAttribute(curve, 1));
  surfGeo.setIndex(indices);
  surfGeo.computeVertexNormals();

  const ownsMaterial = !sharedMaterial;
  const material =
    sharedMaterial ||
    createWaterMaterial({
      ...dataset,
      minDepth: Number.isFinite(dataset?.minDepth) ? dataset.minDepth : DEPTH_LEGEND_MIN,
      maxDepth: Number.isFinite(dataset?.maxDepth) ? dataset.maxDepth : DEPTH_LEGEND_MAX,
    });

  const surface = new THREE.Mesh(surfGeo, material);
  surface.name = "LiveWater_KML_Surface";
  surface.renderOrder = 6; // above corridor river (halo) so dark mid-channel reads on top
  surface.frustumCulled = false;
  surface.userData = {
    kind: "live_water",
    provenance: mask.provenance || "OBSERVED",
    source: mask.source || "live_water_mandavi.kml",
    vertexCount: vi,
    triangleCount: indices.length / 3,
  };

  // Depth-view bed only (hidden in normal water mode so colour stays identical).
  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute("color", new THREE.Float32BufferAttribute(bedCol, 3));
  bedGeo.setAttribute("colorDepthView", new THREE.Float32BufferAttribute(bedCol.slice(), 3));
  bedGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));
  bedGeo.setIndex(indices);
  bedGeo.computeVertexNormals();

  const bedMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.name = "LiveWater_KML_Bed";
  bed.receiveShadow = true;
  bed.renderOrder = 1;
  bed.frustumCulled = false;
  bed.visible = false;
  bed.userData = { kind: "live_water_bed", source: "live_water_mandavi.kml" };

  return { surface, bed, material, ownsMaterial };
}
