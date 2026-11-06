import * as THREE from "three";
export function addLighting(scene) {
  const ambient = new THREE.AmbientLight(0x8899bb, 0.55);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
  sun.position.set(1500, 2000, 1000);
  sun.castShadow = false;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0x4488cc, 0x223311, 0.35);
  scene.add(hemi);
}
