/**
 * Updates GroundOverlay layers.
 * Live Water Extent stays here.
 * Relative water depth is rendered by Bathymetry Colour Overlay (depthZonesLayer)
 * from the same Updates water_depth.png — one depth visualisation only.
 */
import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { applyDrapeDepth } from "./drapeDepth.js";
import { state } from "../state.js";

const GRID_SEG_X = 280;
const GRID_SEG_Z = 160;

/**
 * @param {object} dataset
 * @param {{ liveWater?: object, relativeDepth?: object }} overlays
 */
export function createUpdatesOverlayLayers(dataset, overlays = {}) {
  const root = new THREE.Group();
  root.name = "updatesOverlays";

  const stations = dataset?.corridor?.stations || [];

  // Live-water KML footprint is applied as a clip mask (liveWaterMask) — do NOT
  // drape the solid MNDWI blue PNG over the river or it replaces hydrographic colours.
  // Optional faint outline-only reference when the Layers toggle is explicitly on.
  const liveWaterLayer = overlays.liveWater?.available
    ? buildLiveWaterMesh({
        name: "liveWaterExtent",
        url: overlays.liveWater.url,
        box: overlays.liveWater.bounds,
        stations,
        opacity: 0.18,
        liftM: 0.35,
        renderOrder: 7,
      })
    : null;

  if (liveWaterLayer) {
    liveWaterLayer.visible = !!state.showLiveWaterExtent;
    liveWaterLayer.userData.meta = overlays.liveWater;
    liveWaterLayer.userData.provenance = overlays.liveWater.provenance;
    root.add(liveWaterLayer);
  }

  root.userData.liveWaterLayer = liveWaterLayer;
  root.userData.relativeDepthLayer = null;
  root.userData.stats = {
    liveWater: !!liveWaterLayer,
    relativeDepth: false,
    bathymetryUsesUpdatesDepth: true,
    liveWaterBounds: overlays.liveWater?.bounds || null,
    relativeDepthBounds: overlays.relativeDepth?.bounds || null,
    note: "Depth visualisation = Layers → Bathymetry Colour Overlay (Updates water_depth_mandavi.kml)",
  };

  root.userData.setLiveWaterVisible = (on) => {
    state.showLiveWaterExtent = !!on;
    if (liveWaterLayer) liveWaterLayer.visible = !!on;
  };
  root.userData.setRelativeDepthVisible = (on) => {
    state.showRelativeWaterDepth = !!on;
    state.showDepthZones = !!on;
    if (liveWaterLayer?.material?.uniforms?.uOpacity) {
      liveWaterLayer.material.uniforms.uOpacity.value = on ? 0.12 : 0.18;
    }
  };

  root.userData.update = () => {
    if (liveWaterLayer) liveWaterLayer.visible = !!state.showLiveWaterExtent;
    if (liveWaterLayer?.material?.uniforms?.uOpacity) {
      liveWaterLayer.material.uniforms.uOpacity.value = state.showDepthZones ? 0.1 : 0.18;
    }
  };

  console.info("[updatesOverlays]", root.userData.stats);
  return root;
}

function buildLiveWaterMesh({ name, url, box, stations, opacity, liftM, renderOrder }) {
  const geometry = buildDrapedGrid(box, stations, liftM);
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: opacity },
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
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        // Stronger land discard — stops LatLonBox from painting a blue rectangle on banks
        float a = c.a * smoothstep(0.12, 0.32, lum);
        if (a < 0.08) discard;
        vec3 col = mix(vec3(0.06, 0.32, 0.48), c.rgb, 0.4);
        gl_FragColor = vec4(col, a * uOpacity * 0.85);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  applyDrapeDepth(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.userData.box = box;
  mesh.userData.sourceUrl = url;
  return mesh;
}

function buildDrapedGrid(box, stations, liftM = 0.4) {
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
      const ground = terrainHeightAt(loc.x, loc.z, stations);
      const yBase = Number.isFinite(ground) ? Math.max(ground, SURFACE_Y) : SURFACE_Y;
      pos[p++] = loc.x;
      pos[p++] = yBase + liftM;
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
