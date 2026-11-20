/**
 * Casino vessels — one distinct 3D hull per ship, scaled to exact LOA × beam.
 *
 *   LUCKY SEVEN      → Silja Serenade GLB      71 × 24 m
 *   PRIDE OF GOA II  → MS Gabriella GLB         73 × 24 m
 *   PRIDE OF GOA     → Fishing Vessel VII DAE   66.14 × 19 m
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";
import { nearestStationU, smoothTangent } from "./riverCamera.js";

import siljaUrl from "../../data/silja-line-ms-silja-serenade-1990/source/SiljaSerenade.glb?url";
import gabriellaUrl from "../../data/viking-line-ms-gabriella-19922016/source/Gabriella2016.glb?url";
import casinoKmlUrl from "../../data/Casino Ship Kml.kml?url";

const FISHING_DIR = "/data/fishing-vessel-vii/";
const FISHING_DAE_GZIP = `${FISHING_DIR}Fishing%20Vessel%20VII.dae.gz`;

const MODEL_LABEL = {
  silja: "Silja Serenade",
  gabriella: "MS Gabriella",
  fishing: "Fishing Vessel VII",
};

/**
 * Authoritative registry — lat/lon + LOA×beam + unique hull per vessel.
 */
const VESSEL_BY_KEY = {
  "lucky seven": {
    aisName: "LUCKY SEVEN",
    imo: "8943703",
    type: "Passenger / Casino Ship",
    flag: "INDIA",
    lengthM: 71,
    beamM: 24,
    draughtM: 3.6,
    capacityPassengers: 450,
    capacityCrew: 80,
    grossTonnage: 3200,
    lat: 15.502575,
    lon: 73.821917,
    model: "silja",
  },
  "pride goa 2": {
    aisName: "PRIDE OF GOA II",
    imo: "8530063",
    type: "Passenger / Casino Ship",
    flag: "INDIA",
    lengthM: 73,
    beamM: 24,
    draughtM: 3.8,
    capacityPassengers: 500,
    capacityCrew: 90,
    grossTonnage: 3800,
    lat: 15.502702,
    lon: 73.824023,
    model: "gabriella",
  },
  "pride of goa ii": {
    aisName: "PRIDE OF GOA II",
    imo: "8530063",
    type: "Passenger / Casino Ship",
    flag: "INDIA",
    lengthM: 73,
    beamM: 24,
    draughtM: 3.8,
    capacityPassengers: 500,
    capacityCrew: 90,
    grossTonnage: 3800,
    lat: 15.502702,
    lon: 73.824023,
    model: "gabriella",
  },
  "pride of goa": {
    aisName: "PRIDE OF GOA",
    imo: "9093830",
    type: "Ro-Ro / Casino Ship",
    flag: "INDIA",
    lengthM: 66.14,
    beamM: 19,
    draughtM: 3.5,
    capacityPassengers: 400,
    capacityCrew: 70,
    grossTonnage: 2800,
    lat: 15.502348,
    lon: 73.826445,
    model: "fishing",
  },
};

const FALLBACK_PLACEMARKS = [
  { name: "Lucky Seven", lon: 73.821917, lat: 15.502575 },
  { name: "Pride Goa 2", lon: 73.824023, lat: 15.502702 },
  { name: "Pride of Goa", lon: 73.826445, lat: 15.502348 },
];

function resolveVessel(name) {
  const key = String(name || "").trim().toLowerCase();
  if (VESSEL_BY_KEY[key]) return { ...VESSEL_BY_KEY[key] };
  if (/pride.*goa.*ii|pride.*goa.*2|pride goa 2/i.test(key)) return { ...VESSEL_BY_KEY["pride goa 2"] };
  if (/lucky/i.test(key)) return { ...VESSEL_BY_KEY["lucky seven"] };
  if (/pride.*goa/i.test(key)) return { ...VESSEL_BY_KEY["pride of goa"] };
  return {
    aisName: name || "Casino vessel",
    imo: null,
    type: "Passenger / Casino Ship",
    flag: "INDIA",
    lengthM: 70,
    beamM: 22,
    draughtM: 3.5,
    capacityPassengers: 350,
    capacityCrew: 60,
    grossTonnage: 2500,
    lat: null,
    lon: null,
    model: "fishing",
  };
}

async function loadCasinoPlacemarks() {
  try {
    const res = await fetch(casinoKmlUrl);
    if (!res.ok) throw new Error(`Casino KML ${res.status}`);
    const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
    const marks = [...xml.querySelectorAll("Placemark")].flatMap((pm) => {
      const name = pm.querySelector("name")?.textContent?.trim() || "Casino ship";
      const raw = pm.querySelector("Point coordinates")?.textContent?.trim();
      if (!raw) return [];
      const [lon, lat] = raw.split(",").map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      if (lon < 73.7 || lon > 74.0 || lat < 15.4 || lat > 15.6) return [];
      return [{ name, lon, lat }];
    });
    if (marks.length) return marks;
  } catch (err) {
    console.warn("[casino-ships] KML load failed, using embedded coords", err?.message || err);
  }
  return FALLBACK_PLACEMARKS.slice();
}

/**
 * Silja / Gabriella GLBs use MeshStandardMaterial with high metalness.
 * Scene has no env map, so metallic white paint reads as pure black.
 * Cap metalness, lift near-black bases, keep maps in sRGB.
 */
function hardenShipMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if ("metalness" in mat) mat.metalness = Math.min(Number(mat.metalness) || 0, 0.22);
      if ("roughness" in mat) mat.roughness = Math.max(Number(mat.roughness) || 0.5, 0.48);
      if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }
      if (mat.color && typeof mat.color.getHex === "function") {
        const lum = mat.color.r * 0.2126 + mat.color.g * 0.7152 + mat.color.b * 0.0722;
        // Unlit / failed-texture black hull → lift to ferry white-grey
        if (lum < 0.08 && !mat.map) mat.color.set("#e6edf2");
        else if (lum < 0.12 && mat.map) mat.color.set("#ffffff");
      }
      if ("emissive" in mat && mat.emissive && typeof mat.emissive.setRGB === "function") {
        // Tiny fill so white hulls stay visible under hemi+sun only
        if ((mat.emissiveIntensity || 0) < 0.04) {
          mat.emissive.setRGB(0.04, 0.045, 0.05);
          mat.emissiveIntensity = 0.08;
        }
      }
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
    }
  });
}

function prepareTemplate(object3d) {
  const root = object3d.clone(true);
  hardenShipMaterials(root);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  const bounds2 = new THREE.Box3().setFromObject(root);
  const longAxis = size.x >= size.z ? "x" : "z";
  return {
    scene: root,
    longAxis,
    modelLength: Math.max(size.x, size.z, 0.01),
    modelWidth: Math.max(0.01, Math.min(size.x, size.z)),
    modelHeight: Math.max(size.y, 0.01),
    modelBottom: bounds2.min.y,
  };
}

async function loadFishingTemplate() {
  const response = await fetch(FISHING_DAE_GZIP);
  if (!response.ok) {
    throw new Error(`Fishing Vessel model request failed: ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let daeText;
  if (isGzip) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser does not support gzip model decompression");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    daeText = await new Response(stream).text();
  } else {
    daeText = new TextDecoder().decode(bytes);
  }

  const loader = new ColladaLoader();
  const collada = loader.parse(daeText, new URL(FISHING_DIR, document.baseURI).href);
  const scene = collada.scene || collada;
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
  return prepareTemplate(scene);
}

async function loadGlbTemplate(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return prepareTemplate(gltf.scene);
}

function riverHeadingRad(stations, x, z) {
  if (!stations?.length) return 0;
  const u = nearestStationU(stations, x, z);
  const t = smoothTangent(stations, u);
  return Math.atan2(t.x, t.z);
}

function applyLoaBeamScale(model, tpl, lengthM, beamM) {
  const lengthScale = lengthM / tpl.modelLength;
  const beamScale = beamM / tpl.modelWidth;
  const heightScale = lengthScale;
  if (tpl.longAxis === "x") {
    model.scale.set(lengthScale, heightScale, beamScale);
  } else {
    model.scale.set(beamScale, heightScale, lengthScale);
  }
  return { lengthScale, beamScale, heightScale };
}

export function createCasinoShipsLayer(scene, dataset) {
  const group = new THREE.Group();
  group.name = "mandovi-casino-ships";
  group.visible = true;
  scene.add(group);

  const entries = [];
  let layerSuppressed = false;
  let selectedId = null;
  const stations = dataset?.corridor?.stations || [];

  function syncVisibility() {
    group.visible = !layerSuppressed;
    if (!group.visible) selectedId = null;
  }

  function setThematicSuppressed(value) {
    layerSuppressed = !!value;
    syncVisibility();
  }

  function pick(raycaster) {
    if (!group.visible) return null;
    const hits = raycaster.intersectObjects(group.children, true);
    for (const hit of hits) {
      const entry = hit.object.userData.casinoShipEntry;
      if (entry) return entry;
    }
    return null;
  }

  function select(id) {
    selectedId = id == null ? null : String(id);
    for (const entry of entries) {
      const on = entry.info.id === selectedId;
      entry.root.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat || !("emissiveIntensity" in mat)) continue;
          if (on) {
            mat.userData._prevEmissive = mat.emissiveIntensity;
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 0.35);
          } else if (mat.userData._prevEmissive != null) {
            mat.emissiveIntensity = mat.userData._prevEmissive;
            delete mat.userData._prevEmissive;
          }
        }
      });
    }
  }

  async function load() {
    const placemarks = await loadCasinoPlacemarks();
    const needed = new Set(placemarks.map((m) => resolveVessel(m.name).model));
    const loadOptionalTemplate = async (name, loadTemplate) => {
      try {
        return await loadTemplate();
      } catch (error) {
        console.warn(
          `[casino-ships] ${name} model failed to load; continuing with other ships`,
          error?.message || error,
        );
        return null;
      }
    };

    const [fishingTpl, siljaTpl, gabriellaTpl] = await Promise.all([
      needed.has("fishing")
        ? loadOptionalTemplate("Fishing Vessel VII", loadFishingTemplate)
        : Promise.resolve(null),
      needed.has("silja")
        ? loadOptionalTemplate("Silja Serenade", () => loadGlbTemplate(siljaUrl))
        : Promise.resolve(null),
      needed.has("gabriella")
        ? loadOptionalTemplate("MS Gabriella", () => loadGlbTemplate(gabriellaUrl))
        : Promise.resolve(null),
    ]);

    const templates = {
      fishing: fishingTpl,
      silja: siljaTpl,
      gabriella: gabriellaTpl,
    };

    for (let i = 0; i < placemarks.length; i++) {
      const mark = placemarks[i];
      const vessel = resolveVessel(mark.name);
      const tpl = templates[vessel.model];
      if (!tpl) {
        console.warn("[casino-ships] missing template for", vessel.aisName, vessel.model);
        continue;
      }

      // Prefer registry lat/lon (AIS particulars) over KML if present.
      const lon = Number.isFinite(vessel.lon) ? vessel.lon : mark.lon;
      const lat = Number.isFinite(vessel.lat) ? vessel.lat : mark.lat;
      const local = lonLatToLocal(lon, lat, 0);
      const heading = riverHeadingRad(stations, local.x, local.z);
      const yawFix = tpl.longAxis === "x" ? -Math.PI / 2 : 0;

      const root = new THREE.Group();
      root.name = `casino-ship-${vessel.aisName}`;

      const model = tpl.scene.clone(true);
      const scales = applyLoaBeamScale(model, tpl, vessel.lengthM, vessel.beamM);
      hardenShipMaterials(model);
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });
      root.add(model);

      // Immerse by ~half draught so the waterline cuts the hull (not hovering).
      const immerse = Math.min(Math.max(vessel.draughtM * 0.55, 0.8), 3.0);
      root.position.set(
        local.x,
        SURFACE_Y - tpl.modelBottom * scales.heightScale - immerse,
        local.z,
      );
      root.rotation.y = heading + yawFix;

      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(vessel.beamM + 14, Math.max(16, vessel.lengthM * 0.22), vessel.lengthM + 18),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        }),
      );
      hitbox.position.y = Math.max(6, vessel.lengthM * 0.1);
      root.add(hitbox);

      let headingDeg = THREE.MathUtils.radToDeg(heading);
      if (!Number.isFinite(headingDeg)) headingDeg = null;
      else {
        headingDeg = ((headingDeg % 360) + 360) % 360;
      }
      const info = {
        id: vessel.aisName,
        name: vessel.aisName,
        type: vessel.type,
        vesselClass: vessel.type,
        lengthM: vessel.lengthM,
        widthM: vessel.beamM,
        draughtM: vessel.draughtM,
        sizeText: `${vessel.lengthM.toFixed(2)} m × ${vessel.beamM.toFixed(1)} m`,
        capacityPassengers: vessel.capacityPassengers ?? null,
        capacityCrew: vessel.capacityCrew ?? null,
        grossTonnage: vessel.grossTonnage ?? null,
        lon,
        lat,
        heading: headingDeg,
        aisName: vessel.aisName,
        aisMmsi: null,
        imo: vessel.imo,
        flag: vessel.flag,
        aisStatus: "Moored · Mandovi (casino berth)",
        // Kept for diagnostics only — not shown in the public tooltip.
        modelSource: MODEL_LABEL[vessel.model] || vessel.model,
      };
      const entry = {
        root,
        info,
        vessel,
        modelBottom: tpl.modelBottom,
        heightScale: scales.heightScale,
        immerse,
      };
      root.traverse((obj) => {
        obj.userData.casinoShipEntry = entry;
        obj.userData.shipDetectionEntry = entry;
      });
      group.add(root);
      entries.push(entry);

      console.info("[casino-ships] placed", {
        name: vessel.aisName,
        imo: vessel.imo,
        model: vessel.model,
        hull: MODEL_LABEL[vessel.model],
        loa_x_beam: info.sizeText,
        lon,
        lat,
      });
    }

    syncVisibility();
    console.info("[casino-ships] ready", {
      count: entries.length,
      hulls: entries.map((e) => `${e.info.aisName}→${e.info.modelSource}`),
    });
    return { count: entries.length };
  }

  const ready = load().catch((error) => {
    console.warn("[casino-ships] load failed", error?.message || error);
    return { count: 0, error };
  });

  function setWaterSurfaceY(waterY) {
    const y = Number.isFinite(waterY) ? waterY : SURFACE_Y;
    for (const entry of entries) {
      const immerse = entry.immerse ?? 1.2;
      const bottom = entry.modelBottom ?? 0;
      const hs = entry.heightScale ?? 1;
      entry.root.position.y = y - bottom * hs - immerse;
    }
  }

  return {
    group,
    ready,
    pick,
    select,
    setThematicSuppressed,
    setWaterSurfaceY,
    isVisible: () => group.visible,
    getDetections: () => entries.map((e) => e.info),
  };
}
