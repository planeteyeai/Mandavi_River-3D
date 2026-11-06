// Object picking with raycaster
import * as THREE from "three";
const raycaster = new THREE.Raycaster();
export function pick(pointer, camera, objects) {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(objects, true);
}
