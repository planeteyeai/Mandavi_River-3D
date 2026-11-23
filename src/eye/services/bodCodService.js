/**
 * JalNetra BOD/COD for the uploaded river.
 * Live: POST /api/main-bod-cod (OpenAPI; alias /api/bod-cod) → streams + pixels.
 * Fallback: Mandovi survey CSV so values still paint when the API is down.
 */
import { riverFingerprint } from "./areaLive.js";
import { buildMandoviBodCodFromCsv, ensureBodCodPixels } from "./bodCodPixelService.js";
import { API_BASE } from "../session/jalnetraBase.js";

/** Kept for callers. Not used once a river KML is loaded. */
export const DEFAULT_BOD_COD_VIEWER_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BOD_COD_VIEWER_ID) || "";

const KML_MAP_KEY = "planeteye-bod-cod-kml-v2";
const REQUEST_TIMEOUT_MS = 180_000;
/** Re-fetch live payload at least this often. */
const LIVE_TTL_MS = 30 * 60 * 1000;
const MAIN_BOD_COD_PATH = "/api/main-bod-cod";

/** In-memory full payload (history is too large for localStorage). */
let memoryCache = null;

function pad(n) {
  return String(n).padStart(2, "0");
}

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Live window ending today (inclusive), ~30 days of history. */
export function liveBodCodDateWindow(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return { start_date: ymd(start), end_date: ymd(end) };
}

function isMandoviContext() {
  try {
    if (typeof window !== "undefined" && window.__MM_DATASET__?.isMandovi) return true;
    const scene = typeof window !== "undefined" ? window.__MM_SCENE__ : null;
    if (scene?.dataset?.isMandovi) return true;
    const name = String(window.__RIVER_SESSION__?.filename || "").toLowerCase();
    if (/mandovi|mandavi/.test(name)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function mandoviChainage() {
  try {
    const ds = window.__MM_DATASET__ || window.__MM_SCENE__?.dataset;
    return ds?.chainage || [];
  } catch {
    return [];
  }
}

function cacheIsFresh(key) {
  if (!memoryCache?.reaches?.length) return false;
  if (key && memoryCache._riverKey && memoryCache._riverKey !== key) return false;
  if (memoryCache._source === "live") {
    const age = Date.now() - (Number(memoryCache._fetchedAt) || 0);
    // Landsat windows are acquisition-based (not calendar "today") — TTL only.
    if (age > LIVE_TTL_MS) return false;
  }
  return true;
}

/** CSV fallback only — not used when live JalNetra succeeds. */
async function tryMandoviCsv(key) {
  if (!isMandoviContext()) return null;
  const chain = mandoviChainage();
  if (chain.length < 2) return null;
  try {
    await ensureBodCodPixels();
    const data = await buildMandoviBodCodFromCsv(chain);
    memoryCache = {
      ...data,
      _viewerId: data._viewerId,
      _riverKey: key || "mandovi",
      _source: "mandovi-csv",
      _fetchedAt: Date.now(),
    };
    return memoryCache;
  } catch (err) {
    console.warn("[bod-cod] Mandovi CSV unavailable:", err?.message || err);
    return null;
  }
}

/**
 * @param {string} [_viewerId] ignored — legacy arg; live API no longer uses viewer ids
 * @param {{ forceLive?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export async function fetchBodCodViewerData(_viewerId, opts = {}) {
  const session = typeof window !== "undefined" ? window.__RIVER_SESSION__ : null;
  const key = riverFingerprint(session) || (isMandoviContext() ? "mandovi" : "");

  if (!opts.forceLive && cacheIsFresh(key)) {
    return memoryCache;
  }
  if (memoryCache && key && memoryCache._riverKey !== key) {
    memoryCache = null;
  }

  if (!session?.kmlText || !key) {
    const local = await tryMandoviCsv(key);
    if (local?.reaches?.length) return local;
    throw new Error("BOD/COD loads only after a river KML is uploaded");
  }

  // Reuse in-flight / finished batch result from runJalNetra when present.
  if (!opts.forceLive && session.results?.["bod-cod"]) {
    const normalized = normalizeMainBodCodPayload(session.results["bod-cod"], mandoviChainage());
    if (normalized?.reaches?.length) {
      return remember(normalized, normalized._viewerId || "session", key, {
        start_date: session.results["bod-cod"]?.start_date,
        end_date: session.results["bod-cod"]?.end_date,
      });
    }
  }

  if (session.pending?.["bod-cod"]) {
    const { waitForEndpoint } = await import("../session/jalnetraClient.js");
    const body = await waitForEndpoint("bod-cod", 180000);
    if (body) {
      const normalized = normalizeMainBodCodPayload(body, mandoviChainage());
      if (normalized?.reaches?.length) {
        return remember(normalized, normalized._viewerId || "session", key, {
          start_date: body.start_date,
          end_date: body.end_date,
        });
      }
    }
  }

  try {
    return await refreshBodCodFromKml();
  } catch (err) {
    console.warn("[bod-cod] live refresh failed:", err?.message || err);
    const local = await tryMandoviCsv(key);
    if (local?.reaches?.length) return local;
    throw err;
  }
}

async function postMainBodCod(blob, filename, signal) {
  const form = new FormData();
  form.append("kml", blob, filename);
  return fetch(`${API_BASE.replace(/\/$/, "")}${MAIN_BOD_COD_PATH}`, {
    method: "POST",
    body: form,
    signal,
    headers: { "ngrok-skip-browser-warning": "true" },
  });
}

/** POST this river's KML → /api/main-bod-cod → normalized reaches for the UI. */
export async function refreshBodCodFromKml(_opts = {}) {
  const session = typeof window !== "undefined" ? window.__RIVER_SESSION__ : null;
  if (!session?.kmlText) throw new Error("BOD/COD needs this river's KML");
  const key = riverFingerprint(session);
  const blob = new Blob([session.kmlText], { type: "application/vnd.google-earth.kml+xml" });
  const filename = session.filename || "river.kml";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await postMainBodCod(blob, filename, ctrl.signal);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text?.slice(0, 160) || `BOD/COD refresh HTTP ${res.status}`);
    }
    const raw = await res.json();
    const normalized = normalizeMainBodCodPayload(raw, mandoviChainage());
    if (!normalized?.reaches?.length) {
      throw new Error("BOD/COD payload has no stream/pixel samples");
    }
    if (session.results) {
      session.results["bod-cod"] = {
        ...raw,
        ...(session.results["bod-cod"] || {}),
        kml_id: raw.kml_id || normalized._viewerId,
        start_date: raw.start_date,
        end_date: raw.end_date,
      };
    }
    return remember(normalized, normalized._viewerId || raw.kml_id || "live", key, {
      start_date: raw.start_date,
      end_date: raw.end_date,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse "CH 6+686" / "6686 m" / bare meters into corridor meters. */
function metersFromChainageLabel(label) {
  const s = String(label || "").trim();
  const ch = s.match(/CH\s*(\d+)\+(\d{1,3})/i);
  if (ch) return Number(ch[1]) * 1000 + Number(ch[2]);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (m) return Number(m[1]);
  const km = s.match(/(\d+(?:\.\d+)?)\s*km\b/i);
  if (km) return Number(km[1]) * 1000;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function reachShell(id, name, km0, km1, bod, cod, dateIso) {
  const cls = classFromBod(bod);
  const date = dateIso || new Date().toISOString();
  return {
    id,
    name,
    km: [km0, km1],
    today: {
      p10: bod * 0.92,
      p50: bod,
      p90: bod * 1.08,
      cod_p10: cod * 0.92,
      cod_p50: cod,
      cod_p90: cod * 1.08,
      cls,
      support: "sat",
      tier: "Observed",
    },
    history: {
      dates: [date],
      p10: [bod * 0.92],
      p50: [bod],
      p90: [bod * 1.08],
      cod_p10: [cod * 0.92],
      cod_p50: [cod],
      cod_p90: [cod * 1.08],
      support: ["sat"],
    },
    forecast: { dates: [], p10: [], p50: [], p90: [], cod_p10: [], cod_p50: [], cod_p90: [] },
  };
}

/**
 * Convert main-bod-cod / streams-bod-cod JSON into the reaches payload the HUD expects.
 * Accepts legacy twin `{ reaches }` as a no-op pass-through.
 */
export function normalizeMainBodCodPayload(raw, chainage = []) {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.reaches) && raw.reaches.length) {
    return {
      ...raw,
      _viewerId: raw.kml_id || raw._viewerId || "live",
      generated: raw.generated || raw.data_refreshed_at || new Date().toISOString(),
    };
  }

  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const pixels = Array.isArray(raw.pixels) ? raw.pixels : [];
  const dateIso = String(raw.data_refreshed_at || raw.generated || new Date().toISOString());
  const reaches = [];

  if (streams.length) {
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      const stats = s?.stats || {};
      const bod = Number(stats.bod_mg_L_mean ?? stats.bod_mean ?? s.bod_mg_L);
      const cod = Number(stats.cod_mg_L_mean ?? stats.cod_mean ?? s.cod_mg_L);
      if (!Number.isFinite(bod) && !Number.isFinite(cod)) continue;
      const meters = metersFromChainageLabel(s.chainage_label || s.chainage || s.stream_name);
      let km0;
      let km1;
      if (Number.isFinite(meters)) {
        km0 = Math.max(0, meters - 250) / 1000;
        km1 = (meters + 250) / 1000;
      } else {
        km0 = i;
        km1 = i + 1;
      }
      reaches.push(
        reachShell(
          String(s.stream_id || `S${String(i + 1).padStart(2, "0")}`),
          String(s.stream_name || s.chainage_label || `Stream ${i + 1}`),
          km0,
          km1,
          Number.isFinite(bod) ? bod : 0,
          Number.isFinite(cod) ? cod : Number.isFinite(bod) ? bod * 2 : 0,
          dateIso,
        ),
      );
    }
  }

  // Pixel table → corridor reaches when streams are missing / incomplete.
  if (!reaches.length && pixels.length && Array.isArray(chainage) && chainage.length >= 2) {
    const first = chainage[0].meters ?? 0;
    const last = chainage[chainage.length - 1].meters ?? first;
    const stepM = 500;
    let idx = 0;
    for (let m0 = first; m0 < last - 1; m0 += stepM) {
      const m1 = Math.min(last, m0 + stepM);
      const mid = (m0 + m1) / 2;
      const hit = samplePixelsNearChainage(pixels, chainage, mid);
      if (!hit) continue;
      idx += 1;
      reaches.push(
        reachShell(
          `P${String(idx).padStart(2, "0")}`,
          `${(m0 / 1000).toFixed(1)}–${(m1 / 1000).toFixed(1)} km`,
          m0 / 1000,
          m1 / 1000,
          hit.bod,
          hit.cod,
          dateIso,
        ),
      );
    }
  }

  if (!reaches.length && pixels.length) {
    // Last resort: one reach per average of all pixels.
    let bodSum = 0;
    let codSum = 0;
    let n = 0;
    for (const p of pixels) {
      const bod = Number(p.bod_mg_L ?? p.bod);
      const cod = Number(p.cod_mg_L ?? p.cod);
      if (!Number.isFinite(bod) && !Number.isFinite(cod)) continue;
      bodSum += Number.isFinite(bod) ? bod : 0;
      codSum += Number.isFinite(cod) ? cod : 0;
      n += 1;
    }
    if (n) {
      reaches.push(
        reachShell("R01", "River mean", 0, Math.max(1, n / 100), bodSum / n, codSum / n, dateIso),
      );
    }
  }

  if (!reaches.length) return null;

  return {
    river_name: raw.river_name || "River",
    tagline: raw.method || "JalNetra main BOD/COD",
    generated: dateIso,
    bod_edges: raw.bod_edges || [2, 3, 6, 10],
    class_colors: raw.class_colors || {
      A: "#2E7DD1",
      B: "#3AA76D",
      C: "#E3C51E",
      D: "#E08A2E",
      E: "#D14B3A",
    },
    reaches,
    pixels,
    alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
    _viewerId: String(raw.kml_id || "").trim() || "main-bod-cod",
    _rawStreams: streams,
  };
}

function samplePixelsNearChainage(pixels, chainage, meters) {
  const pts = Array.isArray(chainage) ? chainage : [];
  if (pts.length < 2 || !Array.isArray(pixels) || !pixels.length) return null;
  let nearest = pts[0];
  let nearestD = Infinity;
  for (const p of pts) {
    const d = Math.abs(Number(p.meters) - meters);
    if (d < nearestD) {
      nearestD = d;
      nearest = p;
    }
  }
  const lon = Number(nearest.lon ?? nearest.longitude);
  const lat = Number(nearest.lat ?? nearest.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of pixels) {
    const plat = Number(p.latitude ?? p.lat);
    const plon = Number(p.longitude ?? p.lon);
    if (!Number.isFinite(plat) || !Number.isFinite(plon)) continue;
    const d = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return null;
  const bod = Number(best.bod_mg_L ?? best.bod);
  const cod = Number(best.cod_mg_L ?? best.cod);
  if (!Number.isFinite(bod) && !Number.isFinite(cod)) return null;
  return {
    bod: Number.isFinite(bod) ? bod : NaN,
    cod: Number.isFinite(cod) ? cod : NaN,
  };
}

function remember(data, viewerId, riverKey, dateWindow) {
  const window =
    dateWindow ||
    data._dateWindow ||
    (data.start_date || data.end_date
      ? { start_date: data.start_date, end_date: data.end_date }
      : liveBodCodDateWindow());
  memoryCache = {
    ...data,
    _viewerId: viewerId || data._viewerId,
    _riverKey: riverKey,
    _source: "live",
    _fetchedAt: Date.now(),
    _dateWindow: window,
  };
  writeKmlId(riverKey, memoryCache._viewerId);
  console.info(
    "[bod-cod] live JalNetra",
    memoryCache._dateWindow,
    `${memoryCache.reaches?.length || 0} reaches`,
    `${Array.isArray(memoryCache.pixels) ? memoryCache.pixels.length : 0} pixels`,
  );
  return memoryCache;
}

function readKmlMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(KML_MAP_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeKmlId(riverKey, id) {
  if (!riverKey || !id) return;
  try {
    const map = readKmlMap();
    map[riverKey] = id;
    localStorage.setItem(KML_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/** Clear cache so next fetch hits JalNetra. */
export function clearBodCodCache() {
  memoryCache = null;
}

/** Synchronous live cache peek. */
export function getCachedBodCod() {
  return memoryCache;
}

/**
 * Sample live BOD/COD at corridor meters from JalNetra pixels or reaches.
 * @returns {{ bod:number, cod:number, cls:string, date:string, source:string } | null}
 */
export function sampleLiveBodCodAtMeters(meters, data = memoryCache) {
  const m = Number(meters);
  const pixels = Array.isArray(data?.pixels) ? data.pixels : [];
  if (pixels.length && Number.isFinite(m)) {
    const hit = samplePixelsNearChainage(pixels, mandoviChainage(), m);
    if (hit && (Number.isFinite(hit.bod) || Number.isFinite(hit.cod))) {
      return {
        bod: hit.bod,
        cod: hit.cod,
        cls: classFromBod(hit.bod),
        date: data?.generated || "",
        source: data?._source === "live" ? "jalnetra-live" : data?._source || "twin",
      };
    }
  }

  const list = data?.reaches || [];
  if (!list.length) return null;
  const km = Number.isFinite(m) ? m / 1000 : 0;
  let reach = list[0];
  let bestD = Infinity;
  for (const r of list) {
    const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
    if (km >= Number(a) && km <= Number(b) + 1e-6) {
      reach = r;
      bestD = 0;
      break;
    }
    const mid = (Number(a) + Number(b)) / 2;
    const d = Math.abs(mid - km);
    if (d < bestD) {
      bestD = d;
      reach = r;
    }
  }
  const timeline = buildBodCodTimeline(data);
  const idx = defaultTimeIndex(timeline);
  const sample = sampleReachAt(reach, idx, data, timeline);
  if (!Number.isFinite(sample?.p50) && !Number.isFinite(sample?.cod_p50)) return null;
  return {
    bod: sample.p50,
    cod: sample.cod_p50,
    cls: sample.cls,
    date: sample.date || data?.generated || "",
    source: data?._source === "live" ? "jalnetra-live" : data?._source || "twin",
    reachId: reach.id,
    reachName: reach.name,
  };
}

/** CPCB-style BOD class from p50 + bod_edges [2,3,6,10]. */
export function classFromBod(p50, edges = [2, 3, 6, 10]) {
  const v = Number(p50);
  if (!Number.isFinite(v)) return "NA";
  const e = edges.map(Number);
  if (v <= e[0]) return "A";
  if (v <= e[1]) return "B";
  if (v <= e[2]) return "C";
  if (v <= e[3]) return "D";
  return "E";
}

export function classShortLabel(cls, labels) {
  const full = labels?.[cls] || "";
  if (cls === "A") return "Drinking";
  if (cls === "B") return "Bathing";
  if (cls === "C") return "Treatable";
  if (cls === "D") return "Fisheries";
  if (cls === "E") return "Irrigation";
  if (full) return String(full).split(/—|–|-/)[0].trim().slice(0, 18);
  return cls || "—";
}

export function formatMgL(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} mg/L`;
}

/**
 * Unified history + forecast timeline (hourly).
 * @returns {{ dates: string[], historyCount: number, forecastCount: number }}
 */
export function buildBodCodTimeline(data) {
  const r0 = data?.reaches?.[0];
  const hist = Array.isArray(r0?.history?.dates) ? r0.history.dates : [];
  const fcst = Array.isArray(r0?.forecast?.dates) ? r0.forecast.dates : [];
  return {
    dates: [...hist, ...fcst],
    historyCount: hist.length,
    forecastCount: fcst.length,
  };
}

/**
 * Sample one reach at timeline index.
 * @returns {{ p10,p50,p90,cod_p10,cod_p50,cod_p90,cls,support,tier,kind:'history'|'forecast'|'today' }}
 */
export function sampleReachAt(reach, timeIndex, data, timeline) {
  const edges = data?.bod_edges || [2, 3, 6, 10];
  const histN = timeline?.historyCount ?? reach?.history?.dates?.length ?? 0;
  const dates = timeline?.dates || [];
  const i = Math.max(0, Math.min(dates.length - 1, Number(timeIndex) || 0));

  if (i < histN && reach?.history?.p50?.length) {
    const h = reach.history;
    const p50 = Number(h.p50[i]);
    const support = String(h.support?.[i] || "prior");
    return {
      p10: Number(h.p10?.[i]),
      p50,
      p90: Number(h.p90?.[i]),
      cod_p10: Number(h.cod_p10?.[i]),
      cod_p50: Number(h.cod_p50?.[i]),
      cod_p90: Number(h.cod_p90?.[i]),
      cls: classFromBod(p50, edges),
      support,
      tier: support === "sat" || support === "anchor" ? "Observed" : "Estimated",
      kind: "history",
      date: dates[i],
    };
  }

  const fi = i - histN;
  if (reach?.forecast?.p50?.length && fi >= 0 && fi < reach.forecast.p50.length) {
    const f = reach.forecast;
    const p50 = Number(f.p50[fi]);
    return {
      p10: Number(f.p10?.[fi]),
      p50,
      p90: Number(f.p90?.[fi]),
      cod_p10: Number(f.cod_p10?.[fi]),
      cod_p50: Number(f.cod_p50?.[fi]),
      cod_p90: Number(f.cod_p90?.[fi]),
      cls: classFromBod(p50, edges),
      support: "forecast",
      tier: "Forecast",
      kind: "forecast",
      date: dates[i],
    };
  }

  const t = reach?.today || {};
  return {
    p10: Number(t.p10),
    p50: Number(t.p50),
    p90: Number(t.p90),
    cod_p10: Number(t.cod_p10),
    cod_p50: Number(t.cod_p50),
    cod_p90: Number(t.cod_p90),
    cls: String(t.cls || classFromBod(t.p50, edges)).toUpperCase(),
    support: String(t.support || "prior"),
    tier: String(t.tier || "Estimated"),
    kind: "today",
    date: data?.generated || dates[i] || "",
  };
}

/** Snapshot all reaches at one time index (for ribbon + strip). */
export function sampleAllReachesAt(data, timeIndex, timeline) {
  const tl = timeline || buildBodCodTimeline(data);
  return (data?.reaches || []).map((r) => ({
    id: r.id,
    name: r.name,
    km: r.km,
    sample: sampleReachAt(r, timeIndex, data, tl),
  }));
}

/** Alerts for the selected calendar day (YYYY-MM-DD). */
export function alertsForDate(data, dateStr) {
  const day = String(dateStr || "").slice(0, 10);
  const list = Array.isArray(data?.alerts) ? data.alerts : [];
  if (!day) return list.slice(0, 12);
  const exact = list.filter((a) => String(a.date || "").slice(0, 10) === day);
  if (exact.length) return exact;
  return list.slice(0, 12);
}

/** River-wide accuracy / summary for the selected hour. */
export function riverAccuracyAt(data, timeIndex, timeline) {
  const snaps = sampleAllReachesAt(data, timeIndex, timeline);
  const edges = data?.bod_edges || [2, 3, 6, 10];
  const bath = Number(edges[1]) || 3;
  const bods = snaps.map((s) => s.sample.p50).filter(Number.isFinite);
  const cods = snaps.map((s) => s.sample.cod_p50).filter(Number.isFinite);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
  const aboveBath = snaps.filter((s) => Number(s.sample.p50) > bath).length;
  let highest = null;
  for (const s of snaps) {
    if (!Number.isFinite(s.sample.p50)) continue;
    if (!highest || s.sample.p50 > highest.sample.p50) highest = s;
  }
  const date = snaps[0]?.sample?.date || "";
  return {
    date,
    bodMean: mean(bods),
    codMean: mean(cods),
    aboveBathing: aboveBath,
    highestId: highest?.id || "—",
    highestBod: highest?.sample?.p50,
    reachCount: snaps.length,
  };
}

/** Default time index = last history hour (today), else last date. */
export function defaultTimeIndex(timeline) {
  const n = timeline?.dates?.length || 0;
  if (!n) return 0;
  const h = timeline.historyCount || 0;
  if (h > 0) return h - 1;
  return n - 1;
}

export function formatTimelineLabel(dateStr) {
  if (!dateStr) return "—";
  const raw = String(dateStr).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[Number(m[2]) - 1] || m[2];
    return `${Number(m[3])} ${mon} ${m[1]} · ${m[4]}:${m[5]}`;
  }
  return raw.replace("T", " ").slice(0, 16);
}

/** Compact ends for the scrubber scale (avoid long jammed strings). */
export function formatTimelineScaleLabel(dateStr) {
  if (!dateStr) return "—";
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]} ${m[4]}:${m[5]}`;
  return String(dateStr).replace("T", " ").slice(0, 11);
}

/** Segment fill style for end-to-end bar. */
export function supportStyle(support) {
  const s = String(support || "").toLowerCase();
  if (s === "forecast") return "forecast";
  if (s === "sat" || s === "anchor" || s === "obs" || s === "observed") return "observed";
  return "prior";
}
