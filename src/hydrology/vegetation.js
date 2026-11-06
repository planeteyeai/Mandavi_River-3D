import * as THREE from "three";
import { lonLatToLocal } from "../utils/chainageUtils.js";

export function createVegetation(scene, riverData, originLon, originLat) {
  const lons = riverData.lon || [];
  const lats = riverData.lat || [];
  const widths = riverData.real_width_m || riverData.width_m || [];
  const n = lons.length;

  if (n < 2) return new THREE.Group();

  const treeCount = n * 4; 
  
  // Premium stylized tree trunk (sleek dark metallic)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.6, 4, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ 
    color: 0x112233, 
    metalness: 0.8,
    roughness: 0.2 
  });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  
  // Premium stylized leaves (glowing translucent green/cyan glass cones)
  const leavesGeo = new THREE.ConeGeometry(2.5, 7, 5); // 5-sided for a sharp low-poly tech look
  const leavesMat = new THREE.MeshPhysicalMaterial({ 
    color: 0x00ff88, 
    emissive: 0x00aa55,
    emissiveIntensity: 0.2,
    metalness: 0.4,
    roughness: 0.2,
    transparent: true,
    opacity: 0.7,
    transmission: 0.6,
    clearcoat: 1.0
  });
  const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, treeCount);

  const group = new THREE.Group();
  group.name = "vegetation-layer";
  group.add(trunkMesh);
  group.add(leavesMesh);

  const dummy = new THREE.Object3D();
  let instanceIdx = 0;

  for (let i = 0; i < n; i++) {
    const { x, z } = lonLatToLocal(lons[i], lats[i], originLon, originLat);
    const halfW = Math.max(8, (widths[i] || 50) * 0.5);

    let tx = 0, tz = 1;
    if (i < n - 1) {
      const next = lonLatToLocal(lons[i + 1], lats[i + 1], originLon, originLat);
      const dx = next.x - x, dz = next.z - z;
      const len = Math.hypot(dx, dz) || 1;
      tx = dx / len; tz = dz / len;
    }

    for(let j = 0; j < 4; j++) {
      if (instanceIdx >= treeCount) break;
      
      const isLeft = j % 2 === 0;
      const offsetDist = halfW + 2 + Math.random() * 25; 
      const sideDir = isLeft ? -1 : 1;
      
      const alongDist = (Math.random() - 0.5) * 15;
      
      const px = x + tz * offsetDist * sideDir + tx * alongDist;
      const pz = z - tx * offsetDist * sideDir + tz * alongDist;

      const scale = 0.6 + Math.random() * 0.8;
      
      // Trunk
      dummy.position.set(px, 2 * scale - 0.5, pz);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(instanceIdx, dummy.matrix);

      // Leaves
      dummy.position.set(px, 5.5 * scale - 0.5, pz);
      dummy.updateMatrix();
      leavesMesh.setMatrixAt(instanceIdx, dummy.matrix);

      instanceIdx++;
    }
  }
  
  trunkMesh.instanceMatrix.needsUpdate = true;
  leavesMesh.instanceMatrix.needsUpdate = true;

  return group;
}
