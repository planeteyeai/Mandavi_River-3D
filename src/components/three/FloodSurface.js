import * as THREE from "three";
// FloodSurface — DEM-driven inundation layer (future)
export function createFloodSurface(scene) {
  const geo = new THREE.PlaneGeometry(3000, 3000);
  const mat = new THREE.MeshBasicMaterial({ color: 0x0077cc, transparent: true, opacity: 0.35, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 1.5;
  mesh.visible = false;
  mesh.name = "flood-surface";
  scene.add(mesh);
  return {
    mesh,
    setStage(m) { mesh.position.y = m; mesh.visible = m > 0; },
    update(t) {}
  };
}
