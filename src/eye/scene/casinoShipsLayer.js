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
const FISHING_DAE = `${FISHING_DIR}Fishing%20Vessel%20VII.dae`;

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
    type: "Passenger Ship",
    flag: "INDIA",
    lengthM: 71,
    beamM: 24,
    draughtM: 3.6,
    lat: 15.502575,
    lon: 73.821917,
    model: "silja",
  },
  "pride goa 2": {
    aisName: "PRIDE OF GOA II",
    imo: "8530063",
    type: "Passenger Ship",
    flag: "INDIA",
    lengthM: 73,
    beamM: 24,
    draughtM: 3.8,
    lat: 15.502702,
    lon: 73.824023,
    model: "gabriella",
  },
  "pride of goa ii": {
    aisName: "PRIDE OF GOA II",
    imo: "8530063",
    type: "Passenger Ship",
    flag: "INDIA",
    lengthM: 73,
    beamM: 24,
    draughtM: 3.8,
    lat: 15.502702,
    lon: 73.824023,
    model: "gabriella",
  },
  "pride of goa": {
    aisName: "PRIDE OF GOA",
    imo: "9093830",
    type: "Ro-Ro/Passenger Ship",
    flag: "INDIA",
    lengthM: 66.14,
    beamM: 19,
    draughtM: 3.5,
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
    type: "Passenger Ship",
    flag: "INDIA",
    lengthM: 70,
    beamM: 22,
    draughtM: 3.5,
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

function prepareTemplate(object3d) {
  const root = object3d.clone(true);
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
  const loader = new ColladaLoader();
  loader.setResourcePath(FISHING_DIR);
  const collada = await loader.loadAsync(FISHING_DAE);
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

    const [fishingTpl, siljaTpl, gabriellaTpl] = await Promise.all([
      needed.has("fishing") ? loadFishingTemplate() : Promise.resolve(null),
      needed.has("silja") ? loadGlbTemplate(siljaUrl) : Promise.resolve(null),
      needed.has("gabriella") ? loadGlbTemplate(gabriellaUrl) : Promise.resolve(null),
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
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (!mat) continue;
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
          }
        }
      });
      root.add(model);

      const immerse = Math.min(vessel.draughtM * 0.45, 2.2);
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

      const info = {
        id: vessel.aisName,
        name: vessel.aisName,
        type: vessel.type,
        vesselClass: vessel.type,
        lengthM: vessel.lengthM,
        widthM: vessel.beamM,
        sizeText: `${vessel.lengthM.toFixed(2)} m × ${vessel.beamM.toFixed(1)} m`,
        lon,
        lat,
        heading: THREE.MathUtils.radToDeg(heading),
        aisName: vessel.aisName,
        aisMmsi: null,
        imo: vessel.imo,
        flag: vessel.flag,
        aisStatus: "Moored · Mandovi (casino berth)",
        sensor: "Casino Ship KML + AIS particulars",
        detectionMethod: "KML placemark",
        locationNote: "West Coast India · Mandovi River, Goa",
        modelSource: MODEL_LABEL[vessel.model] || vessel.model,
      };
      const entry = { root, info, vessel };
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

  return {
    group,
    ready,
    pick,
    select,
    setThematicSuppressed,
    isVisible: () => group.visible,
    getDetections: () => entries.map((e) => e.info),
  };
}
