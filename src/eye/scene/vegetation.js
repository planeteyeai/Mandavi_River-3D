import * as THREE from "three";
import {
  terrainHeightAt,
  renderedTerrainHeightAt,
  rawDtmElevationAt,
  ribbonEdgeDistance,
  makeStationLocator,
  terrainCellDiag,
} from "./terrain.js";
import { channelBankY } from "./channelBanks.js";
import { classifyTreeAsset, preloadTreeAssets, foliageHex } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { loadOsmWater } from "../geo/osmWater.js";
import { loadLiveWaterMask } from "../geo/liveWaterMask.js";
import { RIVER_SIDE_M } from "../geo/osmContext.js";
import { SURFACE_Y } from "./river.js";

const MAX_TREES = 16000;

/**
 * Mapped OpenStreetMap tree points plus clearly approximate vegetation instances
 * derived from green-area / land-cover polygons. Polygon samples are visual canopy,
 * not surveyed individual tree locations. Nothing is planted on open water.
 * Uses reference GLB models (palm, broadleaf, conifer, birch, grass).
 * @param {object} dataset
 * @param {{ maxTrees?: number, castShadow?: boolean, terrainMesh?: object, osmWater?: object }} [opts]
 */
export async function createVegetation(dataset, opts = {}) {
  const stations = dataset.corridor.stations;
  const green = dataset.osm?.green || dataset.osm?.vegetation || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const nearBuilding = createProximityTest(buildings, () => 14);
  const nearRoad = createProximityTest(roads, (road) => (road.widthM || 5) * 0.85);
  const osmTrees = dataset.osm?.trees || [];
  const rng = mulberry(33);
  const placements = [];
  const pickables = [];
  const maxTrees = Math.max(200, Number(opts.maxTrees) || MAX_TREES);
  const castShadow = !!opts.castShadow;
  const isMandoviRiver = !!dataset.isMandovi;
  // Mandovi LULC overlay is Pune-bound — skip decode so trees plant immediately.
  const lulc = isMandoviRiver
    ? null
    : await loadLulcClassGrid().catch((err) => {
        console.warn("[vegetation] LULC unavailable — riparian band skipped:", err?.message || err);
        return null;
      });
  const osmWater =
    opts.osmWater ||
    (await loadOsmWater().catch(() => null));
  // Authoritative Mandovi water = user live_water_mandavi.kml (not invented bay rings).
  const liveWaterMask =
    opts.liveWaterMask ||
    dataset.liveWaterMask ||
    (isMandoviRiver ? await loadLiveWaterMask().catch(() => null) : null);
  const cell = terrainCellDiag(opts.terrainMesh);
  const blendStart = cell + 6 + cell;
  const outerD = blendStart + cell * 0.35;
  const locate = makeStationLocator(stations);
  /**
   * No trees on live-water KML extent (or OSM water / ribbon fallback).
   */
  const isOpenWater = (x, z) => {
    if (liveWaterMask?.available && liveWaterMask.isWaterAtLocal?.(x, z)) return true;
    if (osmWater?.isWaterAtLocal?.(x, z)) return true;
    const st = locate(x, z);
    if (!st) return false;
    const { d } = ribbonEdgeDistance(x, z, stations, st);
    return d < 4;
  };
  const groundY = (x, z) => {
    const st = locate(x, z);
    if (!st) {
      // Mandovi: still place using DTM / default when locator misses edge banks
      if (!isMandoviRiver) return null;
      const meshY = renderedTerrainHeightAt(opts.terrainMesh, x, z);
      const raw = rawDtmElevationAt(x, z);
      const y = Number.isFinite(meshY)
        ? meshY
        : Number.isFinite(raw)
          ? raw
          : SURFACE_Y + 1.6;
      return Math.max(SURFACE_Y + 0.4, y);
    }
    let { d } = ribbonEdgeDistance(x, z, stations, st);
    let raw = rawDtmElevationAt(x, z);
    // Naik Bet is dry land inside the mapped river corridor. The river ribbon
    // crosses the island there, so use its land-cover class to retain the DTM
    // surface for vegetation instead of treating the island as submerged.
    const chainage = Number(st.chainage_m);
    const cover = lulc?.classAtLocal?.(x, z);
    if (chainage >= 700 && chainage <= 1980 && d < 90 && cover && cover !== "water") {
      d = Math.max(d, 18);
      raw = Math.max(Number.isFinite(raw) ? raw : SURFACE_Y, SURFACE_Y + 1.4);
    }
    // Mandovi: keep bank placements without LULC; lift above water sheet.
    if (isMandoviRiver && d < halfWidthSafe(st) + 420) {
      d = Math.max(d, 12);
      if (!Number.isFinite(raw) || raw < SURFACE_Y) raw = SURFACE_Y + 1.6;
    }
    if (d < 4) return null;
    const real = Number.isFinite(raw) ? raw : terrainHeightAt(x, z, stations);
    const meshY = renderedTerrainHeightAt(opts.terrainMesh, x, z);
    const coarse = Number.isFinite(meshY) && meshY > SURFACE_Y - 4 ? meshY : NaN;
    const y = channelBankY(d, real, coarse, SURFACE_Y, blendStart, outerD);
    if (y >= SURFACE_Y + 0.2) return y;
    if (isMandoviRiver && d >= 6) {
      const fallback = Number.isFinite(meshY) ? meshY : Number.isFinite(real) ? real : SURFACE_Y + 1.8;
      return Math.max(SURFACE_Y + 0.5, fallback);
    }
    return null;
  };

  function halfWidthSafe(st) {
    return Math.max(20, Number(st.halfWidth) || Number(st.width) * 0.5 || 40);
  }

  for (const ot of osmTrees) {
    if (isOpenWater(ot.x, ot.z)) continue;
    if (blocked(ot.x, ot.z, nearBuilding, nearRoad, stations, true, true)) continue;
    const rawY = groundY(ot.x, ot.z);
    if (rawY == null) continue;
    const h = ot.tree_height || 8;
    const assetId = classifyTreeAsset(ot, "osm", rng);
    const scale = Math.max(0.45, Math.min(2.6, h / 8));
    const placement = {
      x: ot.x,
      z: ot.z,
      y: rawY,
      scale,
      rotY: rng() * Math.PI * 2,
      assetId,
      kind: "osm",
      meta: {
        type: "tree",
        osmId: ot.id,
        lon: ot.lon,
        lat: ot.lat,
        height: h,
        height_source: ot.height_source,
        source: ot.source || "OPENSTREETMAP",
        from_tree_row: !!ot.from_tree_row,
        genus: ot.genus,
        species: ot.species,
        assetId,
      },
    };
    placements.push(placement);
    pickables.push(placement);
  }

  // LULC / bank canopy along the corridor. Mandovi uses the full KML reach;
  // other rivers keep denser planting on the Naik Bet island band.
  const forestCanopy = [];
  const stationGap =
    stations.length > 1
      ? Math.hypot(stations[1].x - stations[0].x, stations[1].z - stations[0].z) || 12
      : 12;
  // Natural canopy on real land only. Mandovi mouth / Miramar beach stay clear
  // (satellite: open bay water + sand — no plantation rows).
  const forestSpacing = isMandoviRiver ? 7.5 : 14;
  const forestAlongStep = Math.max(1, Math.round(forestSpacing / stationGap));
  const mappedTreeCount = placements.filter((p) => p.kind === "osm").length;
  const forestBudget = Math.max(0, maxTrees - mappedTreeCount);
  for (let i = 0; i < stations.length && forestCanopy.length < forestBudget; i += forestAlongStep) {
    const st = stations[i];
    const chainage = Number(st.surveyChainageMeters ?? st.chainage_m ?? st.along ?? 0);
    if (!isMandoviRiver && (Number(st.chainage_m) < 700 || Number(st.chainage_m) > 1980)) continue;
    // Mouth reach: do not plant corridor-offset rows into Aguada Bay
    if (isMandoviRiver && chainage < 1800) continue;
    const px = -(st.flowZ || 0);
    const pz = st.flowX || 1;
    const half = halfWidthSafe(st);
    const maxOffset = half + (isMandoviRiver ? 380 : 220);
    // Random samples per station instead of a rigid parallel grid
    const samples = isMandoviRiver ? 10 : Math.ceil((maxOffset * 2) / forestSpacing);
    for (let s = 0; s < samples && forestCanopy.length < forestBudget; s++) {
      const side = rng() < 0.5 ? -1 : 1;
      const dist = half + 25 + rng() * (maxOffset - half);
      const alongJitter = (rng() - 0.5) * forestSpacing * 1.8;
      const bankJitter = (rng() - 0.5) * forestSpacing;
      const x = st.x + px * side * (dist + bankJitter) + (st.flowX || 0) * alongJitter;
      const z = st.z + pz * side * (dist + bankJitter) + (st.flowZ || 0) * alongJitter;
      if (isOpenWater(x, z)) continue;
      const cover = lulc?.classAtLocal?.(x, z);
      if (!isMandoviRiver && cover !== "forest" && cover !== "barren") continue;
      if (!isMandoviRiver && cover === "barren" && rng() > 0.18) continue;
      if (!isMandoviRiver && cover === "forest" && rng() > 0.68) continue;
      if (blocked(x, z, nearBuilding, nearRoad, stations, true, !isMandoviRiver)) continue;
      const y = groundY(x, z);
      if (y == null) continue;
      // Near mouth hills only keep elevated canopy (Fort Aguada), never flat false-land
      if (isMandoviRiver && chainage < 4500) {
        const raw = rawDtmElevationAt(x, z);
        if (!Number.isFinite(raw) || raw < SURFACE_Y + 2.2) continue;
      }
      const nearWater = dist < half + 70;
      let assetId;
      if (isMandoviRiver) {
        const roll = rng();
        assetId = nearWater
          ? roll < 0.48
            ? "palm"
            : roll < 0.82
              ? "broadleaf"
              : "birch"
          : roll < 0.55
            ? "broadleaf"
            : roll < 0.78
              ? "palm"
              : roll < 0.92
                ? "conifer"
                : "birch";
      } else {
        assetId = classifyTreeAsset({}, "forest", rng);
      }
      forestCanopy.push({
        x,
        z,
        y,
        scale: isMandoviRiver ? 1.6 + rng() * 1.1 : 0.85 + rng() * 0.35,
        rotY: rng() * Math.PI * 2,
        assetId,
        kind: isMandoviRiver ? "mandoviBank" : "naikForest",
      });
    }
  }
  for (const poly of green) {
    const polyOsmId = String(poly.id || poly.osmId || "");
    if (polyOsmId.includes("61458970")) continue;
    const props = poly;
    const areaHint = polygonArea(poly.vertices);
    const dense =
      props.natural === "wood" ||
      props.landuse === "forest" ||
      props.landuse === "orchard";
    const isMandovi = !!dataset.isMandovi;
    const targetSpacing = dense ? (isMandovi ? 5.5 : 6.5) : isMandovi ? 11 : 16;
    const maxForPoly = dense
      ? maxTrees < 3000
        ? 220
        : isMandovi
          ? 1100
          : 700
      : maxTrees < 3000
        ? 60
        : isMandovi
          ? 320
          : 180;
    const count = Math.min(
      maxForPoly,
      Math.max(8, Math.floor(areaHint / (targetSpacing * targetSpacing))),
    );
    for (let i = 0; i < count; i++) {
      const p = randomInPolygon(poly.vertices, rng);
      if (!p) continue;
      if (isOpenWater(p.x, p.z)) continue;
      if (blocked(p.x, p.z, nearBuilding, nearRoad, stations, false, true)) continue;
      const bank = nearest(p.x, p.z, stations);
      if (dataset.lite && bank.lat > bank.half + RIVER_SIDE_M) continue;
      const rawY = groundY(p.x, p.z);
      if (rawY == null) continue;
      const assetId = classifyTreeAsset(props, dense ? "forest" : "park", rng);
      const h = 7.5 + rng() * 6.5;
      const ll = dataset.frame ? dataset.frame.toLonLat(p.x, p.z) : null;
      const treePlacement = {
        x: p.x,
        z: p.z,
        y: rawY,
        scale: 0.95 + rng() * 1.5,
        rotY: rng() * Math.PI * 2,
        assetId,
        kind: dense ? "forest" : "park",
        meta: {
          type: "land-cover vegetation",
          osmId: props.id || props.osmId || `vegetation_${placements.length}`,
          name: props.name || (dense ? "Mapped forest cover" : "Mapped green area"),
          source: "LAND_COVER_DERIVED_VISUAL",
          species: null,
          genus: null,
          height: Math.round(h * 10) / 10,
          height_source: "VISUAL_ESTIMATE",
          lon: ll?.lon,
          lat: ll?.lat,
          assetId,
        },
      };
      placements.push(treePlacement);
      pickables.push(treePlacement);
    }
  }

  // Keep mapped tree points and forest polygon canopy. Never inject random fabricated trees.
  const mappedTrees = placements.filter((p) => p.kind === "osm");
  const areaDerived = placements.filter((p) => p.kind !== "osm");
  let capped = mappedTrees.concat(forestCanopy, areaDerived);
  capped = capped.slice(0, maxTrees);

  // Mandovi: reinforce inland / headland canopy only — never Aguada Bay or Miramar sand.
  if (isMandoviRiver && stations.length > 2) {
    const step = Math.max(1, Math.floor(stations.length / 280));
    for (let i = 0; i < stations.length; i += step) {
      const st = stations[i];
      const ch = Number(st.surveyChainageMeters ?? st.chainage_m ?? st.along ?? 0);
      if (ch < 2000) continue; // mouth reach: open water / beach
      const half = halfWidthSafe(st);
      for (let n = 0; n < 6; n++) {
        const side = rng() < 0.5 ? -1 : 1;
        const dist = half + 40 + rng() * 320;
        const x = st.x + (-(st.flowZ || 0)) * side * dist + (rng() - 0.5) * 22;
        const z = st.z + (st.flowX || 1) * side * dist + (rng() - 0.5) * 22;
        if (isOpenWater(x, z)) continue;
        if (blocked(x, z, nearBuilding, nearRoad, stations, true, false)) continue;
        const raw = rawDtmElevationAt(x, z);
        if (Number.isFinite(raw) && raw < SURFACE_Y + 1.5) continue;
        const y = groundY(x, z);
        if (y == null) continue;
        const roll = rng();
        capped.push({
          x,
          z,
          y,
          scale: 1.7 + rng() * 1.2,
          rotY: rng() * Math.PI * 2,
          assetId: roll < 0.4 ? "palm" : roll < 0.75 ? "broadleaf" : roll < 0.9 ? "conifer" : "birch",
          kind: "mandoviBank",
        });
      }
    }
    // Drop any residual placements that landed in the mouth bay / beach
    capped = capped.filter((p) => !isOpenWater(p.x, p.z));
    capped = capped.slice(0, maxTrees);
    console.info("[vegetation] Mandovi land canopy (mouth bay cleared)", {
      total: capped.length,
      bank: capped.filter((p) => p.kind === "mandoviBank").length,
    });
  }

  for (const p of capped) {
    if (p.y == null) {
      p.y = terrainHeightAt(p.x, p.z, stations) || SURFACE_Y + 1.2;
    }
  }

  const assetIds = capped.map((p) => p.assetId);
  const prototypes = await preloadTreeAssets(assetIds);

  const group = new THREE.Group();
  group.name = "vegetation";
  group.visible = true;

  const byAsset = new Map();
  for (const p of capped) {
    if (!prototypes.has(p.assetId)) continue;
    if (!byAsset.has(p.assetId)) byAsset.set(p.assetId, []);
    byAsset.get(p.assetId).push(p);
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  for (const [assetId, list] of byAsset) {
    const proto = prototypes.get(assetId);
    const mat = proto.material.clone();
    mat.vertexColors = true;
    mat.depthWrite = true;
    mat.transparent = false;
    // Brighten foliage so canopy remains readable from estuary overview cameras.
    if (mat.emissive) {
      mat.emissive.set(foliageHex(assetId));
      mat.emissiveIntensity = isMandoviRiver ? 0.35 : 0.08;
    }
    const mesh = new THREE.InstancedMesh(proto.geometry, mat, list.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    // Geometry bounds sit at origin — instance positions are km away. Culling
    // against the prototype sphere hides every tree in the Mandovi scene.
    mesh.frustumCulled = false;
    mesh.name = `trees:${assetId}`;
    mesh.renderOrder = 2;

    box.makeEmpty();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const targetH = treeTargetHeight(assetId, p.scale) * (isMandoviRiver ? 1.35 : 1);
      const uniform = targetH / Math.max(0.5, proto.nativeH);
      const crown =
        p.kind === "mandoviBank"
          ? 2.35
          : p.kind === "naikForest"
            ? 1.45
            : p.kind === "forest"
              ? 1.7
              : 1.15;
      dummy.position.set(p.x, (p.y || 0) + 0.2, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(uniform * crown, uniform, uniform * crown);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      box.expandByPoint(dummy.position);
      const hue = (p.x * 0.001 + p.z * 0.0013) % 1;
      color.set(foliageHex(assetId)).offsetHSL((hue - 0.5) * 0.04, 0.14, isMandoviRiver ? 0.06 : -0.02);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (!box.isEmpty()) {
      box.getCenter(center);
      box.getSize(size);
      const radius = Math.max(size.x, size.y, size.z) * 0.6 + 40;
      mesh.boundingSphere = new THREE.Sphere(center.clone(), radius);
    }
    group.add(mesh);
  }

  // Procedural mesh fallback only if GLB meshes fail to load for actual mapped trees
  if (!byAsset.size && capped.length > 0) {
    console.warn("[vegetation] GLB prototypes missing — using procedural tree mesh for mapped coordinates", {
      placements: capped.length,
      osmTrees: osmTrees.length,
      green: green.length,
    });
    group.add(createProceduralFallback(capped, stations, rng));
  }

  group.userData.pickables = pickables;
  group.userData.treeCount = capped.length;
  group.userData.mappedOsmTreesCount = mappedTrees.length;
  group.userData.polygonDerivedCount = forestCanopy.length + areaDerived.length;
  group.userData.provenance = capped.length > 0 ? "SOURCE_MAPPED (OpenStreetMap trees & forest polygons)" : "UNAVAILABLE (0 mapped trees)";
  group.userData.isIndividualSurvey = mappedTrees.length > 0;
  group.userData.glbAssets = [...byAsset.keys()];
  return group;
}

function createProceduralFallback(trees, stations, rng) {
  const n = Math.max(1, trees.length);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.SphereGeometry(1.85, 9, 7);
  canopyGeo.scale(1.15, 1.05, 1.1);
  canopyGeo.translate(0, 4.4, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({
      color: "#5c4638",
      roughness: 0.95,
      metalness: 0,
      vertexColors: false,
    }),
    n,
  );
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.78,
      metalness: 0,
      emissive: "#5aaa4a",
      emissiveIntensity: 0.28,
      vertexColors: false,
      side: THREE.DoubleSide,
    }),
    n,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    dummy.position.set(t.x, t.y ?? terrainHeightAt(t.x, t.z, stations), t.z);
    dummy.rotation.y = t.rotY || 0;
    dummy.scale.setScalar(t.scale || 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopy.setMatrixAt(i, dummy.matrix);
    color.set("#5aaa4a").offsetHSL((rng() - 0.5) * 0.06, 0.04, (rng() - 0.5) * 0.04);
    canopy.setColorAt(i, color);
  }
  trunks.count = trees.length;
  canopy.count = trees.length;
  trunks.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
  const g = new THREE.Group();
  g.add(trunks);
  g.add(canopy);
  return g;
}

/** Darken the grass strip beside the channel so the bank reads as forest floor. Heights stay unchanged. */
function blocked(x, z, nearBuilding, nearRoad, stations, allowNearRoad = false, isLandOrIsland = false) {
  if (!isLandOrIsland) {
    const near = nearest(x, z, stations);
    if (near.lat < near.half + 4) return true;
  }
  if (nearBuilding(x, z)) return true;
  if (!allowNearRoad && nearRoad(x, z)) return true;
  return false;
}

/** Build a small point-proximity index so dense forest sampling avoids O(n) scans per tree. */
function createProximityTest(features, radiusFor, cellSize = 32) {
  const cells = new Map();
  const key = (x, z) => `${x}:${z}`;
  for (const feature of features) {
    const x = Number(feature.midX);
    const z = Number(feature.midZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const radius = Math.max(0, Number(radiusFor(feature)) || 0);
    const minX = Math.floor((x - radius) / cellSize);
    const maxX = Math.floor((x + radius) / cellSize);
    const minZ = Math.floor((z - radius) / cellSize);
    const maxZ = Math.floor((z + radius) / cellSize);
    const entry = { x, z, radius };
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gz = minZ; gz <= maxZ; gz++) {
        const k = key(gx, gz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(entry);
      }
    }
  }
  return (x, z) => {
    const bucket = cells.get(key(Math.floor(x / cellSize), Math.floor(z / cellSize)));
    if (!bucket) return false;
    for (const feature of bucket) {
      if (Math.hypot(feature.x - x, feature.z - z) < feature.radius) return true;
    }
    return false;
  };
}

function nearest(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 160));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  const lat = Math.abs((x - best.x) * -best.flowZ + (z - best.z) * best.flowX);
  return { lat, half: best.halfWidth };
}

function polygonArea(verts) {
  if (!verts?.length) return 0;
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const vi = verts[i];
    const vj = verts[j];
    if (!vi || !vj) continue;
    a += vj.x * vi.z - vi.x * vj.z;
  }
  return Math.abs(a) * 0.5;
}

function randomInPolygon(verts, rng) {
  if (!verts?.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    if (!v) continue;
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  for (let tries = 0; tries < 24; tries++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    if (pointInRing(x, z, verts)) return { x, z };
  }
  return null;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (!ring[i] || !ring[j]) continue;
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function mulberry(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
