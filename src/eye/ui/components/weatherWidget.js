import { CloudSun } from "lucide";
import { lucideHtml } from "../icons.js";
import { fetchWeatherAt } from "../../services/weatherService.js";
import {
  fetchBodCodViewerData,
  buildBodCodTimeline,
  defaultTimeIndex,
  sampleReachAt,
  sampleLiveBodCodAtMeters,
  clearBodCodCache,
} from "../../services/bodCodService.js";
import {
  ensureBodCodPixels,
  sampleBodCodAtChainage,
  sampleBodCodAtLonLat,
} from "../../services/bodCodPixelService.js";
import { getLiveDischargeAtChainage } from "../../services/forecastService.js";
import { getCachedLiveHydrology } from "../../services/hydrology/liveHydrologyService.js";
import { activeRiverPoint, areaTimeZone } from "../../services/areaLive.js";
import { mountWeatherOverview } from "../../weather/WeatherOverview.js";
import { streamBodCodFor } from "../../data/streamsBodCod.js";
import { state } from "../../state.js";

/**
 * Top-right LIVE WEATHER + always-on BOD/COD + chainage-live discharge.
 * Weather icon opens Open-Meteo past/future detail graphs.
 */
export function mountWeatherWidget(root) {
  const el = document.createElement("aside");
  el.className = "hud weather-widget map-chrome";
  el.id = "weather-widget";
  el.innerHTML = `
    <button type="button" class="weather-icon" id="weather-icon-btn" title="Open live weather details" aria-label="Open live weather details">
      ${lucideHtml(CloudSun, { size: 18 })}
    </button>
    <div class="weather-wq" aria-label="BOD and COD at selected chainage">
      <div class="weather-wq-row is-bod">
        <i data-short="BOD">BOD</i>
        <b id="weather-bod">—</b>
        <em>mg/L</em>
      </div>
      <div class="weather-wq-row is-cod">
        <i data-short="COD">COD</i>
        <b id="weather-cod">—</b>
        <em>mg/L</em>
      </div>
    </div>
    <button type="button" class="weather-copy weather-copy-btn" id="weather-open-detail" title="Open live weather details">
      <strong>LIVE WEATHER</strong>
      <b id="weather-temp" class="weather-temp">— °C</b>
      <i id="weather-condition" class="weather-condition">Weather unavailable</i>
      <small id="weather-wind">Wind —</small>
      <small id="weather-location">Station —</small>
    </button>
    <div class="weather-time-block" aria-label="Local date and time">
      <time class="weather-date" datetime="">—</time>
      <time class="weather-time" datetime="">--:--</time>
    </div>
  `;
  root.appendChild(el);

  const detail = mountWeatherOverview(root);
  /** @type {{ lat?:number, lon?:number, label?:string } | null} */
  let lastPoint = null;

  const dateEl = el.querySelector(".weather-date");
  const time = el.querySelector(".weather-time");
  const temperature = el.querySelector("#weather-temp");
  const condition = el.querySelector("#weather-condition");
  const wind = el.querySelector("#weather-wind");
  const location = el.querySelector("#weather-location");
  const dischargeEl = el.querySelector("#weather-discharge");
  const dischargeUnitEl = el.querySelector("#weather-discharge-unit");
  const bodEl = el.querySelector("#weather-bod");
  const codEl = el.querySelector("#weather-cod");

  let requestTimer = 0;
  let requestSerial = 0;
  let lastSuccessful = "";
  let weatherAvailable = false;

  /** @type {object | null} */
  let bodData = null;
  let bodTimeline = { dates: [], historyCount: 0, forecastCount: 0 };
  let bodTimeIndex = 0;
  let lastMeters = null;
  let bodLoadPromise = null;
  let dischargeSerial = 0;
  /** @type {object | null} Selected joining stream — BOD/COD from its lat/lon (or stream table). */
  let lastJoiningRec = null;
  /** @type {{ bod:number, cod:number, name?:string, label?:string } | null} */
  let pinnedHotspotWq = null;
  /** @type {string} */
  let bodFailReason = "";

  const zone = (() => {
    const p = activeRiverPoint();
    const z = p ? areaTimeZone(p.lat, p.lon) : "Asia/Kolkata";
    return z === "auto" ? undefined : z;
  })();
  const dateFmt = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: zone,
  });
  const timeFmt = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  });

  const update = () => {
    const now = new Date();
    const iso = now.toISOString();
    dateEl.dateTime = iso;
    dateEl.textContent = dateFmt.format(now);
    if (!weatherAvailable && lastSuccessful) return;
    time.dateTime = iso;
    time.textContent = timeFmt.format(now);
  };
  update();
  const timer = window.setInterval(update, 1000);
  const weatherRefreshTimer = window.setInterval(() => {
    if (lastPoint) updateForChainage(lastPoint);
  }, 5 * 60 * 1000);

  function chainagePoints() {
    return window.__MM_DATASET__?.chainage || window.__MM_SCENE__?.dataset?.chainage || [];
  }

  /** Paint survey BOD/COD first so numbers stay on screen even if live API is slow/down. */
  async function showSurveyBodCodNow() {
    try {
      await ensureBodCodPixels();
    } catch {
      /* pixels optional until CSV loads */
    }
    // Keep previous live payload until a new live fetch wins; survey paint is via renderBodCod fallback.
    if (!bodData?.reaches?.length || bodData._source !== "live") {
      renderBodCod();
    }
  }

  function ensureBodData(forceLive = false) {
    if (!forceLive && bodData?.reaches?.length && bodData._source === "live") {
      return Promise.resolve(bodData);
    }
    if (bodLoadPromise) return bodLoadPromise;
    if (forceLive) clearBodCodCache();

    // Always show survey BOD/COD regularly while live is fetching / failing.
    void showSurveyBodCodNow();

    bodLoadPromise = Promise.all([
      ensureBodCodPixels().catch(() => null),
      fetchBodCodViewerData(undefined, { forceLive: !!forceLive }).catch((err) => {
        bodFailReason = String(err?.message || err || "JalNetra BOD/COD failed");
        console.warn("[weather-wq]", bodFailReason);
        return null;
      }),
    ])
      .then(([, data]) => {
        if (data?.reaches?.length) {
          bodData = data;
          bodTimeline = buildBodCodTimeline(data);
          bodTimeIndex = defaultTimeIndex(bodTimeline);
          if (data._source === "live") {
            bodFailReason = "";
            el.classList.add("weather-wq--live");
          } else {
            el.classList.remove("weather-wq--live");
            if (!bodFailReason) bodFailReason = "JalNetra live BOD/COD unavailable";
          }
        } else if (!bodFailReason) {
          bodFailReason = "JalNetra returned no BOD/COD reaches";
        }
        el.title = "";
        renderBodCod();
        return data;
      })
      .finally(() => {
        bodLoadPromise = null;
      });
    return bodLoadPromise;
  }

  function reachAtMeters(meters) {
    const list = bodData?.reaches || [];
    if (!list.length) return null;
    const m = Number(meters);
    if (!Number.isFinite(m)) return list[0];
    const km = m / 1000;
    for (const r of list) {
      const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
      if (km >= Number(a) && km <= Number(b) + 1e-6) return r;
    }
    let best = list[0];
    let bestD = Infinity;
    for (const r of list) {
      const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
      const mid = (Number(a) + Number(b)) / 2;
      const d = Math.abs(mid - km);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  function joiningStreamLabel(rec) {
    const raw = String(
      rec?.displayName || rec?.meta?.name || rec?.meta?.nameEn || rec?.name || "",
    ).trim();
    if (!raw || /^unnamed\b/i.test(raw)) return "Joining stream";
    return raw;
  }

  const weatherWqEl = el.querySelector(".weather-wq");

  function setWeatherWqVisible(on) {
    if (weatherWqEl) weatherWqEl.hidden = !on;
  }

  function clearWeatherBodCod() {
    if (bodEl) {
      bodEl.textContent = "";
      bodEl.title = "";
    }
    if (codEl) {
      codEl.textContent = "";
      codEl.title = "";
    }
  }

  /**
   * Joining Streams BOD/COD: only the stream table (S01–S07).
   * No pixel / chainage invent — if the stream has no row, hide BOD/COD entirely.
   * @returns {"ok"|"missing"|false}
   */
  function applyJoiningStreamBodCod(rec) {
    if (!bodEl && !codEl) return false;
    if (!rec) return false;

    const q = streamBodCodFor(rec);
    if (q) {
      setWeatherWqVisible(true);
      if (bodEl) {
        bodEl.textContent = formatMetricNumber(q.bodMean, 1);
        bodEl.title = "";
      }
      if (codEl) {
        codEl.textContent = formatMetricNumber(q.codMean, 1);
        codEl.title = "";
      }
      return "ok";
    }

    setWeatherWqVisible(false);
    clearWeatherBodCod();
    return "missing";
  }

  function renderBodCod() {
    if (!bodEl && !codEl) return;

    // Joining Streams: stream-table only — never invent BOD/COD from nearby pixels.
    if (state.joiningStreamsMode && lastJoiningRec) {
      applyJoiningStreamBodCod(lastJoiningRec);
      return;
    }

    // Pollution hotspot pin — show the exact card values.
    if (pinnedHotspotWq) {
      setWeatherWqVisible(true);
      if (bodEl) {
        bodEl.textContent = formatMetricNumber(pinnedHotspotWq.bod, 1);
        bodEl.title = "";
      }
      if (codEl) {
        codEl.textContent = formatMetricNumber(pinnedHotspotWq.cod, 1);
        codEl.title = "";
      }
      el.classList.add("weather-wq--hotspot");
      return;
    }
    el.classList.remove("weather-wq--hotspot");

    setWeatherWqVisible(true);

    const meters =
      lastMeters != null
        ? lastMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : 0;

    // 1) Live twin at this chainage (today index) — values only, no source label.
    const live = sampleLiveBodCodAtMeters(meters, bodData);
    if (
      bodData?._source === "live" &&
      live &&
      (Number.isFinite(live.bod) || Number.isFinite(live.cod))
    ) {
      if (bodEl) {
        bodEl.textContent = formatMetricNumber(live.bod, 1);
        bodEl.title = "";
      }
      if (codEl) {
        codEl.textContent = formatMetricNumber(live.cod, 1);
        codEl.title = "";
      }
      return;
    }

    if (bodData?.reaches?.length && bodData._source === "live") {
      const reach = reachAtMeters(meters);
      const sample = sampleReachAt(reach, bodTimeIndex, bodData, bodTimeline);
      if (bodEl) {
        bodEl.textContent = formatMetricNumber(sample?.p50, 1);
        bodEl.title = "";
      }
      if (codEl) {
        codEl.textContent = formatMetricNumber(sample?.cod_p50, 1);
        codEl.title = "";
      }
      if (Number.isFinite(sample?.p50) || Number.isFinite(sample?.cod_p50)) {
        return;
      }
    }

    // 2) Survey CSV fallback — values only.
    const chain = chainagePoints();
    const fromChain = sampleBodCodAtChainage(chain, meters);
    if (fromChain) {
      if (bodEl) {
        bodEl.textContent = formatMetricNumber(fromChain.bod, 1);
        bodEl.title = "";
      }
      if (codEl) {
        codEl.textContent = formatMetricNumber(fromChain.cod, 1);
        codEl.title = "";
      }
      return;
    }
    if (Number.isFinite(lastPoint?.lat) && Number.isFinite(lastPoint?.lon)) {
      const fromLl = sampleBodCodAtLonLat(lastPoint.lon, lastPoint.lat);
      if (fromLl) {
        if (bodEl) {
          bodEl.textContent = formatMetricNumber(fromLl.bod, 1);
          bodEl.title = "";
        }
        if (codEl) {
          codEl.textContent = formatMetricNumber(fromLl.cod, 1);
          codEl.title = "";
        }
        return;
      }
    }

    // Keep last painted numbers if we already have them; only blank when never loaded.
    const hadBod = bodEl?.textContent && bodEl.textContent !== "—";
    const hadCod = codEl?.textContent && codEl.textContent !== "—";
    if (!hadBod && bodEl) bodEl.textContent = "—";
    if (!hadCod && codEl) codEl.textContent = "—";
  }

  function updateFromJoiningStream(rec) {
    lastJoiningRec = rec || null;
    if (!rec) {
      void ensureBodData().then(() => renderBodCod());
      return;
    }

    const lon = Number(rec.outletLon);
    const lat = Number(rec.outletLat);
    const label = joiningStreamLabel(rec);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      lastPoint = { lat, lon, label };
      detail.setPoint(lastPoint);
      location.textContent = `${label} · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    } else {
      location.textContent = label;
    }

    const meters = Number(rec.riverChainageMeters ?? rec.nearestChainageMeters);
    if (Number.isFinite(meters)) lastMeters = meters;

    void ensureBodData().then(() => renderBodCod());
    void renderDischarge();
  }

  function formatMetricNumber(v, digits = 1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(digits);
  }

  async function renderDischarge() {
    const meters =
      lastMeters != null
        ? lastMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : 0;
    const serial = ++dischargeSerial;
    try {
      const q = await getLiveDischargeAtChainage(meters);
      if (serial !== dischargeSerial) return;
      if (dischargeEl) {
        dischargeEl.textContent = formatMetricNumber(q, 1);
        const live = getCachedLiveHydrology();
        dischargeEl.title = live?.provenance?.discharge || `Discharge at this chainage`;
      }
      if (dischargeUnitEl) dischargeUnitEl.hidden = !Number.isFinite(q);
      document.dispatchEvent(
        new CustomEvent("chainage-discharge", { detail: { meters, q } }),
      );
    } catch (err) {
      if (serial !== dischargeSerial) return;
      console.warn("[weather-q]", err?.message || err);
      if (dischargeEl) {
        dischargeEl.textContent = "—";
        dischargeEl.title = "Discharge unavailable";
      }
      if (dischargeUnitEl) dischargeUnitEl.hidden = true;
    }
  }

  function updateBodCodForChainage(point) {
    lastMeters = point?.meters ?? state.selectedChainageMeters ?? null;
    // Hotspot-driven chainage sync keeps pinned BOD/COD (exact card values).
    if (point?.fromPollutionHotspot && pinnedHotspotWq) {
      void renderDischarge();
      renderBodCod();
      return;
    }
    // Normal chainage move clears hotspot pin so LIVE WEATHER follows the station again.
    if (!point?.fromPollutionHotspot) {
      pinnedHotspotWq = null;
      el.classList.remove("weather-wq--hotspot");
    }
    // Chainage sync from joining-stream select must not wipe / invent stream BOD/COD.
    void ensureBodData().then(() => renderBodCod());
    void renderDischarge();
  }

  function onBodCodTime(e) {
    if (Number.isFinite(e.detail?.timeIndex)) {
      bodTimeIndex = e.detail.timeIndex;
    }
    if (e.detail?.data?.reaches?.length) {
      bodData = e.detail.data;
      bodTimeline = buildBodCodTimeline(bodData);
    }
    renderBodCod();
  }

  document.addEventListener("bod-cod-time-change", onBodCodTime);

  function onJoiningStreamWq(e) {
    updateFromJoiningStream(e.detail?.rec || null);
  }
  document.addEventListener("joining-stream-wq", onJoiningStreamWq);

  function onPollutionHotspotSelect(e) {
    const d = e.detail || {};
    const bod = Number(d.bod);
    const cod = Number(d.cod);
    if (!Number.isFinite(bod) && !Number.isFinite(cod)) {
      pinnedHotspotWq = null;
      renderBodCod();
      return;
    }
    pinnedHotspotWq = {
      bod,
      cod,
      name: d.name || d.label || "Pollution hotspot",
      label: d.label,
      liveDate: d.liveDate || null,
      source: d.source || null,
    };
    lastJoiningRec = null;
    if (Number.isFinite(d.meters)) lastMeters = d.meters;
    if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
      lastPoint = { lat: d.lat, lon: d.lon, label: d.label || d.name };
      detail.setPoint?.(lastPoint);
      if (location) {
        location.textContent = `${d.name || "Hotspot"} · ${Number(d.lat).toFixed(5)}, ${Number(d.lon).toFixed(5)}`;
      }
    }
    renderBodCod();
  }
  document.addEventListener("pollution-hotspot-select", onPollutionHotspotSelect);

  function onPollutionHotspotToggle(e) {
    if (e.detail?.open === false) {
      pinnedHotspotWq = null;
      el.classList.remove("weather-wq--hotspot");
      void ensureBodData().then(() => renderBodCod());
    }
  }
  document.addEventListener("pollution-hotspot-toggle", onPollutionHotspotToggle);

  function updateForChainage(point) {
    const river = activeRiverPoint();
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    const resolved = Number.isFinite(lat) && Number.isFinite(lon)
      ? point
      : river
        ? { ...point, lat: river.lat, lon: river.lon, label: point?.label || river.label }
        : point;
    // Keep joining-stream lat/lon as the weather station while a stream is selected.
    if (state.joiningStreamsMode && lastJoiningRec) {
      const jLon = Number(lastJoiningRec.outletLon);
      const jLat = Number(lastJoiningRec.outletLat);
      const jLabel = joiningStreamLabel(lastJoiningRec);
      if (Number.isFinite(jLat) && Number.isFinite(jLon)) {
        lastPoint = { lat: jLat, lon: jLon, label: jLabel };
        detail.setPoint(lastPoint);
        location.textContent = `${jLabel} · ${jLat.toFixed(5)}, ${jLon.toFixed(5)}`;
      } else {
        location.textContent = jLabel;
      }
    } else {
      lastPoint = resolved
        ? { lat: resolved.lat, lon: resolved.lon, label: resolved.label }
        : null;
      detail.setPoint(lastPoint);
      location.textContent = resolved?.label ? `Station ${resolved.label}` : (river?.label || "Station —");
    }
    updateBodCodForChainage(point);
    window.clearTimeout(requestTimer);
    const serial = ++requestSerial;
    requestTimer = window.setTimeout(async () => {
      try {
        const weather = await fetchWeatherAt(resolved?.lat, resolved?.lon);
        if (serial !== requestSerial) return;
        temperature.textContent =
          weather.temperature == null ? "— °C" : `${weather.temperature.toFixed(0)}°C`;
        condition.textContent = weather.condition || "Weather unavailable";
        wind.textContent = weather.wind == null ? "Wind —" : `Wind ${weather.wind.toFixed(0)} km/h`;
        lastSuccessful = time.textContent;
        weatherAvailable = true;
        window.__MM_SCENE__?.applyLiveWeather?.(weather);
        state.liveWeather = { ...weather, fetchedAt: new Date().toISOString(), label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
      } catch (error) {
        if (error?.name === "AbortError" || serial !== requestSerial) return;
        weatherAvailable = false;
        state.liveWeather = { error: error?.message || "Weather unavailable", label: point?.label ?? null };
        document.dispatchEvent(new CustomEvent("chainage-weather", { detail: state.liveWeather }));
        temperature.textContent = "— °C";
        condition.textContent = "Weather unavailable";
        wind.textContent = "Wind —";
        time.textContent = lastSuccessful ? `Last ${lastSuccessful}` : "Unavailable";
        dateEl.textContent = dateFmt.format(new Date());
      }
    }, 600);
  }

  function openDetail() {
    void detail.show(lastPoint);
  }
  el.querySelector("#weather-icon-btn")?.addEventListener("click", openDetail);
  el.querySelector("#weather-open-detail")?.addEventListener("click", openDetail);

  // Survey BOD/COD first (regular on-screen values), then upgrade to JalNetra live.
  void showSurveyBodCodNow();
  void ensureBodData(true);
  void renderDischarge();
  // Refresh regularly: re-paint survey + retry live every 10 minutes
  const bodRefreshTimer = window.setInterval(() => {
    void showSurveyBodCodNow();
    void ensureBodData(true);
  }, 10 * 60 * 1000);

  return {
    el,
    updateForChainage,
    updateFromJoiningStream,
    openDetail,
    dispose: () => {
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
      window.clearInterval(weatherRefreshTimer);
      window.clearInterval(bodRefreshTimer);
      document.removeEventListener("bod-cod-time-change", onBodCodTime);
      document.removeEventListener("joining-stream-wq", onJoiningStreamWq);
      document.removeEventListener("pollution-hotspot-select", onPollutionHotspotSelect);
      document.removeEventListener("pollution-hotspot-toggle", onPollutionHotspotToggle);
      detail.dispose();
    },
  };
}
