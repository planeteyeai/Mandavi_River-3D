import * as THREE from "three";
export function createTerrain(scene, bounds) {
  const geo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2d4a1e });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.5;
  scene.add(mesh);
  return mesh;
}
