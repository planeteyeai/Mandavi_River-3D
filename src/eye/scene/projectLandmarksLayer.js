/**
 * PROJECT LANDMARKS — 3D markers from Updates KMZ Point placemarks.
 * Positions come only from source coordinates via geoToWorld.
 */
import * as THREE from "three";
import { geoToWorld } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

const MARKER_COLOR = 0xe8b84a;
const SELECT_COLOR = 0xfff1c2;
const PICK_R2 = 22 * 22;
const _tmpLabelPos = new THREE.Vector3();

/**
 * @param {object} dataset
 * @param {Array} landmarks  projected landmark records from updatesData
 */
export function createProjectLandmarksLayer(dataset, landmarks = []) {
  const group = new THREE.Group();
  group.name = "projectLandmarks";
  group.visible = state.showProjectLandmarks !== false;

  const stations = dataset?.corridor?.stations || [];
  const records = [];

  const stemGeo = new THREE.CylinderGeometry(0.55, 0.85, 10, 8);
  const headGeo = new THREE.SphereGeometry(2.4, 16, 12);
  const stemMat = new THREE.MeshStandardMaterial({
    color: MARKER_COLOR,
    metalness: 0.15,
    roughness: 0.55,
    emissive: 0x3a2a08,
    emissiveIntensity: 0.25,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: MARKER_COLOR,
    metalness: 0.2,
    roughness: 0.4,
    emissive: 0x5a4010,
    emissiveIntensity: 0.35,
  });
  const selectMat = headMat.clone();
  selectMat.color = new THREE.Color(SELECT_COLOR);
  selectMat.emissiveIntensity = 0.7;

  const labelSprites = [];

  for (const lm of landmarks) {
    let x = lm.x;
    let z = lm.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      try {
        const w = geoToWorld(lm.lon, lm.lat, lm.elevation || 0);
        x = w.x;
        z = w.z;
      } catch {
        console.warn("[projectLandmarks] skip (no geo frame yet)", lm.name);
        continue;
      }
    }

    const groundY = Number.isFinite(terrainHeightAt(x, z, stations))
      ? terrainHeightAt(x, z, stations)
      : SURFACE_Y;
    const y = Math.max(groundY, SURFACE_Y) + 6;

    const marker = new THREE.Group();
    marker.name = `landmark:${lm.id || lm.name}`;
    marker.position.set(x, y, z);

    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 5;
    stem.castShadow = true;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 11.2;
    head.castShadow = true;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 4.2, 32),
      new THREE.MeshBasicMaterial({
        color: MARKER_COLOR,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;

    marker.add(stem, head, ring);

    const label = makeLabelSprite(lm.name);
    const isBeach = /beach/i.test(String(lm.name || ""));
    label.position.set(0, isBeach ? 22 : 18, 0);
    marker.add(label);
    labelSprites.push(label);

    const record = {
      ...lm,
      x,
      z,
      y,
      object: marker,
      head,
      headMat,
      selectMat,
    };
    marker.userData.landmark = record;
    records.push(record);
    group.add(marker);
  }

  let selectedId = null;

  group.userData.records = records;
  group.userData.stats = {
    count: records.length,
    source: "src/data/Updates/original/*.kmz",
    provenance: "OBSERVED",
  };

  group.userData.setVisible = (on) => {
    group.visible = !!on;
    state.showProjectLandmarks = !!on;
  };

  group.userData.setSelected = (idOrNull) => {
    selectedId = idOrNull;
    for (const r of records) {
      const on = r.id === idOrNull || r.name === idOrNull;
      r.head.material = on ? r.selectMat : r.headMat;
      r.object.scale.setScalar(on ? 1.25 : 1);
    }
  };

  group.userData.pickNearest = (x, z, maxR2 = PICK_R2) => {
    let best = null;
    let bestD = maxR2;
    for (const r of records) {
      const d = (r.x - x) ** 2 + (r.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  };

  group.userData.focusOn = (idOrName, cameraSystem) => {
    const r = records.find((n) => n.id === idOrName || n.name === idOrName);
    if (!r) return false;
    group.userData.setSelected(r.id);
    cameraSystem?.controls?.target?.set?.(r.x, r.y, r.z);
    if (cameraSystem?.camera) {
      const cam = cameraSystem.camera;
      cam.position.set(r.x + 180, r.y + 140, r.z + 220);
      cameraSystem.controls?.update?.();
    }
    return true;
  };

  group.userData.update = (_dt, camera) => {
    if (!group.visible || !camera) return;
    const camPos = camera.position;
    const wideView =
      state.cameraMode === "overview" ||
      state.cameraMode === "aerial" ||
      state.cameraMode === "top" ||
      state.cameraMode === "2d";

    // 3D: only landmarks near the selected chainage (stops horizon name pile-up).
    // 2D / overview: show every pin + name.
    const NEAR_CHAIN_M = 1200;
    const LABEL_CAM_M = 850;
    const MAX_NEAR = 2;
    const focusM = Number.isFinite(state.selectedChainageMeters)
      ? state.selectedChainageMeters
      : null;
    const ranked = [];
    if (!wideView) {
      for (const r of records) {
        const camD2 = (r.x - camPos.x) ** 2 + (r.z - camPos.z) ** 2;
        let score = camD2;
        if (focusM != null && Number.isFinite(r.chainage_m)) {
          const cm = Math.abs(r.chainage_m - focusM);
          score = cm * cm + camD2 * 0.05;
        }
        ranked.push({ r, score, camD2 });
      }
      ranked.sort((a, b) => a.score - b.score);
    }

    const nearSet = new Set();
    const labelSet = new Set();
    if (!wideView) {
      let n = 0;
      for (const { r, score, camD2 } of ranked) {
        if (n >= MAX_NEAR) break;
        const chainNear =
          focusM != null && Number.isFinite(r.chainage_m)
            ? Math.abs(r.chainage_m - focusM) <= NEAR_CHAIN_M
            : Math.sqrt(camD2) <= NEAR_CHAIN_M;
        if (!chainNear && n > 0) continue;
        if (!chainNear && Math.sqrt(camD2) > NEAR_CHAIN_M * 1.5) continue;
        nearSet.add(r);
        // Names only when close enough that they don't stack on the horizon.
        if (camD2 <= LABEL_CAM_M * LABEL_CAM_M) labelSet.add(r);
        n++;
      }
    }

    for (const r of records) {
      const show = wideView || nearSet.has(r);
      if (r.object) r.object.visible = show;
      // Hide name sprites that would pile up in the distance.
      for (const child of r.object?.children || []) {
        if (child?.isSprite) {
          child.visible = wideView || labelSet.has(r);
        }
      }
    }

    for (const spr of labelSprites) {
      if (!spr.visible || !spr.parent?.visible) continue;
      spr.quaternion.copy(camera.quaternion);
      // Landmark pin labels — ~16 px on screen.
      const wp = spr.getWorldPosition(_tmpLabelPos);
      const dist = camPos.distanceTo(wp);
      const baseW = spr.userData.baseScaleW || 58;
      const baseH = spr.userData.baseScaleH || 12;
      const viewHeightWorld = camera.isOrthographicCamera
        ? (camera.top - camera.bottom) / Math.max(0.001, camera.zoom)
        : 2 * dist * Math.tan(THREE.MathUtils.degToRad((camera.fov || 50) * 0.5));
      const viewportHeight = Math.max(1, window.innerHeight || 1);
      const spriteHeightPx = 16 / (spr.userData.textInkRatio || 0.27);
      const worldHeight = (viewHeightWorld * spriteHeightPx) / viewportHeight;
      const scale = worldHeight / baseH;
      spr.scale.set(baseW * scale, baseH * scale, 1);
    }
  };

  console.info("[projectLandmarks]", group.userData.stats);
  return group;
}

function makeLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const label = String(text || "").slice(0, 48);
  const isBeach = /beach/i.test(label);
  // High-resolution label texture, scaled by the camera to ~16 px on screen.
  // Sweet light-green → bright-blue fill.
  const stroke = "rgba(2, 18, 32, 0.96)";
  const fontPx = 96;

  ctx.font = `800 ${fontPx}px "Segoe UI", "Avenir Next", "Helvetica Neue", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const metrics = ctx.measureText(label);
  const tw = Math.max(80, metrics.width);
  const fill = ctx.createLinearGradient(cx - tw * 0.5, cy, cx + tw * 0.5, cy);
  fill.addColorStop(0, "#8CFFB8");
  fill.addColorStop(0.45, "#5EF0D0");
  fill.addColorStop(1, "#2AD4FF");

  ctx.shadowColor = "rgba(0, 28, 42, 0.95)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;

  ctx.lineWidth = 12;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = stroke;
  ctx.strokeText(label, cx, cy);

  ctx.shadowBlur = 0;
  ctx.fillStyle = fill;
  ctx.fillText(label, cx, cy);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(180, 255, 240, 0.45)";
  ctx.strokeText(label, cx, cy);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const spr = new THREE.Sprite(mat);
  const baseW = 58;
  const baseH = 12;
  spr.scale.set(baseW, baseH, 1);
  spr.renderOrder = 50;
  spr.center.set(0.5, 0.15);
  spr.userData.isBeachLabel = isBeach;
  spr.userData.baseScaleW = baseW;
  spr.userData.baseScaleH = baseH;
  spr.userData.textInkRatio = (fontPx * 0.9) / canvas.height;
  return spr;
}
