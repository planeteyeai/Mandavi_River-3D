/**
 * Live discharge for the uploaded river.
 *
 * Primary: Open-Meteo Flood API (GloFAS) river_discharge at this river's
 * coordinates — m³/s for the nearest river cell, not a fixed city.
 * https://flood-api.open-meteo.com/v1/flood
 *
 * Rainfall (display only) comes from the forecast API at the same point.
 * Open-Meteo precipitation is already the preceding-hour sum in mm.
 *
 * Fallback, only if GloFAS has no cell: rational runoff on the uploaded
 * catchment estimate. That path is labelled as an estimate.
 */

import { activeRiverPoint, areaTimeZone, calendarDay, riverFingerprint } from "../areaLive.js";

const FETCH_INTERVAL_MS = 15 * 60 * 1000;
const RUNOFF_COEFF = 0.35;
const MONSOON_MONTHS = [6, 7, 8, 9, 10];

let _cachedResult = null;
let _cacheKey = "";
let _listeners = new Set();
let _fetchTimer = null;
let _pollKey = "";
let _inflight = null;

function queryPoint() {
  return activeRiverPoint();
}

function catchmentKm2() {
  const n = Number(typeof window !== "undefined" && window.__RIVER_SESSION__?.catchmentKm2);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** Specific yield scaled from a dry/monsoon background, per km² of the uploaded AOI. */
export function estimatedBaseflowM3s() {
  const area = catchmentKm2();
  if (!area) return null;
  const monsoon = MONSOON_MONTHS.includes(new Date().getMonth() + 1);
  const perKm2 = monsoon ? 0.0175 : 0.0075;
  return area * perKm2;
}

function lagHours(area) {
  const a = Number(area) || 200;
  return Math.min(8, Math.max(0.5, 2 * Math.sqrt(a / 2000)));
}

function rainfallToRunoff(intensityMmHr, area) {
  if (!Number.isFinite(intensityMmHr) || intensityMmHr <= 0 || !area) return 0;
  return (RUNOFF_COEFF * intensityMmHr * area) / 3.6;
}

function pickTodayDischarge(daily, today) {
  const times = Array.isArray(daily?.time) ? daily.time : [];
  const values = Array.isArray(daily?.river_discharge) ? daily.river_discharge : [];
  let chosen = null;
  let chosenDay = null;
  for (let i = 0; i < times.length; i += 1) {
    const q = Number(values[i]);
    if (!Number.isFinite(q)) continue;
    const day = String(times[i] || "").slice(0, 10);
    if (day && today && day > today) continue;
    chosen = q;
    chosenDay = day;
  }
  return { q: chosen, day: chosenDay };
}

function dischargeTrace(daily, today) {
  const times = Array.isArray(daily?.time) ? daily.time : [];
  const values = Array.isArray(daily?.river_discharge) ? daily.river_discharge : [];
  return times.map((t, i) => {
    const q = Number(values[i]);
    return {
      time: t,
      Q_total: Number.isFinite(q) ? q : null,
      kind: String(t).slice(0, 10) < today ? "past" : String(t).slice(0, 10) === today ? "today" : "forecast",
    };
  }).filter((row) => row.Q_total != null);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(String(data.reason || data.error));
  return data;
}

/**
 * Fetch live rainfall and river discharge for the uploaded river.
 */
export async function fetchLiveHydrology() {
  const point = queryPoint();
  if (!point) throw new Error("Upload a river before reading discharge");
  const key = riverFingerprint() || `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
  if (_inflight && _cacheKey === key) return _inflight;

  const run = loadLive(point, key).finally(() => {
    if (_inflight === run) _inflight = null;
  });
  _inflight = run;
  _cacheKey = key;
  return run;
}

async function loadLive(point, key) {
  const zone = areaTimeZone(point.lat, point.lon);
  const today = calendarDay(zone === "auto" ? "UTC" : zone);
  const floodUrl = new URL("https://flood-api.open-meteo.com/v1/flood");
  floodUrl.searchParams.set("latitude", String(point.lat));
  floodUrl.searchParams.set("longitude", String(point.lon));
  floodUrl.searchParams.set("daily", "river_discharge,river_discharge_mean");
  floodUrl.searchParams.set("past_days", "2");
  floodUrl.searchParams.set("forecast_days", "3");

  const rainUrl = new URL("https://api.open-meteo.com/v1/forecast");
  rainUrl.searchParams.set("latitude", String(point.lat));
  rainUrl.searchParams.set("longitude", String(point.lon));
  rainUrl.searchParams.set("current", "precipitation,rain,weather_code");
  rainUrl.searchParams.set("hourly", "precipitation");
  rainUrl.searchParams.set("past_hours", "6");
  rainUrl.searchParams.set("forecast_hours", "6");
  rainUrl.searchParams.set("timezone", zone);

  let flood = null;
  let rain = null;
  try {
    [flood, rain] = await Promise.all([
      fetchJson(floodUrl).catch((err) => {
        console.warn("[LiveHydrology] discharge", err.message);
        return null;
      }),
      fetchJson(rainUrl).catch((err) => {
        console.warn("[LiveHydrology] rainfall", err.message);
        return null;
      }),
    ]);
  } catch (err) {
    return fail(point, err);
  }

  const currentRain = Number(rain?.current?.precipitation);
  const currentRain_mm_hr = Number.isFinite(currentRain) ? currentRain : 0;
  const weatherCode = rain?.current?.weather_code ?? 0;
  const picked = pickTodayDischarge(flood?.daily, today);
  const cellLat = Number(flood?.latitude);
  const cellLon = Number(flood?.longitude);
  const area = catchmentKm2();

  let Q_total = picked.q;
  let source = "glofas";
  if (!Number.isFinite(Q_total)) {
    const lagged = laggedRainMmHr(rain?.hourly);
    const runoff = rainfallToRunoff(lagged, area);
    const base = estimatedBaseflowM3s() ?? 0;
    Q_total = base + runoff;
    source = "estimate";
  }

  const result = {
    fetchTime: new Date().toISOString(),
    localTime: new Date().toLocaleString("en-IN", {
      timeZone: zone === "auto" ? undefined : zone,
    }),
    riverName: point.name,
    lat: point.lat,
    lon: point.lon,
    cellLat: Number.isFinite(cellLat) ? cellLat : point.lat,
    cellLon: Number.isFinite(cellLon) ? cellLon : point.lon,
    currentRain_mm_hr,
    weatherCode,
    weatherDescription: weatherDescription(weatherCode),
    Q_baseflow: source === "glofas" ? Q_total : estimatedBaseflowM3s() ?? Q_total,
    Q_runoff: source === "glofas" ? 0 : Math.max(0, Q_total - (estimatedBaseflowM3s() ?? 0)),
    Q_total,
    Q_total_label: `${Q_total.toFixed(1)} m³/s`,
    dischargeDay: picked.day || today,
    dischargeTrace: source === "glofas" ? dischargeTrace(flood?.daily, today) : [],
    provenance: {
      rainfall: `Open-Meteo rainfall at ${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°`,
      discharge:
        source === "glofas"
          ? `GloFAS river discharge ${Number.isFinite(cellLat) ? `${cellLat.toFixed(3)}°, ${cellLon.toFixed(3)}°` : "nearest river cell"} for ${point.name}`
          : `Estimated from rainfall and ${area ? `${area.toFixed(0)} km²` : "unknown"} catchment — no GloFAS cell`,
      accuracy: source === "glofas" ? "GLOFAS_RIVER_CELL" : "RAINFALL_ESTIMATE",
    },
    source,
    available: Number.isFinite(Q_total),
    riverKey: key,
  };

  if (result.riverKey !== (riverFingerprint() || key)) return result;
  _cachedResult = result;
  _notify(result);
  return result;
}

function laggedRainMmHr(hourly) {
  const times = hourly?.time || [];
  const precip = hourly?.precipitation || [];
  if (!times.length) return 0;
  const area = catchmentKm2() || 200;
  const lagMs = lagHours(area) * 3600 * 1000;
  const target = Date.now() - lagMs;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const t = new Date(times[i]).getTime();
    const diff = Math.abs(t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = Number(precip[i]) || 0;
    }
  }
  return best;
}

function fail(point, err) {
  console.warn("[LiveHydrology] Fetch failed:", err?.message || err);
  const base = estimatedBaseflowM3s();
  const fallback = {
    fetchTime: new Date().toISOString(),
    riverName: point?.name || "",
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    currentRain_mm_hr: 0,
    Q_baseflow: base,
    Q_runoff: 0,
    Q_total: base,
    Q_total_label: base == null ? "—" : `${base.toFixed(1)} m³/s`,
    dischargeTrace: [],
    provenance: { accuracy: "OFFLINE", discharge: "Discharge API unavailable" },
    source: "offline",
    available: Number.isFinite(base),
    error: err?.message || String(err),
    riverKey: riverFingerprint(),
  };
  _cachedResult = fallback;
  _notify(fallback);
  return fallback;
}

export function startLiveHydrologyPolling() {
  const key = riverFingerprint() || "river";
  if (_fetchTimer && _pollKey === key) return;
  stopLiveHydrologyPolling();
  _pollKey = key;
  _cachedResult = null;
  fetchLiveHydrology().catch((err) => console.warn("[LiveHydrology]", err.message));
  _fetchTimer = setInterval(() => {
    fetchLiveHydrology().catch((err) => console.warn("[LiveHydrology]", err.message));
  }, FETCH_INTERVAL_MS);
}

export function stopLiveHydrologyPolling() {
  if (_fetchTimer) {
    clearInterval(_fetchTimer);
    _fetchTimer = null;
  }
}

export function subscribeLiveHydrology(listener) {
  _listeners.add(listener);
  if (_cachedResult) listener(_cachedResult);
  return () => _listeners.delete(listener);
}

export function getCachedLiveHydrology() {
  const key = riverFingerprint();
  if (key && _cachedResult?.riverKey && _cachedResult.riverKey !== key) return null;
  return _cachedResult;
}

function _notify(data) {
  for (const fn of _listeners) {
    try { fn(data); } catch (e) { console.error("[LiveHydrology] listener error:", e); }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("live-hydrology-update", { detail: data }));
  }
}

function weatherDescription(code) {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 9) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95) return "Thunderstorm";
  return "Overcast";
}
