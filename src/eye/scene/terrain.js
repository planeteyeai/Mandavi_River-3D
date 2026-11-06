import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds } from "../geo/sceneBounds.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { loadOsmWater, isObservedWater } from "../geo/osmWater.js";
import { localToLonLat, lonLatToLocal } from "../geo/geoReference.js";
import { spatialIndex, neighbors, isPointInPolygon } from "../geo/corridor.js";
import { wseSpatialService } from "../services/hydrology/wseSpatialService.js";

let activeDtm = null;
let activeDataset = null;
let activeLulc = null;
let activeOsmWater = null;
let activePointsIndex = null;
/** Scene X/Z box actually covered by the terrain mesh (real DTM extent when one is loaded). */
let activeTerrainBounds = null;

/** WGS84 extent of /data/mandovi/satellite_imagery.jpg (same bounds as the FABDEM AOI tile). */
export const SATELLITE_BOUNDS = { west: 73.76, east: 73.89, south: 15.45, north: 15.53 };

/**
 * Satellite imagery is an optional drape on the 3D ground (terrain grid + channel banks), never
 * the default look. Both meshes share one texture and one mix uniform, so the toggle is a uniform
 * change (no shader recompiles) and the drape stays registered across the bank/terrain join.
 */
const satDrape = { texture: null, loaded: false, wanted: false, mix: { value: 0 } };

function satelliteTexture() {
  if (satDrape.texture) return satDrape.texture;
  satDrape.texture = new THREE.TextureLoader().load(
    "/data/mandovi/satellite_imagery.jpg",
    (tex) => {
      tex.anisotropy = 8;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      satDrape.loaded = true;
      satDrape.mix.value = satDrape.wanted ? 1 : 0;
    },
    undefined,
    (err) => console.warn("[terrain] satellite imagery texture notice:", err?.message || err),
  );
  satDrape.texture.colorSpace = THREE.SRGBColorSpace;
  return satDrape.texture;
}

/** Unclamped imagery UV for a scene point; outside 0..1 the ground keeps its natural colours. */
export function satelliteUv(x, z) {
  const ll = localToLonLat(x, z);
  const { west, east, south, north } = SATELLITE_BOUNDS;
  return [(ll.lon - west) / (east - west), (ll.lat - south) / (north - south)];
}

/** Natural vertex-coloured ground with the satellite image blended in by uSatMix (0 = off). */
export function applyTerrainSurface(material) {
  material.vertexColors = true;
  material.map = satelliteTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSatMix = satDrape.mix;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aShade;\nvarying float vShade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShade = aShade;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSatMix;\nvarying float vShade;")
      .replace("#include <map_fragment>", "")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
#ifdef USE_MAP
  vec2 satUv = vMapUv;
  float satIn = step(0.0, satUv.x) * step(satUv.x, 1.0) * step(0.0, satUv.y) * step(satUv.y, 1.0);
  // Imagery is already sun-lit, so soft scene lighting alone flattens it: a DTM hillshade
  // keeps hills, slopes and valleys readable under the drape.
  vec3 satRgb = texture2D(map, clamp(satUv, 0.0, 1.0)).rgb * mix(1.0, vShade, 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * satRgb, satIn * uSatMix);
#endif`,
      );
  };
  material.customProgramCacheKey = () => "terrain-sat-drape";
  return material;
}

/** Layers → Satellite Imagery: drape (true) or natural terrain materials (false). */
export function setTerrainSatellite(on) {
  satDrape.wanted = !!on;
  if (on) satelliteTexture();
  satDrape.mix.value = satDrape.wanted && satDrape.loaded ? 1 : 0;
}

/**
 * FABDEM DTM terrain when available; procedural fallback otherwise.
 * Covers full KML + OSM union with geographic padding.
 */
export async function createTerrain(dataset) {
  activeDtm = dataset.dtm || null;
  activeDataset = dataset;
  activePointsIndex = spatialIndex(dataset.points || []);
  activeLulc = await loadLulcClassGrid();
  try {
    activeOsmWater = await loadOsmWater();
  } catch (e) {
    console.warn("[terrain] OSM water unavailable", e);
    activeOsmWater = null;
  }
  // Only real FABDEM elevation is rendered: the grid stops at the DTM edge instead of padding
  // the AOI with invented, near-flat procedural ground.
  const b = clipToDtm(computeSceneBounds(dataset), activeDtm);
  activeTerrainBounds = b;
  const width = b.spanX;
  const depth = b.spanZ;
  const lite = dataset.lite === true;
  // Full tier resolves FABDEM's ~30 m hills and valleys; lite keeps the lighter grid.
  const segsX = activeDtm ? (lite ? 200 : 360) : (lite ? 140 : 200);
  const segsZ = activeDtm ? (lite ? 100 : 180) : (lite ? 70 : 100);
  const geo = new THREE.PlaneGeometry(width, depth, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stations = dataset.corridor.stations;
  const heights = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z, stations, activeDtm);
    pos.setY(i, y);
    heights[i] = y;
  }

  const nx = segsX + 1;
  const nz = segsZ + 1;
  antialiasShoreline(pos, heights, nx, nz);
  if (!activeDtm) {
    for (let pass = 0; pass < 2; pass++) {
      const next = heights.slice();
      for (let iz = 1; iz < nz - 1; iz++) {
        for (let ix = 1; ix < nx - 1; ix++) {
          const i = iz * nx + ix;
          const y = heights[i];
          const n0 = heights[i - 1];
          const n1 = heights[i + 1];
          const n2 = heights[i - nx];
          const n3 = heights[i + nx];
          if (y > SURFACE_Y + 0.4 && n0 > SURFACE_Y && n1 > SURFACE_Y && n2 > SURFACE_Y && n3 > SURFACE_Y) continue;
          const avg = (y + n0 + n1 + n2 + n3) * 0.2;
          next[i] = y * 0.32 + avg * 0.68;
        }
      }
      heights.set(next);
    }
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i]);
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    minY = Math.min(minY, heights[i]);
    maxY = Math.max(maxY, heights[i]);
  }
  if (activeDtm) {
    minY = Math.min(minY, activeDtm.minSceneY ?? minY);
    maxY = Math.max(maxY, activeDtm.maxSceneY ?? maxY);
  }
  const ySpan = Math.max(8, maxY - minY);

  const cLow = new THREE.Color("#4a6e48");
  const cGrass = new THREE.Color("#6a8664");
  const cOlive = new THREE.Color("#8a9a62");
  const cEarth = new THREE.Color("#9a7a52");
  const cStone = new THREE.Color("#b8a888");
  const cBank = new THREE.Color("#847252");
  const cWet = new THREE.Color("#5f7a66");
  const cRock = new THREE.Color("#8c7a62");
  // Land-cover tints (2026 LULC raster) — ground under OSM buildings, forest, fields, laterite.
  const LAND_TINT = {
    forest: [new THREE.Color("#3e5c34"), 0.5],
    crop: [new THREE.Color("#8e9a58"), 0.38],
    settlement: [new THREE.Color("#9c9180"), 0.42],
    barren: [new THREE.Color("#a07a54"), 0.42],
    water: [new THREE.Color("#5a7262"), 0.3],
  };
  const cellX = width / segsX;
  const cellZ = depth / segsZ;
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = heights[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const near = nearest(x, z, stations);
    const lat = near.lat;
    const half = near.st.halfWidth;

    if (y < SURFACE_Y - 0.05) {
      const wet = THREE.MathUtils.clamp((SURFACE_Y - y) / 4, 0, 1);
      tmp.copy(cGrass).lerp(cBank, 0.28 + wet * 0.2);
      tmp.lerp(cWet, wet * 0.22);
    } else if (activeDtm) {
      const hn = THREE.MathUtils.clamp((y - minY) / ySpan, 0, 1);
      tmp.copy(cLow).lerp(cGrass, smooth(hn, 0.05, 0.32));
      tmp.lerp(cOlive, smooth(hn, 0.28, 0.58));
      tmp.lerp(cEarth, smooth(hn, 0.5, 0.78));
      tmp.lerp(cStone, smooth(hn, 0.72, 1));
      if (lat < half * 1.8) tmp.lerp(cBank, (1 - lat / (half * 1.8)) * 0.28);
      if (lat < half * 0.9) tmp.lerp(cWet, 0.18 * (1 - lat / (half * 0.9)));
    } else {
      const hn = THREE.MathUtils.clamp((y - (SURFACE_Y - 2)) / 28, 0, 1);
      const slopeHint = fbm(x * 0.0025, z * 0.0025);
      tmp.copy(cWet).lerp(cGrass, smooth(hn, 0.04, 0.28));
      tmp.lerp(cOlive, smooth(hn, 0.26, 0.55));
      tmp.lerp(cEarth, smooth(hn, 0.48, 0.78));
      tmp.lerp(cStone, smooth(hn, 0.7, 1) * (0.25 + slopeHint * 0.3));
      if (lat < half * 2.2) tmp.lerp(cBank, (1 - lat / (half * 2.2)) * 0.38);
    }

    if (y >= SURFACE_Y - 0.05) {
      const tint = LAND_TINT[activeLulc?.classAtLocal?.(x, z)];
      if (tint) tmp.lerp(tint[0], tint[1]);
      // Steep DTM faces read as exposed laterite / rock rather than grass.
      const ix = i % nx;
      const iz = (i - ix) / nx;
      if (ix > 0 && ix < nx - 1 && iz > 0 && iz < nz - 1) {
        const gx = (heights[i + 1] - heights[i - 1]) / (2 * cellX);
        const gz = (heights[i + nx] - heights[i - nx]) / (2 * cellZ);
        tmp.lerp(cRock, smooth(Math.hypot(gx, gz), 0.12, 0.5) * 0.55);
      }
      // Low-frequency brightness variation so large flat areas don't look like one polygon.
      tmp.multiplyScalar(0.92 + fbm(x * 0.006, z * 0.006) * 0.16);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  // Georeferenced imagery UVs (lon/lat → image). Left unclamped: the drape shader keeps natural
  // colours outside the image instead of smearing its edge pixels across the terrain.
  const uvs = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = satelliteUv(pos.getX(i), pos.getZ(i));
    uvs.setXY(i, u, v);
  }
  uvs.needsUpdate = true;

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aShade", new THREE.BufferAttribute(hillshade(heights, nx, nz, cellX, cellZ), 1));
  geo.computeVertexNormals();

  // Natural elevation / land-cover materials by default; satellite imagery is an optional drape.
  const mat = applyTerrainSurface(
    new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0.0,
      flatShading: false,
    }),
  );

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.setSatellite = setTerrainSatellite;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "terrain";

  const skirt = createTerrainSkirt(geo, nx, nz, minY);
  mesh.add(skirt);
  mesh.userData.updateSkirt = () => skirt.userData.update();

  // Hide procedural surround plane so it does not obscure authentic terrain/shoreline
  const surround = createGroundSurround(b, heights, minY);
  surround.visible = false;

  const outline = kmlOutline(dataset.ringLocal);
  outline.visible = false;
  return { mesh, outline, surround, bounds: b };
}

/** Classic NW-sun hillshade of the height grid, normalised so flat ground = 1 (range ~0.45..1.25). */
function hillshade(heights, nx, nz, cellX, cellZ) {
  const out = new Float32Array(heights.length).fill(1);
  // Light from the north-west (-X, -Z in scene space), 45° altitude.
  const lx = -0.5;
  const lz = -0.5;
  const ly = Math.SQRT1_2;
  for (let iz = 1; iz < nz - 1; iz++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const i = iz * nx + ix;
      const gx = (heights[i + 1] - heights[i - 1]) / (2 * cellX);
      const gz = (heights[i + nx] - heights[i - nx]) / (2 * cellZ);
      const len = Math.hypot(gx, 1, gz);
      const lambert = (-gx * lx + ly - gz * lz) / len;
      out[i] = THREE.MathUtils.clamp(0.45 + (lambert / ly) * 0.55, 0.45, 1.25);
    }
  }
  return out;
}

/** Scene X/Z box of the real terrain (null before createTerrain). Layers use it to skip off-terrain features. */
export function getTerrainBounds() {
  return activeTerrainBounds;
}

/** Intersect scene bounds with the DTM's lon/lat extent (inner box of its projected corners). */
function clipToDtm(b, dtm) {
  const db = dtm?.bounds;
  if (!db) return b;
  const sw = lonLatToLocal(db.west, db.south);
  const se = lonLatToLocal(db.east, db.south);
  const nw = lonLatToLocal(db.west, db.north);
  const ne = lonLatToLocal(db.east, db.north);
  // Inset one DTM pixel so edge samples never fall outside the raster.
  const inset = 35;
  const westX = [sw.x, nw.x];
  const eastX = [se.x, ne.x];
  const southZ = [sw.z, se.z];
  const northZ = [nw.z, ne.z];
  const xLo = Math.max(...(westX[0] < eastX[0] ? westX : eastX)) + inset;
  const xHi = Math.min(...(westX[0] < eastX[0] ? eastX : westX)) - inset;
  const zLo = Math.max(...(southZ[0] < northZ[0] ? southZ : northZ)) + inset;
  const zHi = Math.min(...(southZ[0] < northZ[0] ? northZ : southZ)) - inset;
  const minX = Math.max(b.minX, xLo);
  const maxX = Math.min(b.maxX, xHi);
  const minZ = Math.max(b.minZ, zLo);
  const maxZ = Math.min(b.maxZ, zHi);
  if (!(maxX - minX > 500 && maxZ - minZ > 500)) return b;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

/**
 * Earth cross-section walls around the clipped terrain tile, so the DTM edge reads as a solid
 * relief block (like a physical terrain model) rather than a paper-thin sheet. Top edge follows
 * the live grid heights; update() re-syncs after the river carve.
 */
function createTerrainSkirt(terrainGeo, nx, nz, minY) {
  const edge = [];
  for (let ix = 0; ix < nx; ix++) edge.push(ix);
  for (let iz = 1; iz < nz; iz++) edge.push(iz * nx + nx - 1);
  for (let ix = nx - 2; ix >= 0; ix--) edge.push((nz - 1) * nx + ix);
  for (let iz = nz - 2; iz >= 0; iz--) edge.push(iz * nx);

  const baseY = Math.min(minY, SURFACE_Y - 30) - 60;
  const n = edge.length;
  const positions = new Float32Array(n * 2 * 3);
  const colors = new Float32Array(n * 2 * 3);
  const topCol = new THREE.Color("#6e5a40");
  const botCol = new THREE.Color("#3a2e22");
  for (let k = 0; k < n; k++) {
    colors.set([topCol.r, topCol.g, topCol.b], k * 6);
    colors.set([botCol.r, botCol.g, botCol.b], k * 6 + 3);
  }
  const index = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);

  const src = terrainGeo.attributes.position;
  function update() {
    for (let k = 0; k < n; k++) {
      const i = edge[k];
      const x = src.getX(i);
      const z = src.getZ(i);
      positions.set([x, src.getY(i), z, x, baseY, z], k * 6);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  update();

  const skirt = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  skirt.name = "terrainSkirt";
  skirt.receiveShadow = true;
  skirt.userData.update = update;
  return skirt;
}

/** Large soft ground disc matching terrain greens — fills the white void around the AOI.
 *  Critical: must NOT cover the AOI / river (otherwise water + banks disappear).
 */
function createGroundSurround(b, heights, minY) {
  const avgY =
    heights?.length > 0
      ? heights.reduce((s, v) => s + v, 0) / heights.length
      : Number.isFinite(minY)
        ? minY
        : SURFACE_Y;
  const span = Math.max(b.spanX, b.spanZ);
  const size = Math.max(18000, span * 4.5);
  const geo = new THREE.PlaneGeometry(size, size, 64, 64);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cDeep = new THREE.Color("#4a6e48");
  const cMid = new THREE.Color("#6a8664");
  const cLite = new THREE.Color("#7a8a58");
  const cEarth = new THREE.Color("#8a7a52");
  const tmp = new THREE.Color();
  // Keep a clear hole over the detailed terrain + river corridor
  const holeX = Math.max(80, b.spanX * 0.52);
  const holeZ = Math.max(80, b.spanZ * 0.52);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dx = x - b.cx;
    const dz = z - b.cz;
    const nx = Math.abs(dx) / holeX;
    const nz = Math.abs(dz) / holeZ;
    // Chebyshev-ish distance from AOI rectangle (0 inside → 1+ outside)
    const inside = Math.max(nx, nz);
    const r = Math.hypot(dx / (b.spanX * 0.5 || 1), dz / (b.spanZ * 0.5 || 1));
    const hills = fbm(x * 0.00035, z * 0.00035) * 14 + fbm(x * 0.0011 + 3, z * 0.0011) * 6;

    if (inside < 1.02) {
      // Bury under river/terrain so water surface + banks stay visible
      pos.setY(i, Math.min(avgY, SURFACE_Y) - 120);
    } else {
      const edge = THREE.MathUtils.smoothstep(inside, 1.02, 1.35);
      const y = avgY - 2.5 + hills * edge * 0.9;
      pos.setY(i, y);
    }

    const hn = THREE.MathUtils.clamp(0.35 + hills * 0.02 + Math.max(0, inside - 1) * 0.2, 0, 1);
    tmp.copy(cDeep).lerp(cMid, smooth(hn, 0.1, 0.45));
    tmp.lerp(cLite, smooth(hn, 0.35, 0.7));
    tmp.lerp(cEarth, smooth(hn, 0.6, 1) * 0.35);
    tmp.lerp(new THREE.Color("#6a7e5c"), THREE.MathUtils.smoothstep(r, 1.6, 2.8) * 0.55);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.01,
      flatShading: false,
    }),
  );
  mesh.name = "groundSurround";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = -5;
  return mesh;
}

function heightAt(x, z, stations, dtm = activeDtm) {
  const dtmY = dtm?.sampleSceneXY?.(x, z) ?? null;
  const observed = isObservedWater(activeLulc, activeOsmWater, x, z);

  const nearStation = nearest(x, z, stations);
  const lat = nearStation.lat;
  const ch = nearStation.st.chainage_m;
  const half = Math.max(16, nearStation.st.halfWidth);

  // Exact polygon test: if the dataset has a river boundary ring, test if (x, z) is in the river
  let inChannel = false;
  if (activeDataset?.ringLocal?.length >= 3) {
    inChannel = isPointInPolygon(x, z, activeDataset.ringLocal);
  } else {
    inChannel = lat < half * 0.98 || (observed && lat < half * 1.5);
  }

  // River bed inside channel stays under the water plane
  if (inChannel) {
    const depthInfo = wseSpatialService.getDepthAt(ch, lat);
    if (depthInfo?.wetted && depthInfo.depthM > 0) {
      return SURFACE_Y - depthInfo.depthM;
    }
    const centerD = nearStation.st?.depth ?? 5.0;
    const u = THREE.MathUtils.clamp(lat / half, 0, 1);
    const dVal = 1.5 + (centerD - 1.5) * Math.max(0, 1 - u * u);
    if (dtmY != null) {
      return Math.min(dtmY, SURFACE_Y - dVal);
    }
    return SURFACE_Y - dVal;
  }

  // Dry land covered directly by FABDEM DTM (guaranteed above water surface)
  if (dtmY != null) {
    return Math.max(dtmY, SURFACE_Y + 0.25);
  }

  // Procedural fallback only if DTM has void/null at this coordinate
  const hills =
    fbm(x * 0.00045, z * 0.00045) * 18 +
    fbm(x * 0.0012 + 4, z * 0.0012) * 8 +
    fbm(x * 0.003 + 9, z * 0.003) * 3;
  const bankFalloff = THREE.MathUtils.smoothstep(lat / (half * 3.5), 0.35, 1);
  const proceduralBase = SURFACE_Y + 2 + hills * bankFalloff;

  const cls = activeLulc?.classAtLocal?.(x, z);
  const isIslandLand = (cls === "forest" || cls === "barren" || cls === "crop");
  return isIslandLand ? Math.max(proceduralBase, SURFACE_Y + 1.2) : proceduralBase;
}

/**
 * Water share of a disc of radius r around (x, z): a blurred land-cover water mask (0..1).
 * r ≈ one terrain cell (~27 m), so the 50 % line moves smoothly inside cells.
 */
function waterFraction(x, z, r = 30, S = 9) {
  let hits = 0;
  let total = 0;
  for (let a = 0; a < S; a++) {
    for (let b = 0; b < S; b++) {
      const u = (a + 0.5) / S * 2 - 1;
      const v = (b + 0.5) / S * 2 - 1;
      if (u * u + v * v > 1) continue;
      total++;
      if (isObservedWater(activeLulc, activeOsmWater, x + u * r, z + v * r)) hits++;
    }
  }
  return total ? hits / total : 0;
}

/**
 * Smooth shoreline: water/land is a per-vertex yes/no from the land-cover raster, whose cells
 * (~30 m) make the waterline a staircase. Near water/land boundaries, set the ground height from
 * a blurred water fraction of the mask instead (±1 m about the water plane, crossing at 50 %):
 * the waterline follows a rounded version of the raster outline. Interior water / land unchanged.
 */
function antialiasShoreline(pos, heights, nx, nz) {
  if (activeDataset?.ringLocal?.length >= 3) return;
  if (!activeLulc && !activeOsmWater) return;
  const n = nx * nz;
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    water[i] = isObservedWater(activeLulc, activeOsmWater, pos.getX(i), pos.getZ(i)) ? 1 : 0;
  }
  const R = 3; // grid steps checked for a nearby boundary (the blur reaches ~30 m)
  for (let iz = R; iz < nz - R; iz++) {
    for (let ix = R; ix < nx - R; ix++) {
      const i = iz * nx + ix;
      const w = water[i];
      let edge = false;
      for (let dz = -R; dz <= R && !edge; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (water[i + dz * nx + dx] !== w) { edge = true; break; }
        }
      }
      if (!edge) continue;
      const f = waterFraction(pos.getX(i), pos.getZ(i));
      const shoreY = SURFACE_Y + (0.5 - f) * 2;
      // Water side: no higher than the shoreline (deeper bed stays). Land side: no lower than the
      // shoreline (real high banks stay).
      heights[i] = f >= 0.5 ? Math.min(heights[i], shoreY) : Math.max(heights[i], shoreY);
    }
  }
}

/**
 * Signed distance (m) from (x, z) to the wet ribbon outline: < 0 inside the water, > 0 on land.
 * Beyond the first / last station the distance runs to the river's end (closed ends).
 */
export function ribbonEdgeDistance(x, z, stations, st = nearest(x, z, stations).st) {
  const side = (x - st.x) * -st.flowZ + (z - st.z) * st.flowX;
  const along = (x - st.x) * st.flowX + (z - st.z) * st.flowZ;
  const half = side >= 0 ? st.wetHalfRight : st.wetHalfLeft;
  const lateral = Math.abs(side) - half;
  const beyond =
    (st === stations[0] && along < 0) || (st === stations[stations.length - 1] && along > 0)
      ? Math.abs(along)
      : 0;
  const d = beyond > 0 ? (lateral > 0 ? Math.hypot(lateral, beyond) : beyond) : lateral;
  return { d, along, st };
}

/** Nearest-station lookup with a spatial hash; null when no station lies within ~6 cells (far from the river). */
export function makeStationLocator(stations, cell = 120) {
  const bins = new Map();
  stations.forEach((s, i) => {
    const k = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(i);
  });
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let r = 1; r <= 6; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          const list = bins.get(`${cx + i},${cz + j}`);
          if (!list) continue;
          for (const k of list) {
            const s = stations[k];
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
      // Accept once the search ring is wider than the nearest distance found.
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) return stations[best];
    }
    // Nothing within ~720 m: far from the river (callers treat null as "not near the water").
    return null;
  };
}

/** Cell diagonal (m) of the rendered terrain grid. */
export function terrainCellDiag(mesh) {
  const p = mesh?.geometry?.parameters;
  if (!p?.widthSegments) return 40;
  return Math.hypot(p.width / p.widthSegments, p.height / p.heightSegments);
}

/**
 * Sink the coarse terrain grid out of the way of the river so the channel banks can be drawn by
 * the dense bank strip (channelBanks.js).
 *
 * The grid cells (~77 m × 31 m) are far coarser than the channel. Lowering only the vertices
 * inside the water left grid triangles straddling the shore: they poked up through the water
 * (up to 13 m) or showed as long brown slopes under it. Here every vertex within one cell
 * diagonal (+ margin) of the water is sunk well below the deepest possible bed, so no grid
 * triangle touches the water; the bank strip covers that band with full-resolution heights.
 *
 * Idempotent: original heights / colours are restored first, so re-fitting the ribbon (JalNetra
 * mask) never leaves stale holes from an earlier, wider ribbon.
 */
export function carveTerrainUnderRiver(mesh, stations, { deepY = SURFACE_Y - 4, extraBandM = 2 } = {}) {
  if (!mesh?.geometry || !stations?.length || !Number.isFinite(stations[0].wetHalfLeft)) return 0;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!geo.userData.baseY) {
    geo.userData.baseY = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
  }
  const baseY = geo.userData.baseY;
  const band = extraBandM;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxW = 0;
  for (const s of stations) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    maxW = Math.max(maxW, s.wetHalfLeft, s.wetHalfRight);
  }
  const pad = maxW + band;
  const locate = makeStationLocator(stations);
  const sunk = new Uint8Array(pos.count);
  let changed = 0;
  for (let i = 0; i < pos.count; i++) {
    let y = baseY[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x >= minX - pad && x <= maxX + pad && z >= minZ - pad && z <= maxZ + pad) {
      const near = locate(x, z);
      const { d } = near ? ribbonEdgeDistance(x, z, stations, near) : { d: Infinity };
      // Only sink vertices inside or directly on the waterline
      if (d < 2 && (!activeDataset?.ringLocal?.length || isPointInPolygon(x, z, activeDataset.ringLocal))) {
        y = deepY;
        sunk[i] = 1;
        changed++;
      }
    }
    pos.setY(i, y);
  }
  geo.userData.sunk = sunk;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  mesh.userData.updateSkirt?.();
  return changed;
}

export function terrainHeightAt(x, z, stations) {
  return heightAt(x, z, stations, activeDtm);
}

/**
 * Height of the rendered terrain mesh (coarse grid from createTerrain) at x/z.
 * Differs from terrainHeightAt near narrow channels, where grid cells span both banks.
 */
export function renderedTerrainHeightAt(mesh, x, z) {
  const geo = mesh?.geometry;
  const p = geo?.parameters;
  const pos = geo?.attributes?.position;
  if (!p?.widthSegments || !pos) return null;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const nx = p.widthSegments;
  const nz = p.heightSegments;
  const fx = ((x - min.x) / Math.max(1e-6, max.x - min.x)) * nx;
  const fz = ((z - min.z) / Math.max(1e-6, max.z - min.z)) * nz;
  if (fx < 0 || fz < 0 || fx > nx || fz > nz) return null;
  const ix = Math.min(nx - 1, Math.floor(fx));
  const iz = Math.min(nz - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const at = (i, j) => pos.getY(j * (nx + 1) + i);
  const a = at(ix, iz);
  const b = at(ix + 1, iz);
  const c = at(ix, iz + 1);
  const d = at(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Raw FABDEM scene elevation — no channel carve (for profile / analysis charts). */
export function rawDtmElevationAt(x, z) {
  const y = activeDtm?.sampleSceneXY?.(x, z);
  return Number.isFinite(y) ? y : null;
}

/** FABDEM elevation in metres (EGM2008 ≈ MSL) at a WGS84 point. */
export function dtmElevationAtLonLat(lon, lat) {
  const e = activeDtm?.sampleLonLat?.(lon, lat);
  return Number.isFinite(e) ? e : null;
}

function nearest(x, z, stations) {
  let bestI = 0;
  let bestD = Infinity;
  const len = stations.length;
  const step = Math.max(1, Math.floor(len / 40));
  for (let i = 0; i < len; i += step) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  // Refine locally in a window around best candidate (±step)
  const start = Math.max(0, bestI - step);
  const end = Math.min(len - 1, bestI + step);
  for (let i = start; i <= end; i++) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const st = stations[bestI];
  const dx = x - st.x;
  const dz = z - st.z;
  const lat = Math.abs(dx * -st.flowZ + dz * st.flowX);
  return { st, lat };
}

function kmlOutline(ringLocal) {
  const pts = ringLocal.map((c) => new THREE.Vector3(c.x, SURFACE_Y + 0.15, c.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0x4a90c8, transparent: true, opacity: 0.55 }),
  );
  line.name = "kmlOutline";
  return line;
}

function smooth(t, a, b) {
  const k = THREE.MathUtils.clamp((t - a) / Math.max(0.001, b - a), 0, 1);
  return k * k * (3 - 2 * k);
}

function fbm(x, z) {
  let v = 0;
  let a = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < 4; i++) {
    v += a * noise(fx, fz);
    fx *= 2;
    fz *= 2;
    a *= 0.5;
  }
  return v;
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uz,
  );
}

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
