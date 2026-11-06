/**
 * Posts one river KML to every JalNetra endpoint.
 * Dates follow the OpenAPI contract. The end date is never today.
 *   range  flood-water — the month the user selected
 *   month  salinity, water-quality, vegetation — one full calendar month
 *   year   lithology — 1 January through the selected end date
 *   none   lulc (years 2021–2026 are fixed);
 *          silt-classification / silt-volume (monthly KMLs in the response)
 */

import { getRiverSession } from "./riverSession.js";

export const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

/** Fire these first on project start — no queue delay behind other layers. */
const SILT_PRIORITY_IDS = ["silt-classification", "silt-volume"];

const ENDPOINTS = [
  // Silt first so date-wise overlays are ready as soon as Land Use opens.
  { id: "silt-classification", path: "/api/silt-classification" },
  { id: "silt-volume", path: "/api/silt-volume" },
  { id: "flood-water", path: "/api/flood-water" },
  { id: "salinity", path: "/api/salinity" },
  { id: "water-quality", path: "/api/water-quality" },
  { id: "lithology", path: "/api/lithology" },
  { id: "vegetation-type", path: "/api/vegetation-type" },
  { id: "vegetation-health", path: "/api/vegetation-health" },
  { id: "bod-cod", path: "/api/bod-cod" },
  { id: "lulc", path: "/api/lulc" },
  { id: "bank-erosion", path: "/api/bank-erosion" },
  { id: "water-depth", path: "/api/water-depth" },
  { id: "fishing-point", path: "/api/fishing-point" },
  { id: "fabdem-dtm", path: "/api/fabdem-dtm" },
  { id: "copernicus-dsm", path: "/api/copernicus-dsm" },
];

/** Latest complete calendar month as YYYY-MM (current month excluded). */
export function latestCompleteMonthId(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Sorted unique YYYY-MM keys found in a silt API body. */
export function extractSiltDateIds(body) {
  const refs = collectKmlRefs(body);
  const ids = new Set();
  for (const ref of refs) {
    const y = Number(ref.year);
    const m = Number(ref.month);
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      ids.add(`${y}-${pad(m)}`);
      continue;
    }
    const raw = String(ref.date || ref.name || ref.path || "");
    const hit = raw.match(/(20\d{2})[-_/](\d{1,2})/);
    if (hit) ids.add(`${hit[1]}-${pad(Number(hit[2]))}`);
  }
  return [...ids].sort();
}

/**
 * Reuse cached silt when date list already covers the latest complete month
 * (same dates → skip API; only refetch when a newer month is missing).
 */
export function siltCacheIsFresh(endpointId) {
  const session = getRiverSession();
  const body = session?.results?.[endpointId];
  if (!body) return false;
  const stored = session.siltDateFingerprints?.[endpointId];
  const dates = stored ? String(stored).split("|").filter(Boolean) : extractSiltDateIds(body);
  if (!dates.length) return false;
  const latest = dates[dates.length - 1];
  const need = latestCompleteMonthId();
  return latest >= need;
}

export function rememberSiltDates(endpointId, body) {
  const session = getRiverSession();
  if (!session.siltDateFingerprints) session.siltDateFingerprints = {};
  const dates = extractSiltDateIds(body);
  if (dates.length) session.siltDateFingerprints[endpointId] = dates.join("|");
  return dates;
}

const TIMEOUT_MS = 300000;

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function yesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayYmd(d);
}

function clampEnd(ymd) {
  const end = String(ymd || "").slice(0, 10);
  const today = todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end >= today) return yesterdayYmd();
  return end;
}

/** Full calendar month. The current month is not complete, so the previous month is used. */
function monthWindow(endDate) {
  const end = clampEnd(endDate);
  const [yStr, mStr] = end.split("-");
  let year = Number(yStr);
  let month = Number(mStr);
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth() + 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  const last = new Date(year, month, 0).getDate();
  return { start_date: `${year}-${pad(month)}-01`, end_date: `${year}-${pad(month)}-${pad(last)}` };
}

/** 1 January through the selected end date. Never includes today. */
function yearWindow(endDate) {
  const end = clampEnd(endDate);
  return { start_date: `${end.slice(0, 4)}-01-01`, end_date: end };
}

function dateWindow(spec, session) {
  if (spec.when === "month") return monthWindow(session.end_date);
  if (spec.when === "year") return yearWindow(session.end_date);
  if (spec.when === "range") {
    return { start_date: session.start_date, end_date: clampEnd(session.end_date) };
  }
  return null;
}

function clipFlood(body, start, end) {
  if (!body || !Array.isArray(body.datewise)) return body;
  const today = todayYmd();
  const datewise = body.datewise.filter((scene) => {
    const d = String(scene.date || scene.post_date || scene.end_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
    return d >= start && d <= end && d < today;
  });
  return { ...body, datewise };
}

function shiftMonth(window, delta) {
  const [y, m] = window.start_date.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const last = new Date(year, month, 0).getDate();
  return { start_date: `${year}-${pad(month)}-01`, end_date: `${year}-${pad(month)}-${pad(last)}` };
}

/** Drop lines and points so the upload is a single polygon. JalNetra 404s GeometryCollection. */
export function polygonOnlyKml(text) {
  let src = String(text || "");
  if (!/<(?:\w+:)?(?:LineString|Point|MultiGeometry)\b/i.test(src)) return src;
  src = src.replace(/<Placemark\b[^>]*>[\s\S]*?<(?:\w+:)?LineString\b[\s\S]*?<\/(?:\w+:)?LineString>[\s\S]*?<\/Placemark>/gi, "");
  src = src.replace(/<Placemark\b[^>]*>[\s\S]*?<(?:\w+:)?Point\b[\s\S]*?<\/(?:\w+:)?Point>[\s\S]*?<\/Placemark>/gi, "");
  src = src.replace(/<(?:\w+:)?MultiGeometry\b[^>]*>/gi, "");
  src = src.replace(/<\/(?:\w+:)?MultiGeometry>/gi, "");
  return src;
}

/**
 * Silt APIs time out / 502 on dense river outlines. Send a tight bbox polygon instead.
 * Classification + volume still cover the full river corridor.
 */
export function siltAoiKml(text) {
  const src = polygonOnlyKml(text);
  const nums = [...String(src).matchAll(/([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/g)]
    .map((m) => ({ lon: Number(m[1]), lat: Number(m[2]) }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (nums.length < 3) return src;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of nums) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  // Small pad so shoreline silt cells near banks are included.
  const padLon = Math.max(0.004, (east - west) * 0.04);
  const padLat = Math.max(0.004, (north - south) * 0.04);
  west -= padLon;
  east += padLon;
  south -= padLat;
  north += padLat;
  const ring = `${west},${south},0 ${east},${south},0 ${east},${north},0 ${west},${north},0 ${west},${south},0`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Silt AOI</name>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark></Document></kml>`;
}

function uploadKmlFor(spec, session) {
  const raw = session.kmlText || "";
  if (spec.id === "silt-classification" || spec.id === "silt-volume" || spec.id === "silt") {
    return siltAoiKml(raw);
  }
  return polygonOnlyKml(raw);
}

async function postEndpoint(spec, session) {
  const form = new FormData();
  const kmlText = uploadKmlFor(spec, session);
  const blob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml" });
  const silt = spec.id === "silt-classification" || spec.id === "silt-volume" || spec.id === "silt";
  form.append("kml", blob, silt ? "silt_aoi.kml" : session.filename || "mandovi_river.kml");
  if (spec.id === "water-depth") {
    form.append("depth_min_m", "1.5");
    form.append("depth_max_m", "8.0");
  }
  const dates = spec.when ? dateWindow(spec, session) : null;
  if (dates) {
    form.append("start_date", dates.start_date);
    form.append("end_date", dates.end_date);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const attempt = Number(spec.attempt || 0);
  try {
    const res = await fetch(`${API_BASE.replace(/\/$/, "")}${spec.path}`, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { detail: text };
    }
    if (!res.ok) {
      const detail =
        (typeof body?.detail === "string" && body.detail) ||
        (Array.isArray(body?.detail) && body.detail.map((d) => d.msg || d).join("; ")) ||
        (typeof text === "string" && text.trim()) ||
        `HTTP ${res.status}`;
      // Silt upstream often 502s — retry a few times with backoff.
      const maxAttempts = silt ? 3 : 1;
      if (res.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return postEndpoint({ ...spec, attempt: attempt + 1 }, session);
      }
      throw new Error(detail);
    }
    if (spec.id === "flood-water") body = clipFlood(body, session.start_date, session.end_date);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** KML downloads for silt-* share the /api/silt/kml/{id} route. */
function downloadEndpointId(endpoint) {
  const id = String(endpoint || "");
  if (id === "silt-classification" || id === "silt-volume" || id === "silt") return "silt";
  return id;
}

export function kmlDownloadUrl(endpoint, idOrUrl) {
  if (!idOrUrl) return null;
  const s = String(idOrUrl);
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://");
  if (s.startsWith("/")) return `${API_BASE.replace(/\/$/, "")}${s}`;
  const ep = downloadEndpointId(endpoint);
  return `${API_BASE.replace(/\/$/, "")}/api/${ep}/kml/${s}`;
}

export function tifDownloadUrl(endpoint, idOrUrl) {
  if (!idOrUrl) return null;
  const s = String(idOrUrl);
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://");
  if (s.startsWith("/")) return `${API_BASE.replace(/\/$/, "")}${s}`;
  return `${API_BASE.replace(/\/$/, "")}/api/${endpoint}/tif/${s}`;
}

export async function downloadText(url) {
  const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "true" } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  return res.text();
}

function ymFromPath(path) {
  const hit = String(path || "").match(/(20\d{2})[-_/](\d{1,2})/);
  if (!hit) return { year: null, month: null };
  return { year: Number(hit[1]), month: Number(hit[2]) };
}

export function collectKmlRefs(node, acc = [], path = "") {
  if (!node || typeof node !== "object") return acc;
  const inlineKml =
    typeof node.kml === "string" && /<(?:\w+:)?kml[\s>]/i.test(node.kml)
      ? node.kml
      : typeof node.kml_text === "string" && /<(?:\w+:)?kml[\s>]/i.test(node.kml_text)
        ? node.kml_text
        : null;
  if (
    node.kml_download_url ||
    node.kml_id ||
    node.kml_url ||
    node.tif_download_url ||
    node.tif_id ||
    node.download_url ||
    inlineKml
  ) {
    const fromPath = ymFromPath(path);
    acc.push({
      path,
      url: node.kml_download_url || node.kml_url || node.tif_download_url || node.download_url || null,
      id: node.kml_id || node.tif_id || null,
      inlineKml,
      date: node.date || node.post_date || node.end_date || node.label || null,
      year: node.year ?? fromPath.year,
      month: node.month ?? fromPath.month,
      name: node.name || node.layer || node.title || path,
      categories: node.categories || node.legend || node.classes || null,
    });
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectKmlRefs(child, acc, `${path}[${i}]`));
  } else {
    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== "object") continue;
      if (key === "categories" || key === "legend" || key === "classes") continue;
      collectKmlRefs(child, acc, path ? `${path}.${key}` : key);
    }
  }
  return acc;
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function waitForEndpoint(id, timeoutMs = 90000) {
  const session = getRiverSession();
  if (session.results[id] || session.errors[id] || session.pending[id] === false) {
    return Promise.resolve(session.results[id] || null);
  }
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (session.results[id] || session.errors[id] || session.pending[id] === false) {
        clearInterval(timer);
        clearTimeout(stop);
        resolve(session.results[id] || null);
      }
    }, 400);
    const stop = setTimeout(() => {
      clearInterval(timer);
      resolve(session.results[id] || null);
    }, timeoutMs);
  });
}

let running = null;

async function runOneEndpoint(spec, session, onProgress) {
  onProgress?.({ id: spec.id, state: "running" });
  window.dispatchEvent(
    new CustomEvent("planeteye-endpoint", { detail: { id: spec.id, ok: null, state: "running" } }),
  );
  try {
    const body = await postEndpoint(spec, session);
    session.results[spec.id] = body;
    delete session.errors[spec.id];
    if (SILT_PRIORITY_IDS.includes(spec.id)) rememberSiltDates(spec.id, body);
    if (spec.id === "fishing-point") {
      const ref = collectKmlRefs(body)[0];
      const href = kmlDownloadUrl("fishing-point", ref?.url || ref?.id);
      if (href) {
        try {
          session.fishingKmlText = await downloadText(href);
        } catch (err) {
          console.warn("[fishing-point] KML download", err.message);
        }
      }
    }
    onProgress?.({ id: spec.id, state: "ok" });
    window.dispatchEvent(new CustomEvent("planeteye-endpoint", { detail: { id: spec.id, ok: true } }));
  } catch (err) {
    const message = err?.name === "AbortError" ? "Timed out" : err?.message || String(err);
    session.errors[spec.id] = message;
    onProgress?.({ id: spec.id, state: "error", message });
    window.dispatchEvent(new CustomEvent("planeteye-endpoint", { detail: { id: spec.id, ok: false, message } }));
  } finally {
    session.pending[spec.id] = false;
  }
}

/**
 * POST every endpoint that does not already have a stored result.
 * Silt classification + volume start immediately in parallel (no queue wait).
 * Same silt dates as cache → skip API (instant reuse).
 */
export function runJalNetra(onProgress) {
  if (running) return running;
  const session = getRiverSession();
  if (!session.siltDateFingerprints) session.siltDateFingerprints = {};
  // Rebuild fingerprints from saved bodies so restart reuses dates without refetch.
  for (const id of SILT_PRIORITY_IDS) {
    if (session.results?.[id] && !session.siltDateFingerprints[id]) {
      rememberSiltDates(id, session.results[id]);
    }
  }
  const todo = ENDPOINTS.filter((spec) => {
    if (SILT_PRIORITY_IDS.includes(spec.id)) return !siltCacheIsFresh(spec.id);
    return !session.results[spec.id];
  });
  for (const spec of todo) session.pending[spec.id] = true;

  const priority = todo.filter((spec) => SILT_PRIORITY_IDS.includes(spec.id));
  const rest = todo.filter((spec) => !SILT_PRIORITY_IDS.includes(spec.id));

  // Silt pair fires at once; remaining layers continue with higher concurrency.
  running = Promise.all([
    Promise.all(priority.map((spec) => runOneEndpoint(spec, session, onProgress))),
    mapLimit(rest, 5, (spec) => runOneEndpoint(spec, session, onProgress)),
  ]).finally(() => {
    running = null;
  });
  return running;
}

/** True while either silt endpoint is in flight for the active river. */
export function siltEndpointsPending() {
  const session = getRiverSession();
  return {
    classification: !!(session?.pending?.["silt-classification"] && !session?.results?.["silt-classification"]),
    volume: !!(session?.pending?.["silt-volume"] && !session?.results?.["silt-volume"]),
  };
}

export function jalnetraEndpointIds() {
  return ENDPOINTS.map((e) => e.id);
}

/**
 * On-demand POST for one endpoint (e.g. silt layers opened before the batch finishes).
 * Uses the uploaded river KML from the active session.
 */
export async function fetchEndpointNow(id) {
  const session = getRiverSession();
  if (!session?.kmlText) throw new Error("Upload a river KML before requesting JalNetra layers");
  // Same silt dates already cached → return immediately (no second POST).
  if (SILT_PRIORITY_IDS.includes(id)) {
    if (siltCacheIsFresh(id)) return session.results[id];
  } else if (session.results?.[id]) {
    return session.results[id];
  }
  const spec = ENDPOINTS.find((e) => e.id === id);
  if (!spec) throw new Error(`Unknown JalNetra endpoint: ${id}`);
  if (session.pending?.[id]) {
    return waitForEndpoint(id, TIMEOUT_MS);
  }
  session.pending[id] = true;
  try {
    const body = await postEndpoint(spec, session);
    session.results[id] = body;
    delete session.errors[id];
    if (SILT_PRIORITY_IDS.includes(id)) rememberSiltDates(id, body);
    window.dispatchEvent(new CustomEvent("planeteye-endpoint", { detail: { id, ok: true } }));
    return body;
  } catch (err) {
    const message = err?.name === "AbortError" ? "Timed out" : err?.message || String(err);
    session.errors[id] = message;
    window.dispatchEvent(new CustomEvent("planeteye-endpoint", { detail: { id, ok: false, message } }));
    throw err;
  } finally {
    session.pending[id] = false;
  }
}
