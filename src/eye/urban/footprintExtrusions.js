import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  getBuildingMaterial,
  getMidLodMaterial,
  neighborhoodPaletteColor,
  styleClassFromClassification,
  terracottaRoofColor,
} from "./buildingMaterials.js";
import { sampleFootprintElevation } from "./footprintPlacement.js";

/**
 * Extrude actual OSM footprints with authentic Goan pitched hip terracotta tile roofs.
 */
export function buildFootprintTier(records, stations, opts = {}) {
  const {
    name = "footprintTier",
    maxCount = 4000,
    individualHero = false,
    roofSlab = true,
    useMidMaterial = false,
  } = opts;

  const group = new THREE.Group();
  group.name = name;

  const sorted = [...records].sort((a, b) => a.dist - b.dist).slice(0, maxCount);
  if (individualHero) {
    for (const rec of sorted) {
      const mesh = buildSingleFootprint(rec, stations, { roofSlab, useMidMaterial, hero: true });
      if (mesh) group.add(mesh);
    }
    return group;
  }

  const byStyle = new Map();
  const roofGeos = [];

  for (const rec of sorted) {
    const { building, metrics, classification } = rec;
    const verts = building.vertices;
    if (!verts || verts.length < 4) continue;

    const style = styleClassFromClassification(classification);
    const y = sampleFootprintElevation(metrics, stations);
    const h = classification.heightM;
    const shape = makeShape(verts, metrics);
    if (!shape) continue;

    let bodyGeo;
    try {
      bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    } catch {
      continue;
    }
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(metrics.centroidX, y, metrics.centroidZ);

    const seed = classification.paletteSeed ?? building.id ?? 0;
    const palette = neighborhoodPaletteColor(seed, metrics.centroidX, metrics.centroidZ);
    paintWallRoofGeo(bodyGeo, palette, seed);

    if (!byStyle.has(style)) byStyle.set(style, { geos: [], colors: true });
    byStyle.get(style).geos.push(bodyGeo);

    if (roofSlab) {
      try {
        const roofGeo = buildGoanPitchedRoofGeo(verts, metrics, y, h, seed);
        if (roofGeo) roofGeos.push(roofGeo);
      } catch {
        /* ignore */
      }
    }
  }

  for (const [style, bucket] of byStyle) {
    if (!bucket.geos.length) continue;
    const merged = mergeGeometries(bucket.geos, false);
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue;
    merged.computeVertexNormals();
    const mat = bucket.colors ? getMidLodMaterial() : getMidLodMaterial();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `${name}:${style}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roofGeos.length) {
    const mergedRoof = mergeGeometries(roofGeos, false);
    for (const g of roofGeos) g.dispose();
    if (mergedRoof) {
      mergedRoof.computeVertexNormals();
      const roofMesh = new THREE.Mesh(
        mergedRoof,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.82,
          metalness: 0.04,
        }),
      );
      roofMesh.name = `${name}:roofs`;
      roofMesh.castShadow = true;
      roofMesh.receiveShadow = true;
      group.add(roofMesh);
    }
  }

  return group;
}

function buildSingleFootprint(rec, stations, { roofSlab, useMidMaterial, hero }) {
  const { building, metrics, classification } = rec;
  const verts = building.vertices;
  if (!verts || verts.length < 4) return null;

  const style = styleClassFromClassification(classification);
  const y = sampleFootprintElevation(metrics, stations);
  const h = classification.heightM;
  const shape = makeShape(verts, metrics);
  if (!shape) return null;

  const sub = new THREE.Group();
  sub.name = `hero:${building.id ?? ""}`;

  try {
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(metrics.centroidX, y, metrics.centroidZ);
    const mat = getBuildingMaterial(style).clone();
    const seed = classification.paletteSeed ?? building.id ?? 0;
    const col = neighborhoodPaletteColor(seed, metrics.centroidX, metrics.centroidZ);
    mat.color.copy(col);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    sub.add(body);

    if (roofSlab) {
      const roofGeo = buildGoanPitchedRoofGeo(verts, metrics, y, h, seed);
      if (roofGeo) {
        const roofMesh = new THREE.Mesh(
          roofGeo,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.82,
            metalness: 0.04,
          }),
        );
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        sub.add(roofMesh);
      }
    }
  } catch {
    return null;
  }

  sub.userData.metrics = metrics;
  return sub;
}

function makeShape(verts, metrics) {
  try {
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x - metrics.centroidX, -(verts[0].z - metrics.centroidZ));
    for (let k = 1; k < verts.length; k++) {
      shape.lineTo(verts[k].x - metrics.centroidX, -(verts[k].z - metrics.centroidZ));
    }
    return shape;
  } catch {
    return null;
  }
}

function paintGeo(geo, color) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/** Wall vs roof vertex colors — makes extrusions read as 3D from oblique views. */
export function paintWallRoofGeo(geo, baseColor, seed = 0) {
  geo.computeVertexNormals();
  const norm = geo.attributes.normal;
  const n = norm.count;
  const col = new Float32Array(n * 3);
  const wall = baseColor.clone();
  const roof = terracottaRoofColor(seed);
  wall.offsetHSL(0, 0, -0.04);
  for (let i = 0; i < n; i++) {
    const ny = Math.abs(norm.getY(i));
    const c = ny > 0.62 ? roof : wall;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/**
 * Authentic Goan Pitched Hip Roof with terracotta Mangalore clay tiles and eaves overhang.
 */
export function buildGoanPitchedRoofGeo(verts, metrics, wallY, wallH, seed = 0) {
  if (!verts || verts.length < 3) return null;
  const cx = metrics.centroidX;
  const cz = metrics.centroidZ;
  const eavesY = wallY + wallH;

  // Calculate eaves vertices with 0.55m overhang
  const eavesVerts = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const vx = verts[i].x;
    const vz = verts[i].z;
    const dx = vx - cx;
    const dz = vz - cz;
    const dist = Math.hypot(dx, dz) || 1;
    const overhang = 0.55;
    eavesVerts.push({
      x: vx + (dx / dist) * overhang,
      y: eavesY,
      z: vz + (dz / dist) * overhang,
    });
  }

  // Pitch height: 1.8m to 3.4m based on building dimensions
  const w = metrics.width || 12;
  const d = metrics.length || 14;
  const minDim = Math.min(w, d);
  const pitchH = Math.min(3.4, Math.max(1.8, minDim * 0.38));
  const ridgeY = eavesY + pitchH;

  // Authentic Mangalore clay terracotta tile color with subtle per-house variation
  const tileBase = terracottaRoofColor(seed);
  const tileLight = tileBase.clone().offsetHSL(0.01, 0.04, 0.04);
  const tileDark = tileBase.clone().offsetHSL(-0.01, -0.04, -0.04);

  const positions = [];
  const colors = [];

  function addTri(p0, p1, p2, col) {
    positions.push(p0.x, p0.y, p0.z);
    positions.push(p1.x, p1.y, p1.z);
    positions.push(p2.x, p2.y, p2.z);
    for (let k = 0; k < 3; k++) {
      colors.push(col.r, col.g, col.b);
    }
  }

  // If 4 vertices (quad / rectangular house) -> classic 4-pitch Goan Hip Roof
  if (n === 4) {
    const d01 = Math.hypot(eavesVerts[1].x - eavesVerts[0].x, eavesVerts[1].z - eavesVerts[0].z);
    const d12 = Math.hypot(eavesVerts[2].x - eavesVerts[1].x, eavesVerts[2].z - eavesVerts[1].z);

    let axisX, axisZ, ridgeL;
    if (d01 >= d12) {
      axisX = (eavesVerts[1].x - eavesVerts[0].x) / (d01 || 1);
      axisZ = (eavesVerts[1].z - eavesVerts[0].z) / (d01 || 1);
      ridgeL = Math.max(0.6, (d01 - d12) * 0.65);
    } else {
      axisX = (eavesVerts[2].x - eavesVerts[1].x) / (d12 || 1);
      axisZ = (eavesVerts[2].z - eavesVerts[1].z) / (d12 || 1);
      ridgeL = Math.max(0.6, (d12 - d01) * 0.65);
    }

    const r0 = { x: cx - axisX * (ridgeL * 0.5), y: ridgeY, z: cz - axisZ * (ridgeL * 0.5) };
    const r1 = { x: cx + axisX * (ridgeL * 0.5), y: ridgeY, z: cz + axisZ * (ridgeL * 0.5) };

    const e0 = eavesVerts[0];
    const e1 = eavesVerts[1];
    const e2 = eavesVerts[2];
    const e3 = eavesVerts[3];

    if (d01 >= d12) {
      // Long slopes
      addTri(e0, e1, r1, tileBase);
      addTri(e0, r1, r0, tileBase);
      addTri(e2, e3, r0, tileLight);
      addTri(e2, r0, r1, tileLight);
      // Hip ends
      addTri(e1, e2, r1, tileDark);
      addTri(e3, e0, r0, tileDark);
    } else {
      // Long slopes
      addTri(e1, e2, r1, tileBase);
      addTri(e1, r1, r0, tileBase);
      addTri(e3, e0, r0, tileLight);
      addTri(e3, r0, r1, tileLight);
      // Hip ends
      addTri(e0, e1, r0, tileDark);
      addTri(e2, e3, r1, tileDark);
    }
  } else {
    // Polygonal footprint: central apex hip roof
    const apex = { x: cx, y: ridgeY, z: cz };
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const c = i % 2 === 0 ? tileBase : tileLight;
      addTri(eavesVerts[i], eavesVerts[next], apex, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
