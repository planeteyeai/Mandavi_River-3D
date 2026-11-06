import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { state } from "../state.js";
import { applyDrapeDepth } from "./drapeDepth.js";

/** Configurable lift above sampled terrain / water surface (meters). */
export const GLASSY_WATER_LIFT_M = 0.55;

/**
 * Bathymetry GroundOverlay from src/data/mula_mutha_depth_blueshade_smoothed.kmz
 * (extracted to public/data/bathymetry/). LatLonBox copied from its doc.kml.
 */
export const BATHYMETRY_OVERLAY = {
  url: "/data/bathymetry/mula_mutha_depth_overlay.png",
  legendUrl: "/data/bathymetry/depth_legend.png",
  north: 18.54735962,
  south: 18.52083962,
  east: 73.99281512,
  west: 73.85517512,
  minDepth: 1.53,
  maxDepth: 2.0,
};

/** Mandovi bathymetry = Updates water_depth_mandavi.kml GroundOverlay. */
export const MANDOVI_BATHYMETRY_OVERLAY = {
  url: "/data/updates/water_depth.png",
  kmlUrl: "/data/updates/original/water_depth_mandavi.kml",
  legendUrl: "/data/updates/metadata.json",
  north: 15.52859903,
  south: 15.4593098,
  east: 73.88313675,
  west: 73.76545998,
  minDepth: 0.5,
  maxDepth: 8.0,
  source: "src/data/Updates/original/water_depth_mandavi.kml",
  provenance: "RELATIVE ESTIMATE",
  /** Source PNG is green→yellow→red; shader remaps to hydro dark blues. */
  remapToHydroBlues: true,
};

/** Legend ramp sampled from the KMZ depth_legend.png, shallow → deep. */
export const BATHYMETRY_RAMP = [
  "#abd5f8", "#95bbe3", "#7d9fcc", "#6582b6", "#4e669f", "#364a89", "#1e2d72", "#06115b",
];

/** Source false-colour in water_depth_mandavi.kml (used for depth sampling). */
export const MANDOVI_DEPTH_RAMP = [
  "#00A651", // Shallow (<2.0m)
  "#FFFF00", // Moderate (2.0–4.0m)
  "#FFA500", // Medium-Deep (4.0–6.0m)
  "#FF0000", // Deep (>6.0m)
];

/** Display palette matching Permanent Water reference (cerulean sheet). */
export const MANDOVI_HYDRO_DISPLAY_RAMP = [
  "#4EB8E0",
  "#3282BE",
  "#2A79AB",
  "#2674A3",
  "#1E6EAA",
  "#1D6598",
  "#1E5D8F",
  "#164F7D",
];

const PICK_MIN_ALPHA = 40;
const GRID_SEG_X = 420;
const GRID_SEG_Z = 84;

/**
 * Raster bathymetry layer — KMZ image draped just above the river surface.
 * Exposes the same userData API the old depth-zone polygon layer did.
 */
export function createDepthZonesLayer(dataset) {
  const group = new THREE.Group();
  group.name = "depthZones";
  group.visible = false;

  const stations = dataset?.corridor?.stations || [];
  const isMandovi =
    dataset?.isMulaMutha === false ||
    dataset?.riverName?.toLowerCase()?.includes("mandovi") ||
    dataset?.riverName?.toLowerCase()?.includes("mandavi") ||
    Boolean(dataset?.ringGeo?.[0]?.lat && dataset.ringGeo[0].lat < 17);

  const box = dataset?.depthOverlay || (isMandovi ? MANDOVI_BATHYMETRY_OVERLAY : BATHYMETRY_OVERLAY);
  const ramp = isMandovi ? MANDOVI_DEPTH_RAMP : BATHYMETRY_RAMP;
  const remapHydro = isMandovi || box.remapToHydroBlues;

  const geometry = buildDrapedGrid(box, stations);
  const texture = new THREE.TextureLoader().load(`${box.url}?v=updates-depth`, (tex) => {
    pixels = readPixels(tex.image);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const srcRamp = MANDOVI_DEPTH_RAMP.map((h) => {
    const c = new THREE.Color(h);
    return new THREE.Vector3(c.r, c.g, c.b);
  });
  const dstRamp = MANDOVI_HYDRO_DISPLAY_RAMP.map((h) => {
    const c = new THREE.Color(h);
    return new THREE.Vector3(c.r, c.g, c.b);
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: 1 },
      uReveal: { value: 1 },
      uHighlight: { value: 0 },
      uRemap: { value: remapHydro ? 1 : 0 },
      uSrcRamp: { value: srcRamp },
      uDstRamp: { value: dstRamp },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uHighlight;
      uniform float uRemap;
      uniform vec3 uSrcRamp[4];
      uniform vec3 uDstRamp[8];
      varying vec2 vUv;

      float sourceDepthT(vec3 rgb) {
        float bestT = 0.0;
        float bestD = 1e9;
        for (int s = 0; s <= 64; s++) {
          float t = float(s) / 64.0;
          float f = t * 3.0;
          int k = int(floor(f));
          if (k > 2) k = 2;
          float w = f - float(k);
          vec3 mixc = mix(uSrcRamp[k], uSrcRamp[k + 1], w);
          vec3 d = mixc - rgb;
          float dist = dot(d, d);
          if (dist < bestD) { bestD = dist; bestT = t; }
        }
        return bestT;
      }

      vec3 hydroColor(float t) {
        float f = clamp(t, 0.0, 1.0) * 7.0;
        int k = int(floor(f));
        if (k > 6) k = 6;
        float w = f - float(k);
        vec3 col = mix(uDstRamp[k], uDstRamp[k + 1], w);
        col *= mix(1.0, 0.82, smoothstep(0.45, 1.0, t));
        return col;
      }

      void main() {
        vec4 c = texture2D(uMap, vUv);
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        float a = clamp(c.a * 1.45, 0.0, 1.0);
        if (a < 0.02 || (uRemap > 0.5 && lum < 0.035)) discard;
        float edge = uReveal * 1.08;
        float mask = 1.0 - smoothstep(edge - 0.08, edge, vUv.x);
        vec3 col = c.rgb;
        if (uRemap > 0.5) {
          float t = sourceDepthT(c.rgb);
          col = hydroColor(t);
          a = mix(max(a, 0.55), 1.0, smoothstep(0.35, 0.95, t));
        }
        col *= (1.0 + uHighlight * 0.25);
        gl_FragColor = vec4(col, a * uOpacity * mask);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  applyDrapeDepth(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "bathymetryOverlay";
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;
  group.add(mesh);

  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(4, 6.5, 40),
    new THREE.MeshBasicMaterial({
      color: 0xb8f0ff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  selectRing.renderOrder = 10;
  group.add(selectRing);

  /** @type {{ data: Uint8ClampedArray, width: number, height: number } | null} */
  let pixels = null;
  let revealT = 1;

  group.userData.stats = {
    source: isMandovi
      ? "Updates water_depth_mandavi.kml (RELATIVE ESTIMATE · hydro blues)"
      : "mula_mutha_depth_blueshade_smoothed.kmz",
    raster: true,
    polygons: 0,
    built: 1,
    classes: ramp.length,
    depthRange: [box.minDepth, box.maxDepth],
    provenance: isMandovi ? "RELATIVE ESTIMATE" : "DERIVED",
  };
  group.userData.material = material;
  group.userData.meshes = [mesh];

  group.userData.setVisible = (on) => {
    group.visible = !!on;
  };

  group.userData.setSelected = (feat) => {
    material.uniforms.uHighlight.value = feat ? 1 : 0;
    if (feat) {
      selectRing.visible = true;
      selectRing.position.set(feat.x, waterYAt(feat.x, feat.z, stations) + 0.5, feat.z);
    } else {
      selectRing.visible = false;
    }
  };

  group.userData.playReveal = () => {
    revealT = 0;
    material.uniforms.uReveal.value = 0;
  };

  /** Depth (m) at a local XZ point, read from the KMZ raster colour. */
  group.userData.sampleAt = (x, z) => {
    if (!pixels || !dataset.frame?.toLonLat) return null;
    const { lon, lat } = dataset.frame.toLonLat(x, z);
    const u = (lon - box.west) / (box.east - box.west);
    const v = (box.north - lat) / (box.north - box.south);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
    const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
    const i = (py * pixels.width + px) * 4;
    const d = pixels.data;
    if (d[i + 3] < PICK_MIN_ALPHA) return null;
    const depth = isMandovi
      ? mandoviColorToDepth(d[i], d[i + 1], d[i + 2], box.minDepth, box.maxDepth)
      : colorToDepth(d[i], d[i + 1], d[i + 2], box.minDepth, box.maxDepth);
    return { depth, lon, lat };
  };

  group.userData.update = (dt) => {
    if (!group.visible) return;
    material.uniforms.uOpacity.value = Math.max(0.55, state.glassyWaterOpacity ?? 0.9);
    if (state.glassyRevealActive || revealT < 1) {
      revealT = Math.min(1, revealT + dt * 0.45);
      material.uniforms.uReveal.value = revealT;
      if (revealT >= 1) state.glassyRevealActive = false;
    }
  };

  console.info("Bathymetry raster layer (KMZ)", group.userData.stats);
  return group;
}

/** Pick the bathymetry depth under a local XZ point. */
export function pickDepthZoneAt(group, x, z) {
  const hit = group?.userData?.sampleAt?.(x, z);
  if (!hit) return null;
  const minDepth = group?.userData?.stats?.depthRange?.[0] ?? 1.5;
  const maxDepth = group?.userData?.stats?.depthRange?.[1] ?? 8.0;
  const isMandovi = group?.userData?.stats?.source?.includes("Sentinel-2");
  const ramp = isMandovi ? MANDOVI_DEPTH_RAMP : BATHYMETRY_RAMP;
  const n = ramp.length - 1;
  const step = (maxDepth - minDepth) / n;
  const k = Math.min(n - 1, Math.max(0, Math.floor((hit.depth - minDepth) / step)));
  const lo = minDepth + k * step;
  const hi = lo + step;
  return {
    id: `bathy-${Math.round(x)}-${Math.round(z)}`,
    name: isMandovi ? "Water Depth (Sentinel-2 Bathymetry)" : "Bathymetry (KMZ raster)",
    depthClass: `${lo.toFixed(2)}–${hi.toFixed(2)} m`,
    depthMin: lo,
    depthMax: hi,
    depthMid: hit.depth,
    x,
    z,
    lon: hit.lon,
    lat: hit.lat,
  };
}

function buildDrapedGrid(box, stations) {
  const nx = GRID_SEG_X;
  const nz = GRID_SEG_Z;
  const count = (nx + 1) * (nz + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let p = 0;
  let q = 0;
  for (let j = 0; j <= nz; j++) {
    const v = j / nz;
    const lat = box.south + v * (box.north - box.south);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const lon = box.west + u * (box.east - box.west);
      const loc = lonLatToLocal(lon, lat);
      pos[p++] = loc.x;
      pos[p++] = waterYAt(loc.x, loc.z, stations);
      pos[p++] = loc.z;
      uv[q++] = u;
      uv[q++] = v;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function readPixels(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return { data, width: image.width, height: image.height };
  } catch (err) {
    console.warn("[bathymetry] pixel read failed", err?.message || err);
    return null;
  }
}

const RAMP_RGB = BATHYMETRY_RAMP.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

/** Project an RGB colour onto the legend ramp → depth in metres. */
function colorToDepth(r, g, b, minDepth, maxDepth) {
  let best = 0;
  let bestD = Infinity;
  const steps = 64;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const f = t * (RAMP_RGB.length - 1);
    const k = Math.min(RAMP_RGB.length - 2, Math.floor(f));
    const w = f - k;
    const c0 = RAMP_RGB[k];
    const c1 = RAMP_RGB[k + 1];
    const dr = c0[0] + (c1[0] - c0[0]) * w - r;
    const dg = c0[1] + (c1[1] - c0[1]) * w - g;
    const db = c0[2] + (c1[2] - c0[2]) * w - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return minDepth + best * (maxDepth - minDepth);
}

const MANDOVI_RAMP_RGB = MANDOVI_DEPTH_RAMP.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

function mandoviColorToDepth(r, g, b, minDepth, maxDepth) {
  let best = 0;
  let bestD = Infinity;
  const steps = 64;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const f = t * (MANDOVI_RAMP_RGB.length - 1);
    const k = Math.min(MANDOVI_RAMP_RGB.length - 2, Math.floor(f));
    const w = f - k;
    const c0 = MANDOVI_RAMP_RGB[k];
    const c1 = MANDOVI_RAMP_RGB[k + 1];
    const dr = c0[0] + (c1[0] - c0[0]) * w - r;
    const dg = c0[1] + (c1[1] - c0[1]) * w - g;
    const db = c0[2] + (c1[2] - c0[2]) * w - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return minDepth + best * (maxDepth - minDepth);
}

function waterYAt(x, z, stations) {
  if (stations?.length) {
    const ty = terrainHeightAt(x, z, stations);
    return Math.max(ty, SURFACE_Y) + GLASSY_WATER_LIFT_M;
  }
  return SURFACE_Y + GLASSY_WATER_LIFT_M;
}
