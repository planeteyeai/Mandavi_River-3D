import * as THREE from "three";
import { formatChainage } from "../../utils/chainageUtils.js";

export function createChainageMarker() {
  const group = new THREE.Group();
  group.name = "chainage-marker";

  // Vertical pole
  const poleGeo = new THREE.CylinderGeometry(0.6, 0.6, 80, 8);
  const poleMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 40;
  group.add(pole);

  // Pulsing ring
  const ringGeo = new THREE.RingGeometry(6, 9, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  group.add(ring);

  // Outer glow ring
  const outerGeo = new THREE.RingGeometry(9, 14, 32);
  const outerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.25 });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = 0.2;
  group.add(outer);

  // Cross section line
  const crossGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-50, 0.5, 0), new THREE.Vector3(50, 0.5, 0)
  ]);
  const crossMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 });
  const cross = new THREE.Line(crossGeo, crossMat);
  group.add(cross);

  let _crossWidth = 50;

  group.setPosition = function(station, originLon, originLat) {
    if (station.lat == null || station.lon == null) return;
    const { lonLatToLocal } = require("../../utils/chainageUtils.js");
    // handled externally by ChainageSceneSync
  };

  group.setLocalPosition = function(x, z) {
    group.position.set(x, 0, z);
  };

  group.setWidth = function(w) {
    _crossWidth = w ? w * 0.5 : 50;
    const pts = crossGeo.attributes.position;
    pts.setX(0, -_crossWidth); pts.setX(1, _crossWidth);
    pts.needsUpdate = true;
  };

  group.update = function(time) {
    const pulse = 0.65 + 0.35 * Math.sin(time * 0.003);
    ringMat.opacity = pulse * 0.85;
    outerMat.opacity = pulse * 0.3;
    const scale = 1.0 + 0.12 * Math.sin(time * 0.004);
    outer.scale.setScalar(scale);
  };

  return group;
}
