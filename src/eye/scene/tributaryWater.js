import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y, depthNorm, bedElevation } from "./river.js";
import { state } from "../state.js";

const DTM_FLOOR_Y = SURFACE_Y - 5.5;

/**
 * Creates 3D flowing water surfaces, beds, and fill volumes for all tributaries of the Mandovi River.
 * Tributaries include:
 * 1. Northern Chorao Channel (encircling Chorao Island / Salim Ali channel)
 * 2. Cumbarjua Canal (heading SE towards Zuari)
 * 3. Sinquerim / Nerul River (entering Aguada Bay north shore)
 * 4. Britona / Mapusa Creek (north of Atal Setu)
 */
export async function createTributaryWaterSystem(dataset, waterMaterial) {
  if (dataset?.bathymetry?.isPolygonConstrained) {
    return null;
  }
  let tributariesData = null;
  try {
    const res = await fetch("/data/mandovi/tributaries.json");
    if (res.ok) {
      tributariesData = await res.json();
    }
  } catch (err) {
    console.warn("[tributary] Could not fetch tributaries.json, using fallback", err);
  }

  if (!tributariesData || !Array.isArray(tributariesData) || tributariesData.length === 0) {
    return null;
  }

  const group = new THREE.Group();
  group.name = "tributaryWaterSystem";

  const allStations = [];
  const tributaryMeshes = [];
  const exag = state.depthExaggeration || 1;

  // Bed color palette (soil & silt)
  const sand = new THREE.Color("#a89870");
  const silt = new THREE.Color("#6a5c44");
  const deepUnder = new THREE.Color("#3a3228");
  const groundShallow = new THREE.Color("#d2c4a0");
  const groundMid = new THREE.Color("#9a8458");
  const groundDeep = new THREE.Color("#4a3e30");
  const cutShallow = new THREE.Color("#7eb8d8");
  const cutMid = new THREE.Color("#3d7aa8");
  const cutDeep = new THREE.Color("#1e4a72");
  const tmp = new THREE.Color();

  for (const branch of tributariesData) {
    const rawStations = branch.stations;
    if (!rawStations || rawStations.length < 2) continue;

    // Convert stations to local coordinates
    const stations = rawStations.map((s) => {
      const loc = lonLatToLocal(s.lon, s.lat);
      return {
        ...s,
        x: loc.x,
        z: loc.z,
        wetHalfLeft: s.left_width_m,
        wetHalfRight: s.right_width_m,
        wetHalfWidth: (s.left_width_m + s.right_width_m) * 0.5,
      };
    });

    // Add to allStations for terrain carving
    allStations.push(...stations);

    // Compute left and right bank 3D points directly in local Three.js coordinate frame
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      let fx = 0;
      let fz = 0;
      if (i > 0 && i < stations.length - 1) {
        fx = stations[i + 1].x - stations[i - 1].x;
        fz = stations[i + 1].z - stations[i - 1].z;
      } else if (i < stations.length - 1) {
        fx = stations[i + 1].x - s.x;
        fz = stations[i + 1].z - s.z;
      } else {
        fx = s.x - stations[i - 1].x;
        fz = s.z - stations[i - 1].z;
      }
      const len = Math.hypot(fx, fz) || 1.0;
      fx /= len;
      fz /= len;
      s.flowX = fx;
      s.flowZ = fz;

      // Perpendicular vector across the river: (-flowZ, flowX)
      const px = -fz;
      const pz = fx;
      s.leftX = s.x - px * s.left_width_m;
      s.leftZ = s.z - pz * s.left_width_m;
      s.rightX = s.x + px * s.right_width_m;
      s.rightZ = s.z + pz * s.right_width_m;
    }

    const n = stations.length;
    const across = 16;
    const cols = across + 1;
    const totalLen = branch.length_m || 1000;

    const positions = [];
    const depths = [];
    const alongT = [];
    const acrossU = [];
    const flow = [];
    const narrow = [];
    const widthM = [];
    const curve = [];
    const isFlood = [];

    // Surface positions & attributes
    for (let s = 0; s < n; s++) {
      const st = stations[s];
      const t = st.chainage_m / totalLen;
      const w = st.width_m || (st.left_width_m + st.right_width_m);
      const d = st.depth_m || 3.0;

      for (let c = 0; c <= across; c++) {
        const u = c / across;
        const vx = (1.0 - u) * st.leftX + u * st.rightX;
        const vz = (1.0 - u) * st.leftZ + u * st.rightZ;

        positions.push(vx, SURFACE_Y, vz);
        depths.push(d);
        alongT.push(t);
        acrossU.push(u);
        flow.push(st.flowX, st.flowZ);
        narrow.push(Math.min(1.0, 300 / Math.max(10, w)));
        widthM.push(w);
        curve.push(0.0);
        isFlood.push(0.0);
      }
    }

    // Indices for grid
    const indices = [];
    for (let s = 0; s < n - 1; s++) {
      for (let c = 0; c < across; c++) {
        const i0 = s * cols + c;
        const i1 = s * cols + c + 1;
        const i2 = (s + 1) * cols + c;
        const i3 = (s + 1) * cols + c + 1;
        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }

    if (indices.length >= 3) {
      const a = indices[0];
      const b = indices[1];
      const c = indices[2];
      const ny =
        (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]) -
        (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3]);
      if (ny < 0) {
        for (let i = 0; i < indices.length; i += 3) {
          const t = indices[i + 1];
          indices[i + 1] = indices[i + 2];
          indices[i + 2] = t;
        }
      }
    }

    // 1. Water Surface Mesh
    const surfGeo = new THREE.BufferGeometry();
    surfGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    surfGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1));
    surfGeo.setAttribute("aAlong", new THREE.Float32BufferAttribute(alongT, 1));
    surfGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(acrossU, 1));
    surfGeo.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
    surfGeo.setAttribute("aNarrow", new THREE.Float32BufferAttribute(narrow, 1));
    surfGeo.setAttribute("aWidth", new THREE.Float32BufferAttribute(widthM, 1));
    surfGeo.setAttribute("aCurve", new THREE.Float32BufferAttribute(curve, 1));
    surfGeo.setAttribute("aIsFlood", new THREE.Float32BufferAttribute(isFlood, 1));
    surfGeo.setAttribute("aEdgeDist", new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(25.0), 1));
    surfGeo.setAttribute("aRiverDist", new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(25.0), 1));
    surfGeo.setIndex(indices);
    surfGeo.computeVertexNormals();

    const surfMesh = new THREE.Mesh(surfGeo, waterMaterial);
    surfMesh.name = `tributarySurface_${branch.name.replace(/\s+/g, "_")}`;
    surfMesh.renderOrder = 4;
    group.add(surfMesh);

    // 2. Riverbed Mesh
    const totalVerts = positions.length / 3;
    const bedPositions = new Float32Array(positions);
    const bedCol = new Float32Array(totalVerts * 3);
    const depthViewCol = new Float32Array(totalVerts * 3);
    const cutCol = new Float32Array(totalVerts * 3);

    for (let i = 0; i < totalVerts; i++) {
      const d = depths[i];
      const u = acrossU[i];
      bedPositions[i * 3 + 1] = bedElevation(d, dataset.minDepth || 1.5, dataset.maxDepth || 7.5, u, exag, SURFACE_Y);

      const tExcel = depthNorm(d, dataset.minDepth || 1.5, dataset.maxDepth || 7.5);
      const bank = Math.abs(u * 2 - 1);
      const t = THREE.MathUtils.clamp(tExcel * (1 - bank * 0.35), 0, 1);

      // Soft bed under water
      const softT = THREE.MathUtils.smoothstep(0.05, 0.95, t) * 0.55;
      tmp.copy(sand).lerp(silt, softT).lerp(deepUnder, softT * 0.85);
      bedCol[i * 3] = tmp.r;
      bedCol[i * 3 + 1] = tmp.g;
      bedCol[i * 3 + 2] = tmp.b;

      // Depth view colors
      tmp.copy(groundShallow).lerp(groundMid, THREE.MathUtils.smoothstep(0, 0.5, t)).lerp(groundDeep, THREE.MathUtils.smoothstep(0.3, 1, t));
      depthViewCol[i * 3] = tmp.r;
      depthViewCol[i * 3 + 1] = tmp.g;
      depthViewCol[i * 3 + 2] = tmp.b;

      // Cutaway colors
      tmp.copy(cutShallow).lerp(cutMid, THREE.MathUtils.smoothstep(0, 0.55, t)).lerp(cutDeep, THREE.MathUtils.smoothstep(0.35, 1, t));
      cutCol[i * 3] = tmp.r;
      cutCol[i * 3 + 1] = tmp.g;
      cutCol[i * 3 + 2] = tmp.b;
    }

    const bedGeo = new THREE.BufferGeometry();
    bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(bedPositions, 3));
    bedGeo.setAttribute("color", new THREE.Float32BufferAttribute(bedCol, 3));
    bedGeo.setAttribute("colorLand", new THREE.Float32BufferAttribute(bedCol.slice(), 3));
    bedGeo.setAttribute("colorDepthView", new THREE.Float32BufferAttribute(depthViewCol, 3));
    bedGeo.setAttribute("colorCut", new THREE.Float32BufferAttribute(cutCol, 3));
    bedGeo.setIndex(indices);
    bedGeo.computeVertexNormals();

    const bedMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    const bedMesh = new THREE.Mesh(bedGeo, bedMat);
    bedMesh.name = `tributaryBed_${branch.name.replace(/\s+/g, "_")}`;
    bedMesh.receiveShadow = true;
    bedMesh.renderOrder = 1;
    group.add(bedMesh);

    // 3. Water Volume Mesh
    const volPos = new Float32Array(totalVerts * 6);
    const volCol = new Float32Array(totalVerts * 6);
    for (let i = 0; i < totalVerts; i++) {
      const vx = positions[i * 3];
      const vz = positions[i * 3 + 2];
      const bY = bedPositions[i * 3 + 1];
      const bot = Math.min(bY - 0.15, DTM_FLOOR_Y);

      volPos[i * 3] = vx;
      volPos[i * 3 + 1] = SURFACE_Y - 0.05;
      volPos[i * 3 + 2] = vz;

      volPos[(totalVerts + i) * 3] = vx;
      volPos[(totalVerts + i) * 3 + 1] = bot;
      volPos[(totalVerts + i) * 3 + 2] = vz;

      volCol[i * 3] = 0.12; volCol[i * 3 + 1] = 0.52; volCol[i * 3 + 2] = 0.72;
      volCol[(totalVerts + i) * 3] = 0.04; volCol[(totalVerts + i) * 3 + 1] = 0.20; volCol[(totalVerts + i) * 3 + 2] = 0.32;
    }

    const volTris = [];
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      volTris.push(a + totalVerts, c + totalVerts, b + totalVerts);
    }
    // Wall quads along edges
    for (let s = 0; s < n - 1; s++) {
      // Left bank edge (c = 0)
      const l0 = s * cols;
      const l1 = (s + 1) * cols;
      volTris.push(l0, l1, l1 + totalVerts, l0, l1 + totalVerts, l0 + totalVerts);
      // Right bank edge (c = across)
      const r0 = s * cols + across;
      const r1 = (s + 1) * cols + across;
      volTris.push(r1, r0, r0 + totalVerts, r1, r0 + totalVerts, r1 + totalVerts);
    }

    const volGeo = new THREE.BufferGeometry();
    volGeo.setAttribute("position", new THREE.BufferAttribute(volPos, 3));
    volGeo.setAttribute("color", new THREE.BufferAttribute(volCol, 3));
    volGeo.setIndex(volTris);
    volGeo.computeVertexNormals();

    const volMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const volMesh = new THREE.Mesh(volGeo, volMat);
    volMesh.name = `tributaryVolume_${branch.name.replace(/\s+/g, "_")}`;
    volMesh.renderOrder = 3;
    group.add(volMesh);

    tributaryMeshes.push({
      surfMesh,
      bedMesh,
      volMesh,
      depths,
      acrossU,
      totalVerts,
      basePositions: positions.slice(),
    });
  }

  function applyExaggeration(currentExag) {
    for (const item of tributaryMeshes) {
      const { bedMesh, volMesh, depths, acrossU, totalVerts, basePositions } = item;
      const bedPosAttr = bedMesh.geometry.attributes.position;
      const volPosAttr = volMesh.geometry.attributes.position;

      for (let i = 0; i < totalVerts; i++) {
        const d = depths[i];
        const u = acrossU[i];
        const bY = bedElevation(d, dataset.minDepth || 1.5, dataset.maxDepth || 7.5, u, currentExag, SURFACE_Y);
        bedPosAttr.setY(i, bY);

        const bot = Math.min(bY - 0.15, DTM_FLOOR_Y);
        volPosAttr.setY(totalVerts + i, bot);
      }
      bedPosAttr.needsUpdate = true;
      volPosAttr.needsUpdate = true;
      bedMesh.geometry.computeVertexNormals();
      volMesh.geometry.computeVertexNormals();
    }
  }

  function applyLook(mode = "water") {
    const look = mode === true || mode === "cutaway" ? "cutaway" : mode;
    const attrName = look === "cutaway" ? "colorCut" : (look === "depth" || look === "erosionDark" ? "colorDepthView" : "colorLand");

    for (const item of tributaryMeshes) {
      const { bedMesh } = item;
      const from = bedMesh.geometry.getAttribute(attrName) || bedMesh.geometry.getAttribute("colorLand");
      const to = bedMesh.geometry.getAttribute("color");
      if (from && to) {
        to.array.set(from.array);
        to.needsUpdate = true;
      }
    }
  }

  function setVisible(waterOn) {
    for (const item of tributaryMeshes) {
      item.surfMesh.visible = waterOn;
      item.volMesh.visible = waterOn;
    }
  }

  console.info("[tributary] 3D tributary water system created", {
    branches: tributaryMeshes.length,
    totalStations: allStations.length,
  });

  return {
    group,
    stations: allStations,
    applyExaggeration,
    applyLook,
    setVisible,
  };
}
