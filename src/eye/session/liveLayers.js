/**
 * Turns JalNetra JSON + downloaded KMLs into the same hydrology layer defs RIVEREYE drapes.
 */

import { getRiverSession } from "./riverSession.js";
import {
  collectKmlRefs,
  downloadText,
  fetchEndpointNow,
  kmlDownloadUrl,
} from "./jalnetraClient.js";

const defs = new Map();
const inflight = new Map();

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SOURCE = {
  salinity: { endpoint: "salinity", mode: "overlay" },
  vegetation_extent: { endpoint: "vegetation-type", mode: "overlay" },
  vegetation_health: { endpoint: "vegetation-health", mode: "overlay" },
  bank_erosion: { endpoint: "bank-erosion", mode: "overlay" },
  geology: { endpoint: "lithology", mode: "overlay" },
  water_depth: { endpoint: "water-depth", mode: "overlay" },
  water_quality_tss: { endpoint: "water-quality", mode: "named", match: /tss|turbid/i },
  water_quality_ndci: { endpoint: "water-quality", mode: "named", match: /ndci|chloro/i },
  water_quality_ndwi: { endpoint: "water-quality", mode: "named", match: /ndwi/i },
  water_quality_wst: { endpoint: "water-quality", mode: "named", match: /wst|temp/i },
  landuse_lulc: { endpoint: "lulc", mode: "years" },
  // Separate JalNetra APIs — date-wise monthly overlays for the uploaded river KML.
  silt_classification: {
    endpoint: "silt-classification",
    mode: "months",
    fallbackEndpoints: ["silt"],
  },
  silt_volume_surface: {
    endpoint: "silt-volume",
    mode: "months",
  },
};

const WQ_ORDER = ["water_quality_wst", "water_quality_tss", "water_quality_ndwi", "water_quality_ndci"];

const LAYER_TITLES = {
  salinity: "Salinity",
  vegetation_extent: "Vegetation Type",
  vegetation_health: "Vegetation Health",
  bank_erosion: "Bank Erosion",
  geology: "Spectral Lithology",
  water_depth: "Water Depth",
  water_quality_tss: "TSS",
  water_quality_ndci: "Chlorophyll-a",
  water_quality_ndwi: "NDWI",
  water_quality_wst: "Water Temperature",
  landuse_lulc: "Land Use",
  silt_classification: "Silt Classification",
  silt_volume_surface: "Silt Verification",
};

export function clearLiveOverlay(id) {
  if (id) defs.delete(id);
  else defs.clear();
}

export function liveLayerDef(id) {
  return defs.get(id) || null;
}

function classesFrom(categories) {
  const rows = Array.isArray(categories) ? categories : [];
  return rows
    .map((c) => ({
      id: String(c.id ?? c.name ?? c.label ?? ""),
      label: c.name || c.label || c.class_name || c.category || c.title || "Class",
      color: c.color || "#94a3b8",
      pct: c.percent != null ? `${Number(c.percent).toFixed(1)}%` : c.area_ha != null ? `${Number(c.area_ha).toFixed(1)} ha` : null,
      range: c.range || c.status || null,
    }))
    .filter((c) => c.label);
}

export function parseOverlayKml(kmlText, baseUrl) {
  const box = {};
  for (const key of ["north", "south", "east", "west"]) {
    const m = String(kmlText).match(new RegExp(`<(?:\\w+:)?${key}>\\s*([\\d.+-eE]+)\\s*<\\/(?:\\w+:)?${key}>`, "i"));
    if (m) box[key] = Number(m[1]);
  }
  const hasBox = [box.north, box.south, box.east, box.west].every((n) => Number.isFinite(n));
  const hrefM = String(kmlText).match(/<(?:\w+:)?href>\s*([^<]+?)\s*<\/(?:\w+:)?href>/i);
  let href = (hrefM?.[1] || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
  if (/^data:/i.test(href)) href = href.replace(/\s+/g, "");
  if (href && !/^data:image\//i.test(href) && !/^https?:/i.test(href) && baseUrl) {
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      href = "";
    }
  }
  const image = /^data:image\//i.test(href) || /^https?:/i.test(href) ? href : "";
  return {
    ground: hasBox && !!image,
    bounds: hasBox ? box : null,
    image,
    polygons: /<(?:\w+:)?Polygon[\s>]/i.test(kmlText),
  };
}

function geoJsonToKml(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const polys = [];
  const walk = (node, props = {}) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "FeatureCollection") {
      for (const feature of node.features || []) walk(feature);
      return;
    }
    if (node.type === "Feature") {
      walk(node.geometry, node.properties || {});
      return;
    }
    if (node.type === "GeometryCollection") {
      for (const child of node.geometries || []) walk(child, props);
      return;
    }
    const label = props.class_label || props.class || props.name || props.category || "Class";
    const hex = String(props.color || "94a3b8").replace("#", "").padStart(6, "0").slice(0, 6);
    const color = `ff${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
    const pushRing = (ring) => {
      if (!ring || ring.length < 4) return;
      const coords = ring
        .map((c) => `${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)},0`)
        .join(" ");
      polys.push({ label, color, coords });
    };
    if (node.type === "Polygon") pushRing(node.coordinates?.[0]);
    if (node.type === "MultiPolygon") {
      for (const poly of node.coordinates || []) pushRing(poly?.[0]);
    }
  };
  walk(data);
  if (!polys.length) return null;
  const placemarks = polys
    .map(
      (p) => `<Placemark><name>${p.label}</name><Style><PolyStyle><color>${p.color}</color></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>${p.coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;
}

function normalizeDownload(text) {
  const raw = String(text || "");
  if (!raw.trimStart().startsWith("{")) return raw;
  return geoJsonToKml(raw) || raw;
}

export const WATER_DEPTH_CLASSES = [
  { id: "shallow", label: "Shallow (<2.0 m)", range: "< 2.0 m", color: "#00A651", minDepth: 1.5, maxDepth: 2.0 },
  { id: "moderate", label: "Moderate (2.0–4.0 m)", range: "2.0–4.0 m", color: "#FFFF00", minDepth: 2.0, maxDepth: 4.0 },
  { id: "medium_deep", label: "Medium-Deep (4.0–6.0 m)", range: "4.0–6.0 m", color: "#FFA500", minDepth: 4.0, maxDepth: 6.0 },
  { id: "deep", label: "Deep (>6.0 m)", range: "> 6.0 m", color: "#FF0000", minDepth: 6.0, maxDepth: 8.0 },
];

async function kmlForRef(endpoint, ref) {
  if (ref?.inlineKml) {
    return { text: normalizeDownload(ref.inlineKml), href: null };
  }
  let href = kmlDownloadUrl(endpoint, ref.url || ref.id);
  let text = "";
  try {
    if (!href) throw new Error("No KML download link");
    text = normalizeDownload(await downloadText(href));
  } catch (err) {
    if (endpoint === "water-depth") {
      const fallbackUrl = "/data/mandovi/water_depth.kml";
      const localRes = await fetch(fallbackUrl);
      if (localRes.ok) {
        text = normalizeDownload(await localRes.text());
        href = fallbackUrl;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  return { text, href };
}

function overlayDef(id, title, parsed, categories) {
  const depthClasses = id === "water_depth" ? WATER_DEPTH_CLASSES : classesFrom(categories);
  if (parsed.ground) {
    return {
      id,
      name: title,
      available: true,
      type: "groundOverlay",
      bounds: parsed.bounds,
      overlay: parsed.image || (id === "water_depth" ? "/data/mandovi/water_depth_overlay.png" : ""),
      opacity: id.startsWith("vegetation") ? 0.72 : 0.9,
      gridSegments: 112,
      liftM: 0.55,
      flipV: true,
      legendTitle: id === "water_depth" ? "Water Depth (Sentinel-2)" : title,
      legendSubtitle: id === "water_depth" ? "Satellite Bathymetry · 1.5–8.0 m" : "JalNetra",
      legendClasses: depthClasses,
      classes: depthClasses,
    };
  }
  if (parsed.polygons) {
    const blob = URL.createObjectURL(new Blob([parsed.text], { type: "application/vnd.google-earth.kml+xml" }));
    return {
      id,
      name: title,
      available: true,
      type: "kmlPolygons",
      data: blob,
      opacity: 0.82,
      liftM: 0.45,
      legendTitle: id === "water_depth" ? "Water Depth (Sentinel-2)" : title,
      legendSubtitle: id === "water_depth" ? "Satellite Bathymetry · 1.5–8.0 m" : "JalNetra",
      classes: depthClasses,
      legendClasses: depthClasses,
    };
  }
  return null;
}

function pickNamed(refs, source) {
  const hit = refs.find((r) => source.match.test(`${r.path} ${r.name}`));
  if (hit) return hit;
    const idx = WQ_ORDER.indexOf(Object.keys(SOURCE).find((key) => SOURCE[key] === source) || "");
    return (idx >= 0 && refs[idx]) || refs[0];
}

function yearOf(ref, index) {
  const y = Number(ref.year || String(ref.date || ref.name || "").match(/20\d{2}/)?.[0]);
  return Number.isFinite(y) ? y : 2021 + index;
}

function monthOf(ref, index) {
  const yDirect = Number(ref?.year);
  const mDirect = Number(ref?.month);
  if (Number.isFinite(yDirect) && Number.isFinite(mDirect) && mDirect >= 1 && mDirect <= 12) {
    return {
      year: yDirect,
      month: mDirect,
      id: `${yDirect}-${String(mDirect).padStart(2, "0")}`,
    };
  }
  const raw = String(ref.date || ref.name || ref.path || "");
  const ym = raw.match(/(20\d{2})[-_/](\d{1,2})/);
  if (ym) {
    return {
      year: Number(ym[1]),
      month: Number(ym[2]),
      id: `${ym[1]}-${String(Number(ym[2])).padStart(2, "0")}`,
    };
  }
  const id = raw.match(/20\d{2}-\d{2}/)?.[0];
  if (id) return { year: Number(id.slice(0, 4)), month: Number(id.slice(5)), id };
  return { year: 2026, month: index + 1, id: `p${index + 1}` };
}

async function resolveEndpointBody(source, session) {
  const endpoints = [source.endpoint, ...(source.fallbackEndpoints || [])].filter(Boolean);
  const siltMonths = source.mode === "months";

  for (const ep of endpoints) {
    if (session.results?.[ep]) return { body: session.results[ep], endpoint: ep };
  }

  // Silt: never block the map for minutes. Prefer live results; otherwise fall through
  // to an immediate river-AOI preview while JalNetra keeps running in the background.
  if (siltMonths) {
    const pending = endpoints.some((ep) => session.pending?.[ep]);
    if (!pending && session.kmlText && source.endpoint) {
      try {
        const body = await fetchEndpointNow(source.endpoint);
        if (body) return { body, endpoint: source.endpoint };
      } catch (err) {
        session.errors[source.endpoint] = err?.message || String(err);
      }
    }
    for (const ep of endpoints) {
      if (session.errors?.[ep]) return { body: null, endpoint: ep, error: session.errors[ep] };
    }
    return { body: null, endpoint: source.endpoint };
  }

  for (const ep of endpoints) {
    if (session.pending?.[ep]) {
      const until = Date.now() + 240000;
      while (session.pending[ep] && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    if (session.results?.[ep]) return { body: session.results[ep], endpoint: ep };
  }

  if (session.kmlText && source.endpoint) {
    try {
      const body = await fetchEndpointNow(source.endpoint);
      if (body) return { body, endpoint: source.endpoint };
    } catch (err) {
      session.errors[source.endpoint] = err?.message || String(err);
    }
  }

  for (const ep of endpoints) {
    if (session.errors?.[ep]) return { body: null, endpoint: ep, error: session.errors[ep] };
  }
  return { body: null, endpoint: source.endpoint };
}

function bboxFromKml(text) {
  const nums = [...String(text || "").matchAll(/([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ lon: Number(m[1]), lat: Number(m[2]) }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90);
  if (nums.length < 3) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of nums) {
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  const padLon = Math.max(0.003, (east - west) * 0.03);
  const padLat = Math.max(0.003, (north - south) * 0.03);
  return { west: west - padLon, east: east + padLon, south: south - padLat, north: north + padLat };
}

const OFFLINE_SILT_CLASS = [
  { id: "low", label: "Low", color: "#2ECC71" },
  { id: "moderate", label: "Moderate", color: "#A8E010" },
  { id: "high", label: "High", color: "#F39C12" },
  { id: "very_high", label: "Very High", color: "#E74C3C" },
];
const OFFLINE_SILT_VOLUME = [
  { id: "v0", label: "0 m³", color: "#FFFFD4", value: 0, unit: "m³" },
  { id: "v25", label: "~24 m³", color: "#FED98E", value: 23.6, unit: "m³" },
  { id: "v50", label: "~47 m³", color: "#FE9929", value: 47.2, unit: "m³" },
  { id: "v75", label: "~71 m³", color: "#D95F0E", value: 70.7, unit: "m³" },
  { id: "v100", label: "94.3 m³", color: "#993404", value: 94.31, unit: "m³" },
];

function hexRgb(hex) {
  const h = String(hex || "").replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function paintOfflineSiltOverlay(volume, seed) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const colors = (volume
    ? ["#FFFFD4", "#FED98E", "#FE9929", "#D95F0E", "#993404"]
    : ["#2ECC71", "#A8E010", "#F39C12", "#E74C3C"]
  ).map(hexRgb);
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const bank = Math.abs(v - 0.5) * 2;
    const mask = Math.exp(-(((v - 0.5) / 0.28) ** 2));
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const wave = 0.5 + 0.5 * Math.sin((u * 6 + seed) * Math.PI);
      const score = Math.min(1, Math.max(0, bank * 0.55 + wave * 0.35 + (seed % 7) * 0.01));
      const idx = Math.min(colors.length - 1, Math.floor(score * colors.length));
      const c = colors[idx];
      const i = (y * w + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = Math.round(mask * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/** River-local silt periods so Land Use still drapes while JalNetra is slow/down. */
function buildOfflineSiltDef(id, session) {
  if (typeof document === "undefined") return null;
  const bounds = bboxFromKml(session?.kmlText);
  if (!bounds) return null;
  const volume = id === "silt_volume_surface";
  const now = new Date();
  const periods = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const pid = `${year}-${String(month).padStart(2, "0")}`;
    periods.push({
      id: pid,
      label: `${MONTH_SHORT[month - 1]} ${year}`,
      year,
      month,
      overlay: paintOfflineSiltOverlay(volume, month + year),
      bounds: { ...bounds },
    });
  }
  const latest = periods[periods.length - 1];
  const classes = volume ? OFFLINE_SILT_VOLUME : OFFLINE_SILT_CLASS;
  return {
    id,
    name: volume ? "SILT VERIFICATION" : "SILT CLASSIFICATION",
    available: true,
    type: volume ? "siltVolumePeriods" : "siltClassificationPeriods",
    periods,
    defaultPeriod: latest.id,
    bounds: latest.bounds,
    opacity: 0.88,
    liftM: 1.2,
    gridSegments: 112,
    legendTitle: volume ? "Silt Verification" : "Silt Classification",
    legendSubtitle: "River AOI preview · refreshing when JalNetra returns",
    classes,
    legendClasses: classes,
    offlinePreview: true,
  };
}

async function build(id) {
  const source = SOURCE[id];
  const session = getRiverSession();
  if (!source) return null;

  let resolved = await resolveEndpointBody(source, session);
  let body = resolved.body;
  let activeEndpoint = resolved.endpoint || source.endpoint;

  if (!body && (id === "water_depth" || source.endpoint === "water-depth")) {
    try {
      const res = await fetch("/data/mandovi/water_depth.json");
      if (res.ok) {
        body = await res.json();
        session.results["water-depth"] = body;
        activeEndpoint = "water-depth";
      }
    } catch {}
  }
  if (!body) {
    const err = resolved.error || session.errors?.[source.endpoint];
    if (err) session.errors[id] = err;
    if (source.mode === "months" && session.kmlText) {
      const offline = buildOfflineSiltDef(id, session);
      if (offline) return offline;
    }
    return null;
  }
  const refs = collectKmlRefs(body);
  if (!refs.length) {
    if (source.mode === "months" && session.kmlText) {
      const offline = buildOfflineSiltDef(id, session);
      if (offline) return offline;
    }
    return null;
  }

  if (source.mode === "years") {
    const years = [];
    for (let i = 0; i < refs.length; i++) {
      let loaded;
      try {
        loaded = await kmlForRef(activeEndpoint, refs[i]);
      } catch {
        continue;
      }
      const text = loaded.text;
      const parsed = { ...parseOverlayKml(text, loaded.href), text };
      const year = yearOf(refs[i], i);
      if (parsed.ground) {
        years.push({ year, type: "groundOverlay", overlay: parsed.image, bounds: parsed.bounds });
      } else if (parsed.polygons) {
        years.push({
          year,
          type: "kmlPolygons",
          data: URL.createObjectURL(new Blob([text], { type: "application/vnd.google-earth.kml+xml" })),
        });
      }
    }
    years.sort((a, b) => a.year - b.year);
    if (!years.length) return null;
    const classes = classesFrom(body.categories || body.legend || refs[0].categories);
    return {
      id,
      name: "LULC",
      available: true,
      type: "lulcYears",
      years,
      defaultYear: years[years.length - 1].year,
      opacity: 0.82,
      liftM: 0.45,
      gridSegments: 112,
      legendTitle: "LULC",
      legendSubtitle: "JalNetra",
      legendClasses: classes,
      classes,
    };
  }

  if (source.mode === "months") {
    const periods = [];
    for (let i = 0; i < refs.length; i++) {
      const meta = monthOf(refs[i], i);
      let loaded;
      try {
        loaded = await kmlForRef(activeEndpoint, refs[i]);
      } catch {
        continue;
      }
      const parsed = parseOverlayKml(loaded.text, loaded.href);
      // Prefer ground overlays; fall back to polygon KML months when needed.
      if (parsed.ground) {
        periods.push({
          id: meta.id,
          label: Number.isFinite(meta.month)
            ? `${MONTH_SHORT[meta.month - 1] || meta.id} ${meta.year || ""}`.trim()
            : meta.id,
          year: meta.year,
          month: meta.month,
          overlay: parsed.image,
          bounds: parsed.bounds,
        });
        continue;
      }
      if (parsed.polygons || /<(?:\w+:)?Polygon[\s>]/i.test(loaded.text)) {
        periods.push({
          id: meta.id,
          label: Number.isFinite(meta.month)
            ? `${MONTH_SHORT[meta.month - 1] || meta.id} ${meta.year || ""}`.trim()
            : meta.id,
          year: meta.year,
          month: meta.month,
          type: "kmlPolygons",
          data: URL.createObjectURL(
            new Blob([loaded.text], { type: "application/vnd.google-earth.kml+xml" }),
          ),
          bounds: parsed.bounds || null,
        });
      }
    }
    periods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!periods.length) return null;
    const latest = periods[periods.length - 1];
    const classes = classesFrom(body.categories || body.classes || refs[0].categories);
    const volume = id === "silt_volume_surface";
    return {
      id,
      name: volume ? "SILT VERIFICATION" : "SILT CLASSIFICATION",
      available: true,
      type: volume ? "siltVolumePeriods" : "siltClassificationPeriods",
      periods,
      defaultPeriod: latest.id,
      bounds: latest.bounds || null,
      opacity: 0.9,
      liftM: 1.2,
      gridSegments: 112,
      legendTitle: volume ? "Silt Verification" : "Silt Classification",
      legendSubtitle: "JalNetra · date-wise for this river",
      classes,
      legendClasses: classes,
      sourceEndpoint: activeEndpoint,
    };
  }

  const ref = source.mode === "named" ? pickNamed(refs, source) : refs[0];
  if (!ref) return null;
  const loaded = await kmlForRef(activeEndpoint, ref);
  const text = loaded.text;
  const parsed = { ...parseOverlayKml(text, loaded.href), text };
  const title = LAYER_TITLES[id] || (ref.name && ref.name !== ref.path ? ref.name : id.replace(/_/g, " "));
  return overlayDef(id, title, parsed, ref.categories || body.categories || body.legend || body.classes);
}

export async function ensureLiveOverlay(id) {
  if (defs.has(id)) return defs.get(id);
  if (!SOURCE[id]) return null;
  if (inflight.has(id)) return inflight.get(id);
  const job = build(id)
    .then((def) => {
      if (def) defs.set(id, def);
      return def;
    })
    .catch((err) => {
      const session = getRiverSession();
      session.errors[id] = err?.message || String(err);
      console.warn(`[jalnetra] ${id}`, err);
      return null;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/** Drop cached silt defs when a fresh JalNetra response arrives, then prefetch overlays. */
if (typeof window !== "undefined") {
  window.addEventListener("planeteye-endpoint", (e) => {
    const ep = String(e.detail?.id || "");
    const ok = e.detail?.ok === true;
    if (ep === "silt-classification" || ep === "silt") {
      clearLiveOverlay("silt_classification");
      if (ok) void ensureLiveOverlay("silt_classification");
    }
    if (ep === "silt-volume") {
      clearLiveOverlay("silt_volume_surface");
      if (ok) void ensureLiveOverlay("silt_volume_surface");
    }
  });
}
