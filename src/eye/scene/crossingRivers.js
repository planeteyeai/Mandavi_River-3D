/**
 * Rivers that cross an uploaded bridge line.
 * A line that cuts across two or more waterways, and does not follow any of them,
 * is a bridge. Those waterways are drawn. A line that follows a waterway stays the river.
 */
import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";

const HALF_M = { river: 24, tidal_channel: 16, canal: 12, stream: 8, drain: 5 };

export function classifyCenterline(centerline, waterways) {
  const line = (centerline || []).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (line.length < 2) return { kind: "river", rivers: [] };
  const hits = [];
  for (const way of waterways || []) {
    if (!way?.coords || way.coords.length < 2) continue;
    const cross = crossingAngle(line, way.coords);
    if (!cross) continue;
    hits.push({
      ...way,
      angle: cross.angle,
      overlap: overlapFraction(line, way.coords),
    });
  }
  const follows = hits.some((hit) => hit.overlap >= 0.28);
  const crossing = hits.filter((hit) => hit.angle >= 32 && hit.overlap < 0.22);
  if (!follows && crossing.length >= 2) {
    return { kind: "bridge", rivers: uniqueWays(crossing) };
  }
  return { kind: "river", rivers: uniqueWays(crossing) };
}

export function createDetectedWater(rivers, polygons) {
  const group = new THREE.Group();
  group.name = "detectedRivers";
  const material = new THREE.MeshBasicMaterial({
    color: 0x2fbfd4,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (const river of rivers || []) {
    const mesh = ribbonMesh(river.coords, HALF_M[river.kind] || 10, material);
    if (!mesh) continue;
    mesh.name = river.name || river.kind || "river";
    mesh.renderOrder = 6;
    group.add(mesh);
  }
  let drawn = 0;
  for (const ring of polygons || []) {
    if (drawn >= 40) break;
    const mesh = polygonMesh(ring, material);
    if (!mesh) continue;
    mesh.renderOrder = 5;
    group.add(mesh);
    drawn += 1;
  }
  group.userData.material = material;
  return group;
}

function uniqueWays(list) {
  const seen = new Set();
  const out = [];
  const sorted = [...list].sort((a, b) => (b.coords?.length || 0) - (a.coords?.length || 0));
  for (const way of sorted) {
    if (seen.has(way.id)) continue;
    seen.add(way.id);
    out.push(way);
    if (out.length >= 8) break;
  }
  return out;
}

function toMeters(lon, lat, origin) {
  const mLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (lon - origin.lon) * mLon, y: (lat - origin.lat) * 110540 };
}

function crossingAngle(line, way) {
  let best = 0;
  let hit = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    for (let j = 0; j < way.length - 1; j += 1) {
      if (!segmentsCross(line[i], line[i + 1], way[j], way[j + 1])) continue;
      hit = true;
      best = Math.max(best, segmentAngle(line[i], line[i + 1], way[j], way[j + 1]));
    }
  }
  return hit ? { angle: best } : null;
}

function segmentsCross(a, b, c, d) {
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function side(a, b, c) {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

function segmentAngle(a, b, c, d) {
  const v1x = b.lon - a.lon;
  const v1y = b.lat - a.lat;
  const v2x = d.lon - c.lon;
  const v2y = d.lat - c.lat;
  const n1 = Math.hypot(v1x, v1y) || 1;
  const n2 = Math.hypot(v2x, v2y) || 1;
  const cos = Math.min(1, Math.abs((v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function overlapFraction(line, way) {
  const origin = line[0];
  const step = Math.max(1, Math.floor(line.length / 80));
  let near = 0;
  let n = 0;
  for (let i = 0; i < line.length; i += step) {
    n += 1;
    if (distanceToWay(line[i], way, origin) < 55) near += 1;
  }
  return n ? near / n : 0;
}

function distanceToWay(point, way, origin) {
  const p = toMeters(point.lon, point.lat, origin);
  let best = Infinity;
  for (let i = 0; i < way.length - 1; i += 1) {
    const a = toMeters(way[i].lon, way[i].lat, origin);
    const b = toMeters(way[i + 1].lon, way[i + 1].lat, origin);
    best = Math.min(best, pointSegmentDistance(p, a, b));
  }
  return best;
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function ribbonMesh(coords, halfM, material) {
  const local = [];
  for (const p of coords) {
    try {
      local.push(lonLatToLocal(p.lon, p.lat));
    } catch {
      /* frame not ready */
    }
  }
  if (local.length < 2) return null;
  const positions = [];
  const indices = [];
  for (let i = 0; i < local.length; i += 1) {
    const prev = local[Math.max(0, i - 1)];
    const next = local[Math.min(local.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz * halfM;
    const pz = dx * halfM;
    const y = SURFACE_Y + 0.85;
    positions.push(local[i].x + px, y, local[i].z + pz, local[i].x - px, y, local[i].z - pz);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function polygonMesh(ring, material) {
  const local = [];
  for (const p of ring || []) {
    try {
      local.push(lonLatToLocal(p.lon, p.lat));
    } catch {
      /* skip */
    }
  }
  if (local.length < 4) return null;
  const shape = new THREE.Shape();
  shape.moveTo(local[0].x, -local[0].z);
  for (let i = 1; i < local.length; i += 1) shape.lineTo(local[i].x, -local[i].z);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, SURFACE_Y + 0.7, 0);
  return new THREE.Mesh(geo, material);
}
