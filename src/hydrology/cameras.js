import * as THREE from "three";
export function createCamera() {
  const cam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
  cam.position.set(0, 900, 1200);
  cam.lookAt(0, 0, 0);
  return cam;
}
