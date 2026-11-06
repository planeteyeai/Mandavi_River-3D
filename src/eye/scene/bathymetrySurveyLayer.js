/**
 * CSIR-NIO Official Mandovi Survey Station Markers Layer
 *
 * Renders 3D hydrographic beacons and survey pins at the exact coordinates
 * of the 34 official CSIR-NIO stations (Stations 67 to 100) from the August 2021 Report.
 */

import * as THREE from "three";
import { bathymetryService } from "../services/hydrology/bathymetryService.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";

export function createBathymetrySurveyLayer(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = "bathymetrySurveyStations";
  group.visible = true;

  const markers = [];
  const pickMeshList = [];

  const markerGeo = new THREE.CylinderGeometry(0.8, 1.4, 4.5, 16);
  markerGeo.translate(0, 2.25, 0);

  const ringGeo = new THREE.RingGeometry(3.5, 4.8, 32);
  ringGeo.rotateX(-Math.PI / 2);

  const markerMat = new THREE.MeshStandardMaterial({
    color: 0x00f2fe,
    emissive: 0x005577,
    roughness: 0.25,
    metalness: 0.8,
  });

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00e5b4,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const capGeo = new THREE.SphereGeometry(1.2, 16, 16);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x00d2ff,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });

  async function loadStations() {
    await bathymetryService.init();
    const stations = bathymetryService.getOfficialStations();
    if (!stations.length) return;

    for (const st of stations) {
      // Same WGS84 → UTM → scene transform as the river, terrain and OSM layers.
      const local = lonLatToLocal(st.lon, st.lat);
      const stGroup = new THREE.Group();
      stGroup.position.set(local.x, SURFACE_Y + 0.1, local.z);

      const beacon = new THREE.Mesh(markerGeo, markerMat);
      beacon.castShadow = true;
      stGroup.add(beacon);

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.1;
      stGroup.add(ring);

      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 4.8;
      stGroup.add(cap);

      // Hit proxy for raycasting
      const hitGeo = new THREE.CylinderGeometry(6, 6, 8, 12);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.position.y = 3.5;
      hitMesh.userData = {
        isSurveyStation: true,
        station: st,
        localX: local.x,
        localZ: local.z,
      };
      stGroup.add(hitMesh);
      pickMeshList.push(hitMesh);

      markers.push({ group: stGroup, station: st });
      group.add(stGroup);
    }

    console.info(`[BathymetrySurveyLayer] Rendered ${markers.length} official CSIR-NIO survey stations.`);
  }

  loadStations().catch((err) => console.warn("[BathymetrySurveyLayer] Init error:", err));

  scene.add(group);

  group.userData = {
    pickMeshList,
    setVisible(on) {
      group.visible = !!on;
    },
    getStationAtRay(hitObject) {
      if (hitObject?.userData?.isSurveyStation) {
        return hitObject.userData.station;
      }
      return null;
    },
  };

  return group;
}
