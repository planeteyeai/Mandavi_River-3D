/**
 * Live Water Surface — footprint from live_water_mandavi.kml only.
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
import { spatialIndex, neighbors } from "../geo/corridor.js";
import { nearestStationU } from "../scene/riverCamera.js";
import { state } from "../state.js";

/**
 * @param {THREE.Scene} scene
 * @param {{
 *   dataset?: object,
 *   sharedMaterial?: THREE.ShaderMaterial,
 *   getTerrainY?: (x:number,z:number)=>number,
 *   getSurfaceY?: () => number,
 *   getVisibility?: () => boolean,
 * }} [opts]
 */
export async function addLiveWaterSurfaceLayer(scene, opts = {}) {
  const dataset = opts.dataset || null;
  const sharedMaterial = opts.sharedMaterial || null;
  const getTerrainY = opts.getTerrainY || (() => SURFACE_Y - 2);
  const getSurfaceY = opts.getSurfaceY || (() => SURFACE_Y);
  const getVisibility = opts.getVisibility || (() => true);

  const mask = await loadLiveWaterMask();
  if (!mask.available) {
    console.warn("[liveWaterSurface] mask unavailable — skipping live water mesh");
    return { group: null, mask, material: null, dispose() {}, setVisible() {}, refresh() {} };
  }

  const group = new THREE.Group();
  group.name = "LiveWaterSurface_Mandovi_KML";
  scene.add(group);

  const depthAt = buildDepthSampler(dataset, getTerrainY);
  const built = buildHydroWaterMesh(mask, dataset, depthAt, getSurfaceY(), sharedMaterial);
  if (!built) {
    console.warn("[liveWaterSurface] failed to build mesh");
    return { group, mask, material: null, dispose() {}, setVisible() {}, refresh() {} };
  }

  const { surface, bed, material, ownsMaterial } = built;
  // Surface only in water mode — shared river material = identical colour everywhere.
  // Bed only for depth-zone view (avoids a second mismatched tint under the sheet).
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
  }

  const api = {
    group,
    mask,
    material,
    surface,
    bed,
    setVisible(v) {
      group.visible = !!v;
    },
    refresh() {
      const y = getSurfaceY();
      group.visible = getVisibility();
      const rise =
        (state.floodMode === "api" ? Number(state.floodRiseM) || 0 : 0) +
        (Number(state.liveStageRiseM) || 0);
      group.position.y = y - SURFACE_Y + rise;
      // Shared material is synced by world via river.material — do not diverge.
      if (material && ownsMaterial) {
        if (material.uniforms?.uTime) material.uniforms.uTime.value = state.elapsed || 0;
        syncWaterMaterial(material);
      }
      const waterOn = state.showWater !== false;
      const depthLook = state.showDepthZones === true;
      if (surface) surface.visible = waterOn && !depthLook;
      if (bed) bed.visible = !!depthLook;
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material && o.material !== sharedMaterial) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else o.material.dispose?.();
        }
      });
    },
  };

  api.refresh();
  console.info("[liveWaterSurface] shared river material fill", {
    source: mask.source,
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
 */
function buildHydroWaterMesh(mask, dataset, depthAt, surfaceY, sharedMaterial = null) {
  const { bounds, width, height, mask: bits } = mask;
  if (!bits || !width || !height) return null;

  // Denser grid so the KML footprint fills continuously (no empty channel gaps).
  const step = Math.max(1, Math.floor(Math.min(width, height) / 520));
  const cols = Math.floor((width - 1) / step) + 1;
  const rows = Math.floor((height - 1) / step) + 1;
  if (cols < 2 || rows < 2) return null;

  // Dilate mask 1 cell so bank-edge water still triangulates.
  const dilate = new Uint8Array(bits.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (bits[i]) {
        dilate[i] = 1;
        continue;
      }
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (bits[ny * width + nx]) {
            dilate[i] = 1;
            break outer;
          }
        }
      }
    }
  }

  const { north, south, east, west } = bounds || LIVE_WATER_BOUNDS;
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
      const px = Math.min(width - 1, col * step);
      const py = Math.min(height - 1, row * step);
      if (!dilate[py * width + px]) continue;

      const u = px / Math.max(1, width - 1);
      const v = py / Math.max(1, height - 1);
      const lon = west + u * (east - west);
      const lat = north - v * (north - south);
      const w = geoToWorld(lon, lat, surfaceY);
      const d = depthAt(w.x, w.z);

      indexOf[row * cols + col] = vi++;
      positions.push(w.x, surfaceY + 0.55, w.z);
      depths.push(d);
      // along ~ west→east estuary axis; across ~ north–south within overlay
      along.push(THREE.MathUtils.clamp(u, 0, 1));
      across.push(THREE.MathUtils.clamp(v, 0, 1));
      flow.push(-1, 0); // seaward / west
      narrow.push(0);
      widthM.push(180);
      curve.push(0);

      const bedY = bedElevation(d, DEPTH_LEGEND_MIN, DEPTH_LEGEND_MAX, v, exag);
      bedPos.push(w.x, bedY, w.z);
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
  surface.renderOrder = 4;
  surface.frustumCulled = false;
  surface.userData = {
    kind: "live_water",
    provenance: "OBSERVED",
    source: "live_water_mandavi.kml",
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
