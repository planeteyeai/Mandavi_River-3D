/**
 * Buildings, roads, and vegetation for an uploaded river.
 * OpenStreetMap via Overpass, clipped to the river corridor.
 */

import { assembleOsmContext, emptyOsmContext } from "./osmContext.js";
import { lonLatToLocal } from "./geoReference.js";

const ENDPOINTS = [
  "/osm-overpass",
  "/osm-overpass-2",
  "/osm-overpass-3",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const HIGHWAY_WIDTH = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 9,
  tertiary: 8,
  residential: 6.5,
  unclassified: 5.5,
  living_street: 5,
  service: 4,
  pedestrian: 4,
  footway: 2.5,
  path: 2.2,
  cycleway: 2.5,
  track: 4,
  road: 7,
};

/**
 * @param {object} frame
 * @param {object} corridor
 * @param {Array<{lon:number,lat:number}>} ringLonLat
 * @param {{ maxDist?: number, buildingMaxDist?: number, treeCap?: number, tileCount?: number }} [opts]
 */
export async function loadLiveOsm(frame, corridor, ringLonLat, opts = {}) {
  const empty = emptyOsmContext();
  const maxDist = Number(opts.maxDist) || 1400;
  const buildingMaxDist = Number(opts.buildingMaxDist) || 1100;
  const treeCap = Number(opts.treeCap) || 6000;
  const tiles = tilesAlong(ringLonLat, opts.tileCount || 24);
  if (!tiles.length) return { ...empty, loaded: true, bridges: [] };
  const elements = [];
  const seen = new Set();
  let failures = 0;
  const queue = tiles.slice();
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const tile = queue.shift();
      try {
        const batch = await queryOverpass(tile);
        for (const el of batch) {
          const key = `${el.type}:${el.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          elements.push(el);
        }
      } catch (err) {
        failures += 1;
        console.warn("[osm] tile failed", err?.message || err);
      }
    }
  });
  await Promise.all(workers);
  if (!elements.length && failures) {
    console.warn("[osm] live map data unavailable — using procedural corridor");
  }
  const roads = [];
  const buildings = [];
  const green = [];
  const trees = [];
  const placeNodes = [];
  const waterways = [];
  const waterPolygons = [];
  const bridges = [];

  for (const el of elements) {
    if (el.type === "node" && el.tags?.name && PLACE_RANK[el.tags.place] != null && Number.isFinite(el.lon)) {
      try {
        const loc = lonLatToLocal(el.lon, el.lat);
        placeNodes.push({ name: el.tags.name.trim(), place: el.tags.place, lon: el.lon, lat: el.lat, x: loc.x, z: loc.z });
      } catch {
        /* geo frame not ready */
      }
    }
    if (el.type === "node" && (el.tags?.natural === "tree" || el.tags?.natural === "shrub") && Number.isFinite(el.lon)) {
      trees.push(treeFeature(el));
      continue;
    }
    if (el.type !== "way" || !el.geometry?.length) continue;
    const coords = el.geometry.map((g) => [g.lon, g.lat]);
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    if (tags.waterway && /river|stream|canal|drain|tidal_channel/.test(tags.waterway)) {
      waterways.push({
        id: el.id,
        name: tags.name || tags.waterway,
        kind: tags.waterway,
        coords: coords.map(([lon, lat]) => ({ lon, lat })),
      });
    }
    if (tags.natural === "water" || tags.water === "river" || tags.waterway === "riverbank") {
      const ring = close(coords);
      if (ring.length >= 4) waterPolygons.push(ring.map(([lon, lat]) => ({ lon, lat })));
    }
    const bridgeWay = tags.bridge === "yes" || tags.bridge === "viaduct" || tags.bridge === "aqueduct" || tags.man_made === "bridge";
    const crossesRiver = bridgeWay || (tags.highway && highwayCrossesCorridor(coords, corridor));

    if (crossesRiver) {
      try {
        const pStart = lonLatToLocal(coords[0][0], coords[0][1]);
        const pEnd = lonLatToLocal(coords[coords.length - 1][0], coords[coords.length - 1][1]);
        const bName = tags.name || tags["bridge:name"] || tags["name:en"] || (tags.ref ? `${tags.ref} Bridge` : (tags.highway ? `${tags.highway.toUpperCase()} Bridge` : "River Bridge"));
        bridges.push({
          id: `osm_br_${el.id}`,
          name: bName,
          highway: tags.highway || "primary",
          widthM: HIGHWAY_WIDTH[tags.highway] || 14,
          start: pStart,
          end: pEnd,
          midX: (pStart.x + pEnd.x) * 0.5,
          midZ: (pStart.z + pEnd.z) * 0.5,
          lengthM: Math.hypot(pEnd.x - pStart.x, pEnd.z - pStart.z),
          source: "OpenStreetMap",
        });
      } catch {
        /* skip invalid projection */
      }
    }

    if (tags.building) {
      const ring = close(coords);
      if (ring.length >= 4) buildings.push(polygonFeature(el, ring));
    } else if ((tags.highway && (HIGHWAY_WIDTH[tags.highway] || bridgeWay)) || bridgeWay) {
      roads.push({
        type: "Feature",
        properties: {
          osmId: el.id,
          highway: tags.highway || (bridgeWay ? "road" : ""),
          name: tags.name,
          widthM: HIGHWAY_WIDTH[tags.highway] || (bridgeWay ? 8 : 5),
          bridge: tags.bridge || (tags.man_made === "bridge" ? "yes" : undefined),
          source: "OPENSTREETMAP",
        },
        geometry: { type: "LineString", coordinates: coords },
      });
    } else if (tags.natural === "tree_row") {
      for (const t of sampleTreeRowFeatures(el, coords, tags)) trees.push(t);
    } else if (isGreen(tags)) {
      const ring = close(coords);
      if (ring.length >= 4) green.push(polygonFeature(el, ring));
    }
  }

  const ctx = assembleOsmContext(frame, corridor, {
    roadsFc: fc(roads.slice(0, 8000)),
    buildingsFc: fc(buildings.slice(0, 12000)),
    vegFc: fc(green.slice(0, 3000)),
    treesFc: fc(trees.slice(0, treeCap)),
    maxDist,
    buildingMaxDist,
  });
  ctx.bridges = bridges;
  ctx.places = bankPlaces(placeNodes, corridor);
  ctx.waterways = waterways;
  ctx.waterPolygons = waterPolygons;
  console.info("[osm] corridor context", {
    buildings: ctx.buildings.length,
    roads: ctx.roads.length,
    green: ctx.green.length,
    trees: ctx.trees.length,
    places: ctx.places.length,
    bridges: ctx.bridges.length,
    waterways: waterways.length,
    water: waterPolygons.length,
  });
  return ctx;
}

const PLACE_RANK = { city: 0, town: 1, village: 2, suburb: 3, neighbourhood: 4, hamlet: 5, quarter: 6, locality: 7 };

function bankPlaces(raw, corridor) {
  const stations = corridor?.stations || [];
  if (!stations.length) return [];
  const scored = [];
  for (const p of raw) {
    let best = stations[0];
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 220));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (Math.sqrt(bestD) > 1600) continue;
    const lateral = (p.x - best.x) * -(best.flowZ || 0) + (p.z - best.z) * (best.flowX || 0);
    const side = lateral >= 0 ? 1 : -1;
    const px = -(best.flowZ || 0);
    const pz = best.flowX || 0;
    const out = Math.max((best.halfWidth || 30) + 70, Math.min(240, Math.abs(lateral) || 90));
    scored.push({
      name: p.name,
      rank: PLACE_RANK[p.place] ?? 9,
      side,
      bank: side >= 0 ? "Right Bank" : "Left Bank",
      along: best.along || 0,
      meters: best.chainage_m ?? best.along ?? 0,
      x: best.x + px * side * out,
      z: best.z + pz * side * out,
      lon: p.lon,
      lat: p.lat,
    });
  }
  scored.sort((a, b) => a.rank - b.rank || a.along - b.along);
  const kept = [];
  for (const p of scored) {
    if (kept.filter((k) => k.side === p.side).length >= 12) continue;
    if (kept.some((k) => k.name.toLowerCase() === p.name.toLowerCase() || Math.hypot(k.x - p.x, k.z - p.z) < 220)) continue;
    kept.push(p);
  }
  return kept;
}

function highwayCrossesCorridor(coords, corridor) {
  if (!corridor?.stations?.length || coords.length < 2) return false;
  const stations = corridor.stations;
  let p0, p1;
  try {
    p0 = lonLatToLocal(coords[0][0], coords[0][1]);
    p1 = lonLatToLocal(coords[coords.length - 1][0], coords[coords.length - 1][1]);
  } catch {
    return false;
  }
  const mx = (p0.x + p1.x) * 0.5;
  const mz = (p0.z + p1.z) * 0.5;
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 100));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d = (s.x - mx) ** 2 + (s.z - mz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (Math.sqrt(bestD) > (best.halfWidth || 40) + 900) return false;
  const lat0 = (p0.x - best.x) * -(best.flowZ || 0) + (p0.z - best.z) * (best.flowX || 0);
  const lat1 = (p1.x - best.x) * -(best.flowZ || 0) + (p1.z - best.z) * (best.flowX || 0);
  return (lat0 * lat1 < 0);
}

function fc(features) {
  return { type: "FeatureCollection", features };
}

function close(coords) {
  const ring = coords.slice();
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (!a || !b) return ring;
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function polygonFeature(el, ring) {
  const tags = el.tags || {};
  return {
    type: "Feature",
    properties: {
      osmId: el.id,
      name: tags.name,
      building: tags.building,
      height: tags.height,
      heightM: tags.height,
      levels: tags["building:levels"],
      "building:levels": tags["building:levels"],
      leisure: tags.leisure,
      landuse: tags.landuse,
      natural: tags.natural,
      source: "OPENSTREETMAP",
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function treeFeature(el) {
  return {
    type: "Feature",
    properties: {
      osmId: el.id,
      natural: el.tags?.natural || "tree",
      height: el.tags?.height,
      genus: el.tags?.genus,
      species: el.tags?.species,
      leaf_type: el.tags?.leaf_type,
      source: "OPENSTREETMAP",
    },
    geometry: { type: "Point", coordinates: [el.lon, el.lat] },
  };
}

/** Place individual trees along an OSM tree_row way. */
function sampleTreeRowFeatures(el, coords, tags, spacingM = 8) {
  if (!coords || coords.length < 2) return [];
  const out = [];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1];
    const [lon1, lat1] = coords[i];
    const dx = (lon1 - lon0) * 107270;
    const dy = (lat1 - lat0) * 110540;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    let t = (spacingM - carry) / len;
    while (t <= 1) {
      out.push({
        type: "Feature",
        properties: {
          osmId: `row_${el.id}_${out.length}`,
          natural: "tree",
          height: tags.height,
          genus: tags.genus,
          species: tags.species,
          leaf_type: tags.leaf_type,
          from_tree_row: true,
          source: "OPENSTREETMAP",
        },
        geometry: {
          type: "Point",
          coordinates: [lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t],
        },
      });
      t += spacingM / len;
    }
    carry = (carry + len) % spacingM;
  }
  return out;
}

function isGreen(tags) {
  if (tags.natural === "wood" || tags.natural === "scrub" || tags.natural === "wetland") return true;
  if (tags.leisure === "park" || tags.leisure === "garden") return true;
  return /forest|grass|meadow|orchard|recreation_ground|village_green/.test(tags.landuse || "");
}

/** Overlapping tiles along the whole river, so a long reach is not cropped to its middle. */
function tilesAlong(points, maxTiles = 24) {
  const clean = (points || []).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (!clean.length) return [];
  let span = 0;
  for (let i = 1; i < clean.length; i++) {
    span += Math.hypot(clean[i].lon - clean[i - 1].lon, clean[i].lat - clean[i - 1].lat);
  }
  const tileDeg = 0.02;
  const count = Math.min(Math.max(1, maxTiles), Math.max(1, Math.ceil(span / (tileDeg * 0.75))));
  const tiles = [];
  for (let n = 0; n < count; n++) {
    const idx = Math.round((n / Math.max(1, count - 1)) * (clean.length - 1));
    const p = clean[idx];
    const pad = tileDeg * 0.75;
    tiles.push({
      south: p.lat - pad,
      north: p.lat + pad,
      west: p.lon - pad,
      east: p.lon + pad,
    });
  }
  return tiles;
}

async function queryOverpass(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const mapQuery = `[out:json][timeout:40];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|footway|path|track|road|cycleway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${b});
  way["bridge"](${b});
  way["man_made"="bridge"](${b});
  way["building"](${b});
  way["waterway"~"^(river|stream|canal|drain|tidal_channel)$"](${b});
  way["natural"="water"](${b});
  way["waterway"="riverbank"](${b});
  way["natural"~"^(wood|scrub|wetland)$"](${b});
  way["landuse"~"^(forest|grass|meadow|orchard|recreation_ground|village_green)$"](${b});
  way["leisure"~"^(park|garden)$"](${b});
  node["natural"="tree"](${b});
  node["place"~"^(city|town|village|suburb|neighbourhood|hamlet|quarter|locality)$"]["name"](${b});
);
out geom;`;
  return runQuery(mapQuery);
}

async function runQuery(q) {
  let lastErr = null;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: q,
          signal: AbortSignal.timeout(22000),
        });
        if (res.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1800));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json.elements || [];
      } catch (err) {
        lastErr = err;
        break;
      }
    }
  }
  throw lastErr || new Error("Overpass unavailable");
}
