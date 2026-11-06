import * as THREE from "three";
import { lonLatToLocal } from "../utils/chainageUtils.js";

export function createUrban(scene, riverData, originLon, originLat) {
  const lons = riverData.lon || [];
  const lats = riverData.lat || [];
  const widths = riverData.real_width_m || riverData.width_m || [];
  const n = lons.length;

  if (n < 2) return new THREE.Group();

  const buildingCount = Math.floor(n * 2.5); 
  
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  
  // Premium UI-perfect holographic glass material
  const boxMat = new THREE.MeshPhysicalMaterial({ 
    color: 0x05182d,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.15,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.7,
    transmission: 0.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1
  });
  
  const mesh = new THREE.InstancedMesh(boxGeo, boxMat, buildingCount);
  mesh.name = "buildings-layer";

  const dummy = new THREE.Object3D();
  let instanceIdx = 0;

  for (let i = 0; i < n; i++) {
    if (Math.random() > 0.6) continue;
    
    // Cluster buildings around some nodes
    const clusters = Math.floor(1 + Math.random() * 3);
    
    for (let c = 0; c < clusters; c++) {
      if (instanceIdx >= buildingCount) break;

      const { x, z } = lonLatToLocal(lons[i], lats[i], originLon, originLat);
      const halfW = Math.max(8, (widths[i] || 50) * 0.5);

      let tx = 0, tz = 1;
      if (i < n - 1) {
        const next = lonLatToLocal(lons[i + 1], lats[i + 1], originLon, originLat);
        const dx = next.x - x, dz = next.z - z;
        const len = Math.hypot(dx, dz) || 1;
        tx = dx / len; tz = dz / len;
      }

      const isLeft = Math.random() > 0.5;
      const offsetDist = halfW + 10 + Math.random() * 80; 
      const sideDir = isLeft ? -1 : 1;
      
      const px = x + tz * offsetDist * sideDir + (Math.random() - 0.5) * 20;
      const pz = z - tx * offsetDist * sideDir + (Math.random() - 0.5) * 20;

      // Stylized slender skyscrapers and blocky structures
      const isSkyscraper = Math.random() > 0.8;
      const width = isSkyscraper ? (8 + Math.random() * 8) : (15 + Math.random() * 20);
      const depth = isSkyscraper ? (8 + Math.random() * 8) : (15 + Math.random() * 20);
      const height = isSkyscraper ? (40 + Math.random() * 80) : (10 + Math.random() * 20); 
      
      dummy.position.set(px, height / 2 - 0.5, pz);
      dummy.rotation.y = Math.atan2(tx, tz) + (Math.random() > 0.5 ? 0 : Math.PI/2); 
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(instanceIdx, dummy.matrix);

      instanceIdx++;
    }
  }
  
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
