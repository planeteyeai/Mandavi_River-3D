import * as THREE from "three";
import { lonLatToLocal } from "../../utils/chainageUtils.js";

export function createFlowArrows(data, originLon, originLat) {
  const lats = data.lat || data.latitude || [];
  const lons = data.lon || data.longitude || [];
  const n = Math.min(lats.length, 60);
  const step = Math.max(1, Math.floor(lats.length / n));

  const arrowGeo = new THREE.ConeGeometry(2.5, 8, 5);
  arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.55 });

  const group = new THREE.Group();
  group.name = "flow-arrows";

  const arrows = [];
  for (let i = step; i < lats.length - step; i += step) {
    const { x, z } = lonLatToLocal(lons[i], lats[i], originLon, originLat);
    const next = lonLatToLocal(lons[Math.min(i + step, lats.length - 1)], lats[Math.min(i + step, lats.length - 1)], originLon, originLat);
    const dx = next.x - x, dz = next.z - z;
    const angle = Math.atan2(dx, dz);
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.set(x, 1.5, z);
    mesh.rotation.y = -angle;
    mesh._baseZ = z;
    mesh._speed = 0.3 + Math.random() * 0.15;
    mesh._range = 15 + Math.random() * 10;
    group.add(mesh);
    arrows.push(mesh);
  }

  group.update = function(time, speed) {
    const t = time * 0.001 * speed * 2.0;
    arrows.forEach((a, i) => {
      a.position.z = a._baseZ + Math.sin(t * a._speed + i) * a._range;
    });
  };

  return group;
}
