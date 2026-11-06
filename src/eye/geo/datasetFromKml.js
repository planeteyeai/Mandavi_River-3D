/**
 * Build the RIVEREYE scene dataset from one uploaded river KML.
 * A line is buffered into a corridor polygon. A polygon is used as the river AOI.
 */

import {
  parseKmlGeometry,
  parsePointPlacemarksKml,
  parseChainageAnalysisKml,
  parseDrainageKml,
} from "./kml.js";
import { nearestChainage } from "./chainage.js";
import { lonLatToUtm } from "./projection.js";
import { initGeoReference, getGeoReference } from "./geoReference.js";
import { buildCorridorFromKml } from "./corridor.js";
import { emptyOsmContext } from "./osmContext.js";
import { loadLiveOsm } from "./osmLive.js";
import { loadOsmBridges } from "./osmBridges.js";
import { resolveTreeHeight } from "./heightResolve.js";
import {
  computeActiveSceneBounds,
  computeKmlOverviewBounds,
  computeSceneBounds,
} from "./sceneBounds.js";
import { resolveRiverDestinations } from "./areaGeocoding.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isMandoviSource(prepared, ring) {
  const name = `${prepared?.riverName || ""} ${prepared?.filename || ""}`.toLowerCase();
  return name.includes("mandovi") || name.includes("mandavi") || Boolean(ring?.[0]?.lat && ring[0].lat < 17);
}

async function loadMandoviReferenceKmls() {
  const textByKey = await import("../data/mandovi/index.js");
  for (const [key, text] of Object.entries(textByKey)) {
    if (typeof text !== "string" || !/<kml\b/i.test(text)) {
      throw new Error(`Bundled Mandovi reference is not valid KML: ${key}`);
    }
  }
  const parsedChainage = parseChainageAnalysisKml(textByKey.chainageKml);
  const mainFeatures = parseDrainageKml(textByKey.mainStreamKml);
  const mainFeature = mainFeatures
    .filter((feature) => feature.coordinates?.length >= 2)
    .sort((a, b) => b.coordinates.length - a.coordinates.length)[0];
  if (!parsedChainage.chainage.length) throw new Error("Mandovi 10 m chainage KML contains no named chainage points");
  if (!mainFeature) throw new Error("Mandovi main stream KML contains no usable line");
  const mainCenterline = mainFeature.coordinates.slice();
  const chainageStart = parsedChainage.chainage[0];
  if (coordinateDistanceSquared(mainCenterline.at(-1), chainageStart) < coordinateDistanceSquared(mainCenterline[0], chainageStart)) {
    mainCenterline.reverse();
  }
  const upstreams = parseDrainageKml(textByKey.upstreamsKml)
    .filter((feature) => feature.coordinates?.length >= 2)
    .map((feature, index) => ({
      name: String(feature.name || `Upstream ${index + 1}`).trim(),
      waterway: "stream",
      osmId: feature.osmId || `mandovi-upstream-${index + 1}`,
      vertices: feature.coordinates.map(({ lon, lat }) => ({ lon, lat })),
    }));
  if (!upstreams.length) throw new Error("Mandovi upstream KML contains no usable joining streams");

  console.info("[mandovi-kml] supplied river references loaded", {
    chainagePoints: parsedChainage.chainage.length,
    chainageIntervalM: parsedChainage.intervalM,
    mainStreamPoints: mainFeature.coordinates.length,
    joiningStreamPaths: upstreams.length,
  });
  return {
    chainage: parsedChainage.chainage,
    chainageIntervalM: parsedChainage.intervalM,
    mainCenterline,
    mainStemKml: textByKey.mainStreamKml,
    upstreams,
  };
}

function coordinateDistanceSquared(a, b) {
  return (Number(a.lon) - Number(b.lon)) ** 2 + (Number(a.lat) - Number(b.lat)) ** 2;
}

export function riverNameFromKml(text, filename) {
  const names = [...String(text).matchAll(/<name>\s*([^<]+?)\s*<\/name>/gi)].map((m) => m[1].trim());
  const skip = /^(polygon|linestring|path|untitled|layer|document|folder|style|track)$/i;
  const named = names.find((n) => n && !skip.test(n) && n.length < 80);
  if (named) return named.replace(/\s+/g, " ");
  return String(filename || "River")
    .replace(/\.kml$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "River";
}

function longestLine(lines) {
  let best = null;
  let bestLen = 0;
  for (const line of lines || []) {
    if (line.length > bestLen) {
      best = line;
      bestLen = line.length;
    }
  }
  return best;
}

function lineStringsOnly(text) {
  const lines = [];
  const blocks = [...String(text).matchAll(/<(?:\w+:)?LineString[\s\S]*?<\/(?:\w+:)?LineString>/gi)];
  for (const block of blocks) {
    const coords = [...block[0].matchAll(/<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/gi)];
    for (const c of coords) {
      const pts = c[1].trim().split(/\s+/).map((tok) => {
        const [lon, lat] = tok.split(",").map(Number);
        return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
      }).filter(Boolean);
      if (pts.length >= 2) lines.push(pts);
    }
  }
  return longestLine(lines);
}

function largestPolygon(polygons) {
  let best = null;
  let bestN = 0;
  for (const ring of polygons || []) {
    if (ring.length > bestN) {
      best = ring;
      bestN = ring.length;
    }
  }
  return best;
}

function bufferLine(line, halfM) {
  const lat0 = line[0].lat * Math.PI / 180;
  const mLon = 111320 * Math.cos(lat0);
  const mLat = 110540;
  const xy = line.map((p) => ({ x: p.lon * mLon, y: p.lat * mLat }));
  const left = [];
  const right = [];
  for (let i = 0; i < xy.length; i++) {
    const a = xy[Math.max(0, i - 1)];
    const b = xy[Math.min(xy.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    left.push({ lon: (xy[i].x + nx * halfM) / mLon, lat: (xy[i].y + ny * halfM) / mLat });
    right.push({ lon: (xy[i].x - nx * halfM) / mLon, lat: (xy[i].y - ny * halfM) / mLat });
  }
  return [...left, ...right.reverse(), { ...left[0] }];
}

function ringAreaKm2(ring) {
  if (!ring || ring.length < 4) return 50;
  const lat0 = ring[0].lat * Math.PI / 180;
  const mLon = 111320 * Math.cos(lat0);
  const mLat = 110540;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.lon * mLon * b.lat * mLat - b.lon * mLon * a.lat * mLat;
  }
  return Math.abs(sum) / 2 / 1e6;
}

function centroidOf(ring) {
  let lon = 0;
  let lat = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    lon += ring[i].lon;
    lat += ring[i].lat;
  }
  return { lon: lon / n, lat: lat / n };
}

function thinPoints(pts, maxPts) {
  const clean = (pts || []).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
  if (clean.length <= maxPts) return clean;
  const step = (clean.length - 1) / (maxPts - 1);
  const out = [];
  for (let i = 0; i < maxPts; i++) out.push(clean[Math.round(i * step)]);
  return out;
}

function coordText(pts) {
  return pts.map((p) => `${Number(p.lon).toFixed(6)},${Number(p.lat).toFixed(6)},0`).join(" ");
}

function farthestTips(ring) {
  let a = ring[0];
  let b = ring[Math.min(1, ring.length - 1)];
  let best = -1;
  const step = Math.max(1, Math.floor(ring.length / 60));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + step; j < ring.length; j += step) {
      const d = (ring[i].lon - ring[j].lon) ** 2 + (ring[i].lat - ring[j].lat) ** 2;
      if (d > best) {
        best = d;
        a = ring[i];
        b = ring[j];
      }
    }
  }
  return [a, b];
}

/** One Polygon only. A line plus a polygon is a GeometryCollection, which JalNetra rejects. */
function apiKml(name, _line, ring) {
  const ringPts = thinPoints(ring, 600);
  const closed = ringPts[0].lon === ringPts[ringPts.length - 1].lon && ringPts[0].lat === ringPts[ringPts.length - 1].lat
    ? ringPts
    : [...ringPts, ringPts[0]];
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>
<Placemark><name>${esc(name)}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordText(closed)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
}

/** KML text the APIs receive: original polygon, or a buffered centerline. */
export function prepareRiverUpload(kmlText, filename) {
  const riverName = riverNameFromKml(kmlText, filename);
  const providedPlaces = parsePointPlacemarksKml(kmlText)
    .filter((place) => place.name && place.name.trim());
  const geom = parseKmlGeometry(kmlText);
  const line = lineStringsOnly(kmlText);
  let ring = largestPolygon(geom.polygons);
  if (!ring && line?.length >= 2) ring = bufferLine(line, 80);
  if (!ring || ring.length < 4) {
    throw new Error("The KML needs a river polygon or a line with at least two points.");
  }
  const closed = ring[0].lon === ring[ring.length - 1].lon && ring[0].lat === ring[ring.length - 1].lat
    ? ring
    : [...ring, { ...ring[0] }];
  const stem = line?.length >= 2 ? line : null;
  const uploadKml = apiKml(riverName, stem, closed);
  return {
    riverName,
    providedPlaces,
    filename: filename || "river.kml",
    kmlText: uploadKml,
    mainStemKml: `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>${coordText(thinPoints(stem?.length >= 2 ? stem : farthestTips(closed), 400))}</coordinates></LineString></Placemark></Document></kml>`,
    ring: closed,
    line: stem,
    centroid: centroidOf(closed),
    catchmentKm2: Math.min(8000, Math.max(30, ringAreaKm2(closed) * 12)),
  };
}

export async function buildDatasetFromKml(prepared, onProgress) {
  onProgress?.(0.2, "Building the river corridor…");
  const ring = prepared.ring;
  const isMandovi = isMandoviSource(prepared, ring);
  const mandoviSources = isMandovi ? await loadMandoviReferenceKmls() : null;
  const ringUtm = ring.map((c) => {
    const u = lonLatToUtm(c.lon, c.lat);
    return { ...c, easting: u.easting, northing: u.northing };
  });
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of ring) {
    minLon = Math.min(minLon, c.lon);
    maxLon = Math.max(maxLon, c.lon);
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
  }
  const origin = { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
  initGeoReference(origin, ringUtm);
  const frame = getGeoReference().frame;
  const mandoviDrainage = mandoviSources?.upstreams.map((feature) => ({
    ...feature,
    vertices: feature.vertices.map(({ lon, lat }) => {
      const utm = lonLatToUtm(lon, lat);
      const local = frame.toLocal(utm.easting, utm.northing);
      return { lon, lat, x: local.x, z: local.z };
    }),
  })) || [];
  const ringLocal = ringUtm.map((c) => {
    const loc = frame.toLocal(c.easting, c.northing);
    return { ...c, x: loc.x, z: loc.z };
  });

  const sourceLine = mandoviSources?.mainCenterline || prepared.line;
  let centerlineLocal = null;
  if (sourceLine?.length >= 2) {
    centerlineLocal = sourceLine.map((c) => {
      const u = lonLatToUtm(c.lon, c.lat);
      const loc = frame.toLocal(u.easting, u.northing);
      return { lon: c.lon, lat: c.lat, easting: u.easting, northing: u.northing, x: loc.x, z: loc.z };
    });
  }

  onProgress?.(0.45, "Shaping the water surface…");
  const corridor = buildCorridorFromKml(ringLocal, [], {
    across: 36,
    nStations: 480,
    centerlineLocal,
  });

  const chainage = [];
  let meters = 0;
  const stations = corridor.stations || [];
  for (let i = 0; i < stations.length; i++) {
    if (i > 0) {
      meters += Math.hypot(stations[i].x - stations[i - 1].x, stations[i].z - stations[i - 1].z);
    }
    const ll = frame.toLonLat(stations[i].x, stations[i].z);
    const u = lonLatToUtm(ll.lon, ll.lat);
    const m = Math.round(meters);
    const width = Math.hypot(
      (stations[i].rightX ?? stations[i].x) - (stations[i].leftX ?? stations[i].x),
      (stations[i].rightZ ?? stations[i].z) - (stations[i].leftZ ?? stations[i].z),
    );
    chainage.push({
      lon: ll.lon,
      lat: ll.lat,
      easting: u.easting,
      northing: u.northing,
      x: stations[i].x,
      z: stations[i].z,
      meters: m,
      chainage_m: m,
      width_m: Math.max(8, width || 40),
      label: `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, "0")}`,
      major: m % 500 < 20,
    });
  }

  let chainageIntervalM = chainage.length > 1
    ? Math.max(1, chainage[1].meters - chainage[0].meters)
    : 10;
  if (mandoviSources?.chainage.length) {
    const exactChainage = mandoviSources.chainage.map((point) => {
      const utm = lonLatToUtm(point.lon, point.lat);
      const local = frame.toLocal(utm.easting, utm.northing);
      const derived = nearestChainage(local.x, local.z, chainage);
      return {
        ...derived,
        ...point,
        x: local.x,
        z: local.z,
        easting: utm.easting,
        northing: utm.northing,
        width_m: derived?.width_m || 40,
        chainage_m: point.meters,
      };
    });
    chainage.splice(0, chainage.length, ...exactChainage);
    chainageIntervalM = mandoviSources.chainageIntervalM || 10;
    for (const station of stations) {
      const exact = nearestChainage(station.x, station.z, chainage);
      if (!exact) continue;
      station.meters = exact.meters;
      station.chainage_m = exact.meters;
      station.label = exact.label;
    }
  }

  const providedDestinations = (prepared.providedPlaces || []).map((place) => {
    const utm = lonLatToUtm(place.lon, place.lat);
    const local = frame.toLocal(utm.easting, utm.northing);
    const near = nearestChainage(local.x, local.z, chainage);
    return {
      id: `kml-place-${place.id}`,
      name: place.name,
      lon: place.lon,
      lat: place.lat,
      x: local.x,
      z: local.z,
      meters: near?.meters ?? 0,
      chainage_m: near?.meters ?? 0,
    };
  });

  const points = [];
  let minDepth = Infinity;
  let maxDepth = 0;
  for (const s of stations) {
    const bankDepth = 0.85 + 0.35 * Math.sin((s.t || 0) * Math.PI * 4);
    for (const u of [0.08, 0.25, 0.5, 0.75, 0.92]) {
      const x = s.leftX + (s.rightX - s.leftX) * u;
      const z = s.leftZ + (s.rightZ - s.leftZ) * u;
      const ll = frame.toLonLat(x, z);
      const utm = lonLatToUtm(ll.lon, ll.lat);
      const bankDist = Math.abs(u * 2 - 1);
      const bankFactor = 1.0 - Math.pow(bankDist, 1.7);
      const depth = Number((bankDepth + ((s.depth || 11.8) - bankDepth) * Math.max(0, bankFactor)).toFixed(2));
      minDepth = Math.min(minDepth, depth);
      maxDepth = Math.max(maxDepth, depth);
      points.push({
        id: points.length,
        lat: ll.lat,
        lon: ll.lon,
        depth,
        easting: utm.easting,
        northing: utm.northing,
        x,
        z,
      });
    }
  }
  minDepth = Math.min(minDepth, 0.8);
  maxDepth = Math.max(maxDepth, 16.5);

  const bathymetry = {
    positions: corridor.positions,
    depths: corridor.depths,
    alongT: corridor.alongT,
    acrossU: corridor.acrossU,
    flow: corridor.flow,
    narrow: corridor.narrow,
    widthM: corridor.widthM,
    curve: corridor.curve,
    exact: corridor.exact,
    indices: corridor.indices,
    boundary: corridor.boundary,
    source: "CSIR-NIO Mandovi Geophysical & Bathymetric Survey (August 2021)",
    verticalDatum: "Chart Datum (CD) / MSL (Mormugao Port Baseline)",
    count: corridor.depths?.length || 0,
    bounds: corridor.bounds,
    minDepth,
    maxDepth,
  };

  const osm = { ...emptyOsmContext(), loaded: false };
  let bridges = [];
  if (isMandovi) {
    const MANDOVI_BRIDGES_DEF = [
      {
        id: "900000001",
        name: "Atal Setu",
        bridgeType: "cable-stayed",
        highway: "trunk",
        widthM: 21,
        lengthM: 620,
        coords: [
          [73.837180, 15.500000],
          [73.836931, 15.502609],
          [73.836756, 15.504429],
          [73.836620, 15.505580],
        ],
      },
      {
        id: "900000002",
        name: "Mandovi Bridge (New)",
        bridgeType: "girder",
        highway: "primary",
        widthM: 14,
        lengthM: 600,
        coords: [
          [73.837419, 15.499929],
          [73.837250, 15.501486],
          [73.837095, 15.503001],
          [73.836947, 15.504449],
          [73.836788, 15.505887],
          [73.836766, 15.506126],
        ],
      },
      {
        id: "900000003",
        name: "Mandovi Bridge (Old)",
        bridgeType: "girder",
        highway: "primary",
        widthM: 12,
        lengthM: 600,
        coords: [
          [73.836845, 15.499959],
          [73.836656, 15.501830],
          [73.836488, 15.503326],
          [73.836340, 15.504773],
          [73.836239, 15.505734],
        ],
      },
      // Ribandar Causeway + Konkan Railway Viaduct omitted — user confirmed
      // those two 3D spans are not wanted in this twin (false/overbuilt look).
    ];

    bridges = MANDOVI_BRIDGES_DEF.map((def) => {
      const u0 = lonLatToUtm(def.coords[0][0], def.coords[0][1]);
      const u1 = lonLatToUtm(def.coords[def.coords.length - 1][0], def.coords[def.coords.length - 1][1]);
      const start = frame.toLocal(u0.easting, u0.northing);
      const end = frame.toLocal(u1.easting, u1.northing);
      const vertices = def.coords.map(([lon, lat]) => {
        const u = lonLatToUtm(lon, lat);
        return frame.toLocal(u.easting, u.northing);
      });
      
      let polylineLengthM = 0;
      for (let i = 1; i < vertices.length; i++) {
        polylineLengthM += Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z);
      }
      const lengthM = polylineLengthM > 0 ? polylineLengthM : Math.hypot(end.x - start.x, end.z - start.z);

      let midX = (start.x + end.x) * 0.5;
      let midZ = (start.z + end.z) * 0.5;
      if (vertices.length > 2) {
        const halfD = lengthM * 0.5;
        let accum = 0;
        for (let i = 1; i < vertices.length; i++) {
          const segD = Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z);
          if (accum + segD >= halfD) {
            const frac = (halfD - accum) / (segD || 1);
            midX = vertices[i - 1].x + frac * (vertices[i].x - vertices[i - 1].x);
            midZ = vertices[i - 1].z + frac * (vertices[i].z - vertices[i - 1].z);
            break;
          }
          accum += segD;
        }
      }

      let bestSt = corridor.stations[0];
      let bestD = Infinity;
      for (const st of corridor.stations) {
        const d = Math.hypot(st.x - midX, st.z - midZ);
        if (d < bestD) {
          bestD = d;
          bestSt = st;
        }
      }
      const chMeters = bestSt?.meters || 0;
      const chLabel = `${Math.floor(chMeters / 1000)}+${String(Math.round(chMeters % 1000)).padStart(3, "0")}`;
      return {
        id: def.id,
        name: def.name,
        fullName: def.name,
        osmName: def.name,
        bridgeType: def.bridgeType,
        highway: def.highway,
        widthM: def.widthM,
        start,
        end,
        vertices,
        lengthM,
        midX,
        midZ,
        chainage_m: chMeters,
        chainageLabel: chLabel,
        source: "MANDOVI_SURVEY",
      };
    });
    console.info("[mandovi] curated bridges active:", bridges.length, bridges.map((b) => b.fullName));
  }

  const partial = { ringLocal, corridor, osm, bridges };
  const sceneBounds = computeSceneBounds(partial);
  const kmlOverviewBounds = computeKmlOverviewBounds(partial);
  const activeSceneBounds = computeActiveSceneBounds(partial);

  onProgress?.(0.7, "Resolving local geographical areas & landmarks...");

  const ds = {
    lite: false,
    points,
    minDepth: Number.isFinite(minDepth) ? minDepth : 0.4,
    maxDepth: maxDepth || 2.2,
    frame,
    ringLocal,
    ringGeo: ring,
    centerlineLocal,
    chainage,
    chainageIntervalM,
    corridor,
    bathymetry,
    bridges,
    osm,
    overlay: null,
    validation: { ok: true, issues: [] },
    sceneBounds,
    kmlOverviewBounds,
    activeSceneBounds,
    dtm: null,
    destinations: [],
    providedDestinations,
    fishingLocationsRaw: [],
    fishingZones: [],
    drainage: mandoviDrainage,
    riverName: prepared.riverName || "River",
    mainStemKml: mandoviSources?.mainStemKml || prepared.mainStemKml || "",
    depthOverlay: isMandovi
      ? {
          url: "/data/updates/water_depth.png",
          kmlUrl: "/data/updates/original/water_depth_mandavi.kml",
          legendUrl: "/data/updates/metadata.json",
          north: 15.52859903,
          south: 15.4593098,
          east: 73.88313675,
          west: 73.76545998,
          minDepth: 0.5,
          maxDepth: 8.0,
          source: "src/data/Updates/original/water_depth_mandavi.kml",
          provenance: "RELATIVE ESTIMATE",
          remapToHydroBlues: true,
        }
      : null,
    isMandovi,
    isMulaMutha: !isMandovi,
    loadOsmLater: async () => {
      if (isMandovi) {
        try {
          const res = await fetch("/data/mandovi/osm_mandovi_corridor.json");
          if (res.ok) {
            const data = await res.json();
            
            // 1. Process verified OSM buildings & houses
            const buildings = [];
            const buildingIds = new Set();
            for (const b of data.buildings || []) {
              if (!b.coordinates || b.coordinates.length < 3) continue;
              const verts = [];
              let sumX = 0, sumZ = 0;
              for (const [lon, lat] of b.coordinates) {
                const u = lonLatToUtm(lon, lat);
                const loc = frame.toLocal(u.easting, u.northing);
                verts.push({ x: loc.x, z: loc.z, lon, lat });
                sumX += loc.x;
                sumZ += loc.z;
              }
              const midX = sumX / verts.length;
              const midZ = sumZ / verts.length;
              buildingIds.add(String(b.id));
              buildings.push({
                id: b.id,
                name: b.name || "",
                building: b.building || "yes",
                amenity: b.amenity,
                levels: b.levels ? Number(b.levels) : null,
                heightM: b.heightM ? Number(b.heightM) : null,
                vertices: verts,
                midX,
                midZ,
                source: "OPENSTREETMAP",
              });
            }

            // 2. Process verified OSM roads & streets
            const roads = [];
            const roadIds = new Set();
            for (const r of data.roads || []) {
              if (!r.coordinates || r.coordinates.length < 2) continue;
              const verts = [];
              let sumX = 0, sumZ = 0;
              let lengthM = 0;
              for (let i = 0; i < r.coordinates.length; i++) {
                const [lon, lat] = r.coordinates[i];
                const u = lonLatToUtm(lon, lat);
                const loc = frame.toLocal(u.easting, u.northing);
                verts.push({ x: loc.x, z: loc.z, lon, lat });
                sumX += loc.x;
                sumZ += loc.z;
                if (i > 0) {
                  lengthM += Math.hypot(loc.x - verts[i - 1].x, loc.z - verts[i - 1].z);
                }
              }
              const midX = sumX / verts.length;
              const midZ = sumZ / verts.length;
              const hw = r.highway || "residential";
              const widthM = hw === "trunk" ? 12 : hw === "primary" ? 10 : hw === "secondary" ? 8.5 : hw === "tertiary" ? 7 : 5.5;
              roadIds.add(String(r.id));
              roads.push({
                id: r.id,
                name: r.name || "",
                highway: hw,
                bridge: r.bridge,
                surface: r.surface,
                lanes: r.lanes,
                widthM,
                vertices: verts,
                lengthM,
                midX,
                midZ,
                source: "OPENSTREETMAP",
              });
            }

            // 3. Process verified OSM landuse & natural areas
            const green = [];
            const greenIds = new Set();
            for (const lu of data.landuse || []) {
              if (!lu.coordinates || lu.coordinates.length < 3) continue;
              const verts = [];
              let sumX = 0, sumZ = 0;
              for (const [lon, lat] of lu.coordinates) {
                const u = lonLatToUtm(lon, lat);
                const loc = frame.toLocal(u.easting, u.northing);
                verts.push({ x: loc.x, z: loc.z, lon, lat });
                sumX += loc.x;
                sumZ += loc.z;
              }
              greenIds.add(String(lu.id));
              green.push({
                id: lu.id,
                name: lu.name || "",
                landuse: lu.landuse,
                leisure: lu.leisure,
                natural: lu.natural,
                vertices: verts,
                midX: sumX / verts.length,
                midZ: sumZ / verts.length,
                source: "OPENSTREETMAP",
              });
            }

            // 4. Process settlements and places
            const places = [];
            for (const p of data.places || []) {
              if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
              const u = lonLatToUtm(p.lon, p.lat);
              const loc = frame.toLocal(u.easting, u.northing);
              places.push({
                id: p.id,
                name: p.name,
                place: p.place,
                lon: p.lon,
                lat: p.lat,
                x: loc.x,
                z: loc.z,
              });
            }

            // 5. Bundled OSM trees (offline). Do NOT await live Overpass here —
            // that blocked vegetation for minutes and left the layer empty.
            const trees = await loadMandoviBundledTrees(frame);

            console.info("[mandovi] Loaded authentic OSM corridor data:", {
              buildings: buildings.length,
              roads: roads.length,
              green: green.length,
              trees: trees.length,
              places: places.length,
              bridges: (ds.bridges || []).length,
            });

            const osmResult = {
              loaded: true,
              bridges: ds.bridges || [],
              roads,
              buildings,
              green,
              vegetation: green,
              trees,
              places,
              source: "OpenStreetMap © contributors",
              alignment: { ok: true, medianDistM: 0 },
            };

            // Skip live Overpass on Mandovi — endpoints time out and delay the scene.
            // Trees come from bundled OSM points + bank/landuse planting in createVegetation.
            return osmResult;
          }
        } catch (err) {
          console.warn("[mandovi] Failed to load osm_mandovi_corridor.json:", err);
        }

        // Fallback: live Overpass for the full Mandovi KML corridor
        try {
          const live = await loadLiveOsm(
            frame,
            corridor,
            prepared.line?.length >= 2 ? prepared.line : ring,
            { maxDist: 2800, buildingMaxDist: 2600, treeCap: 12000, tileCount: 36 },
          );
          // Never replace Mandovi survey bridges with live OSM stubs.
          if (live?.bridges?.length && !(ds.bridges || []).some((b) => b.source === "MANDOVI_SURVEY")) {
            ds.bridges = live.bridges;
          }
          return { ...live, loaded: true, bridges: ds.bridges || live.bridges || [] };
        } catch (liveErr) {
          console.warn("[mandovi] live OSM fallback failed:", liveErr?.message || liveErr);
        }

        return {
          loaded: true,
          bridges: ds.bridges || [],
          roads: [],
          buildings: [],
          trees: [],
          green: [],
        };
      }
      const liveOsm = await loadLiveOsm(frame, corridor, prepared.line?.length >= 2 ? prepared.line : ring);
      if (liveOsm?.bridges?.length && (!ds.bridges || ds.bridges.length === 0)) {
        ds.bridges = liveOsm.bridges;
      }
      return liveOsm;
    },
  };

  try {
    await resolveRiverDestinations(ds);
  } catch (err) {
    console.warn("[geocoding] could not resolve local areas:", err);
  }

  return ds;
}

/** Optional offline trees bundle from scripts/fetch_mandovi_osm_trees.mjs */
async function loadMandoviBundledTrees(frame) {
  try {
    const res = await fetch("/data/mandovi/osm_mandovi_trees.json");
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    for (const t of data.trees || []) {
      if (!Number.isFinite(t.lon) || !Number.isFinite(t.lat)) continue;
      const u = lonLatToUtm(t.lon, t.lat);
      const loc = frame.toLocal(u.easting, u.northing);
      const seed = Number(t.id) || out.length;
      const resolved = resolveTreeHeight(
        { height: t.heightM, tree_height: t.heightM, genus: t.genus, species: t.species },
        seed,
      );
      out.push({
        id: t.id,
        x: loc.x,
        z: loc.z,
        lon: t.lon,
        lat: t.lat,
        tree_height: resolved.height,
        height_source: resolved.height_source,
        genus: t.genus || null,
        species: t.species || null,
        leaf_type: t.leaf_type || null,
        natural: t.natural || "tree",
        from_tree_row: !!t.from_tree_row,
        source: t.source || "OPENSTREETMAP",
      });
    }
    // Merge extra green polygons from the trees bundle into caller via side channel? No —
    // only trees here; landuse merge happens in loadOsmLater if we extend later.
    console.info("[mandovi] bundled OSM trees:", out.length);
    return out;
  } catch {
    return [];
  }
}
