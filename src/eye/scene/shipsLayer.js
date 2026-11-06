import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";

const DATA_URL = "/data/mandovi/Ships/ship_detections_S1-20261105T054303-2bb1.geojson";
const KML_URL = "/data/mandovi/Ships/ship_detections_S1-20261105T054303-2bb1.kml";
const MODEL_URL = "/data/mandovi/Ships/Small_Ships/source/model.gltf";

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== "";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function safeShipPoint(feature) {
  const props = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  const lon = finite(coords?.[0]) ? Number(coords[0]) : Number(props.lon);
  const lat = finite(coords?.[1]) ? Number(coords[1]) : Number(props.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 73 || lon > 75 || lat < 14 || lat > 17) return null;
  return { lon, lat };
}

async function loadDetections() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`GeoJSON request failed (${response.status})`);
    const data = await response.json();
    const features = (data.features || []).filter((f) => safeShipPoint(f));
    if (features.length) return { features, scene: data.properties?.scene || {}, runId: data.properties?.run_id || "" };
  } catch (error) {
    console.warn("[ships] GeoJSON detections unavailable; trying the supplied KML", error?.message || error);
  }

  const response = await fetch(KML_URL);
  if (!response.ok) throw new Error(`Ship KML request failed (${response.status})`);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  const features = [...xml.querySelectorAll("Placemark")].flatMap((placemark, index) => {
    const coord = placemark.querySelector("Point coordinates")?.textContent?.trim().split(",").map(Number);
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return [];
    const description = placemark.querySelector("description")?.textContent || "";
    const props = Object.fromEntries([...description.matchAll(/<b>([^<]+)<\/b>:\s*([^<]*)/gi)].map((m) => [m[1], m[2]]));
    const number = (key) => Number.isFinite(Number(props[key])) ? Number(props[key]) : null;
    props.id ||= placemark.querySelector("name")?.textContent?.trim() || `ship-${index + 1}`;
    props.lon = coord[0];
    props.lat = coord[1];
    props.length_m = number("length_m");
    props.width_m = number("width_m");
    props.heading_axis_deg = number("heading_axis_deg");
    props.confidence = number("confidence");
    return [{ type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: props }];
  });
  return { features, scene: {}, runId: "" };
}

function row(label, value, unit = "") {
  return finite(value) ? [label, `${Number(value).toFixed(label === "Confidence" ? 0 : 1)}${unit}`] : [label, value ?? null];
}

function detectionInfo(feature, metadata = {}) {
  const p = feature.properties || {};
  const point = safeShipPoint(feature) || {};
  return {
    id: String(p.id || "Ship detection"),
    lon: point.lon,
    lat: point.lat,
    type: p.predicted_type || p.image_type || p.vessel_class || "Detected vessel",
    vesselClass: p.vessel_class || p.image_family || null,
    lengthM: p.length_m,
    widthM: p.width_m,
    confidence: p.confidence,
    heading: p.heading_axis_deg,
    sensor: p.sensor || "Sentinel-1 SAR",
    datetime: metadata.datetime || p.datetime || p.timestamp || null,
    aisName: p.ais_name,
    aisMmsi: p.ais_mmsi,
    aisStatus: p.ais_status,
    wake: p.wake_detected == null ? null : p.wake_detected ? "Detected" : "Not detected",
    detectionMethod: p.detection_method,
    detectionRun: metadata.runId || null,
  };
}

/** Supplied Sentinel-1 vessel detections rendered with the supplied small-ship GLTF. */
export function createShipsLayer(scene) {
  const group = new THREE.Group();
  group.name = "mandovi-ship-detections";
  group.visible = true;
  scene.add(group);

  const entries = [];
  let template = null;
  let layerSuppressed = false;
  let selectedId = null;

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
      const entry = hit.object.userData.shipDetectionEntry;
      if (entry) return entry;
    }
    return null;
  }

  function select(id) {
    selectedId = id == null ? null : String(id);
    for (const entry of entries) {
      const scale = entry.baseScale * (entry.info.id === selectedId ? 1.2 : 1);
      entry.root.scale.setScalar(scale);
    }
  }

  async function load() {
    const dataPromise = loadDetections();
    const modelPromise = new GLTFLoader().loadAsync(MODEL_URL);
    const [data, gltf] = await Promise.all([dataPromise, modelPromise]);
    const base = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(base);
    const size = bounds.getSize(new THREE.Vector3());
    const longAxis = size.x > size.z ? "x" : "z";
    const modelLength = Math.max(size.x, size.z, 0.01);
    const modelWidth = Math.max(0.01, Math.min(size.x, size.z));
    const modelBottom = bounds.min.y;
    template = base;

    for (const feature of data.features) {
      const point = safeShipPoint(feature);
      if (!point) continue;
      const p = feature.properties || {};
      const local = lonLatToLocal(point.lon, point.lat, 0);
      const targetLength = clamp(Number(p.length_m) || 18, 8, 120);
      const targetWidth = clamp(Number(p.width_m) || targetLength * 0.22, 2.2, Math.min(28, targetLength * 0.72));
      const lengthScale = targetLength / modelLength;
      const widthScale = targetWidth / modelWidth;
      const root = new THREE.Group();
      root.name = `ship-detection-${p.id || entries.length + 1}`;
      root.position.set(local.x, SURFACE_Y - modelBottom * lengthScale * 0.58 + 0.35, local.z);
      root.rotation.y = THREE.MathUtils.degToRad(Number(p.heading_axis_deg) || 0) - (longAxis === "x" ? Math.PI / 2 : 0);

      const model = base.clone(true);
      model.scale.set(
        longAxis === "x" ? lengthScale : widthScale,
        lengthScale * 0.58,
        longAxis === "x" ? widthScale : lengthScale,
      );
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
      root.add(model);

      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(targetWidth + 9, 10, targetLength + 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, colorWrite: false, depthWrite: false }),
      );
      hitbox.position.y = Math.max(2, targetLength * 0.08);
      hitbox.userData.shipDetectionEntry = null;
      root.add(hitbox);

      const info = detectionInfo(feature, { ...data.scene, runId: data.runId });
      const entry = { root, info, baseScale: 1, feature };
      root.traverse((object) => { object.userData.shipDetectionEntry = entry; });
      group.add(root);
      entries.push(entry);
    }
    syncVisibility();
    console.info("[ships] Sentinel-1 detections ready", { count: entries.length, source: DATA_URL, model: MODEL_URL });
    return { count: entries.length };
  }

  const ready = load().catch((error) => {
    console.warn("[ships] could not load ship detections/model", error?.message || error);
    return { count: 0, error };
  });

  return {
    group,
    ready,
    pick,
    select,
    setThematicSuppressed,
    isVisible: () => group.visible,
    getTemplate: () => template,
    getDetections: () => entries.map((entry) => entry.info),
  };
}

export function isShipThematicLayer(id) {
  return /^(geology|pollution|landuse_lulc|lulc|water_quality(?:_|$)|waterquality|salinity)(?:_|$)/i.test(String(id || ""));
}

export function shipTooltipRows(info) {
  return [
    ["Detection", info.id],
    ["Vessel type", info.type],
    row("Length", info.lengthM, " m"),
    row("Width", info.widthM, " m"),
    row("Confidence", finite(info.confidence) ? Number(info.confidence) * 100 : null, "%"),
    ["Sensor", info.sensor],
    ["Scene time", info.datetime],
    ["Heading", finite(info.heading) ? `${Math.round(Number(info.heading))}°` : null],
    ["AIS name", info.aisName],
    ["AIS MMSI", info.aisMmsi],
    ["AIS status", info.aisStatus],
    ["Wake", info.wake],
    ["Method", info.detectionMethod],
  ];
}
