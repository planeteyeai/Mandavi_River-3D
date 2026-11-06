import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCamera } from "../../hydrology/cameras.js";
import { addLighting } from "../../hydrology/lighting.js";
import { createTerrain } from "../../hydrology/terrain.js";
import { createVegetation } from "../../hydrology/vegetation.js";
import { createUrban } from "../../hydrology/urban.js";
import { createRiverSurface } from "./RiverSurface.js";
import { createFlowArrows } from "./FlowArrows.js";
import { createChainageMarker } from "./ChainageMarker.js";
import { createFloodSurface } from "./FloodSurface.js";
import { createChainageSceneSync } from "./ChainageSceneSync.js";
import { lonLatToLocal } from "../../utils/chainageUtils.js";

export function createHydrologyScene({ container, riverData, state }) {
  // Determine origin from first data point
  const lons = riverData.lon || riverData.longitude || [];
  const lats = riverData.lat || riverData.latitude || [];
  const originLon = lons[0] ?? 73.85;
  const originLat = lats[0] ?? 18.53;

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05080d);
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:fixed;inset:0;z-index:0;display:block;";
  container.appendChild(canvas);

  // --- Scene ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05080d, 3000, 10000);

  // --- Camera ---
  const camera = createCamera();

  // --- Controls ---
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 50;
  controls.maxDistance = 5000;

  // --- Lighting ---
  addLighting(scene);

  // --- Terrain ---
  createTerrain(scene);
  
  let vegetation = createVegetation(scene, riverData, originLon, originLat);
  scene.add(vegetation);
  
  let urban = createUrban(scene, riverData, originLon, originLat);
  scene.add(urban);

  // --- River ---
  let river = createRiverSurface(riverData, originLon, originLat);
  scene.add(river);

  // --- Flow Arrows ---
  let flow = createFlowArrows(riverData, originLon, originLat);
  scene.add(flow);

  // --- Chainage Marker ---
  let marker = createChainageMarker();
  scene.add(marker);

  // --- Flood Surface ---
  let flood = createFloodSurface(scene);

  // --- Scene Sync ---
  let sync = createChainageSceneSync(marker, riverData, originLon, originLat);

  // --- Resize ---
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Animate ---
  function animate(time) {
    requestAnimationFrame(animate);
    controls.update();
    if (state.layers.water) river.update?.(time, state.flowSpeed);
    if (state.layers.flow) flow.update?.(time, state.flowSpeed);
    marker.update?.(time);
    flood.update?.(time);
    renderer.render(scene, camera);
  }
  animate(0);

  return {
    scene, camera, renderer, controls,
    setStation(station) {
      sync.setStation(station);
    },
    setLayer(name, visible) {
      if (name === "water") { river.visible = visible; }
      if (name === "flow") { flow.visible = visible; }
      if (name === "chainage") { marker.visible = visible; }
      if (name === "flood") { flood.mesh.visible = visible; }
      if (name === "vegetation") { vegetation.visible = visible; }
      if (name === "buildings") { urban.visible = visible; }
    },
    setFloodStage(m) { flood.setStage(m); },
    updateRiver(newRiverData) {
      // Remove old meshes
      scene.remove(river);
      scene.remove(flow);
      scene.remove(vegetation);
      scene.remove(urban);
      if (river.geometry) river.geometry.dispose();
      if (flow.geometry) flow.geometry.dispose();
      
      vegetation.children.forEach(c => { if(c.geometry) c.geometry.dispose(); });
      if (urban.geometry) urban.geometry.dispose();

      // Determine new origin
      const lons = newRiverData.lon || [];
      const lats = newRiverData.lat || [];
      const newOriginLon = lons[0] ?? 73.85;
      const newOriginLat = lats[0] ?? 18.53;

      // Recreate meshes
      river = createRiverSurface(newRiverData, newOriginLon, newOriginLat);
      flow = createFlowArrows(newRiverData, newOriginLon, newOriginLat);
      vegetation = createVegetation(scene, newRiverData, newOriginLon, newOriginLat);
      urban = createUrban(scene, newRiverData, newOriginLon, newOriginLat);
      
      scene.add(river);
      scene.add(flow);
      scene.add(vegetation);
      scene.add(urban);

      // Recreate sync
      sync = createChainageSceneSync(marker, newRiverData, newOriginLon, newOriginLat);
      
      // Keep layers visibility
      river.visible = state.layers.water;
      flow.visible = state.layers.flow;
      vegetation.visible = state.layers.vegetation;
      urban.visible = state.layers.buildings;
    },
    originLon, originLat,
  };
}
