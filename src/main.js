import "./eye/style.css";
import "./eye/styles/gis-ui.css";
import "./eye/weather/weather.css";
import "./eye/styles/layers-panel.css";
import "./eye/styles/silt-pro.css";
import "./upload.css";

import { createWorld } from "./eye/scene/world.js";
import { createTooltip, mountCinematicOverlays, mountUI } from "./eye/ui/overlay.js";
import { createLoadingScene } from "./eye/loadingScene.js";
import { FALLBACK_WEATHER_LL } from "./eye/services/weatherService.js";
import { AQI_FALLBACK_LL } from "./eye/services/aqiService.js";
import { bindRiverSession } from "./eye/session/riverSession.js";
import { jalnetraEndpointIds, runJalNetra, tifDownloadUrl, waitForEndpoint } from "./eye/session/jalnetraClient.js";
import { clearLiveOverlay } from "./eye/session/liveLayers.js";
import { buildDatasetFromKml, prepareRiverUpload } from "./eye/geo/datasetFromKml.js";
import { loadFabdemDtmWithTimeout } from "./eye/geo/dtm.js";

const DB_NAME = "planet-eye-mandovi";
const STORE = "session";

function pad(n) {
  return String(n).padStart(2, "0");
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function yesterday() {
  const d = new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
}
function shiftDays(ymdText, days) {
  const [y, m, d] = ymdText.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSaved() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveSession(session) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(
        {
          kmlText: session.kmlText,
          filename: session.filename,
          riverName: session.riverName,
          start_date: session.start_date,
          end_date: session.end_date,
          centroid: session.centroid,
          catchmentKm2: session.catchmentKm2,
          mainStemKml: session.mainStemKml,
          fishingKmlText: session.fishingKmlText,
          results: session.results,
          errors: session.errors,
          siltDateFingerprints: session.siltDateFingerprints || {},
          ring: session.ring,
          line: session.line,
        },
        "current",
      );
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Could not store the river session", err);
  }
}

async function clearSaved() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete("current");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function watchRiverName(name) {
  let label = String(name || "Mandovi River").trim();
  label = label.replace(/\s+points\b/gi, "").replace(/\s+river\b/gi, "").trim();
  const title = label.toUpperCase();
  const apply = (node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return;
    const next = node.nodeValue.replace(/mula[\s\u2013\u2014-]*mutha/gi, title);
    if (next !== node.nodeValue) node.nodeValue = next;
  };
  const walk = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode();
    while (n) {
      apply(n);
      n = walker.nextNode();
    }
  };
  const brand = document.getElementById("river-name-label");
  if (brand) brand.textContent = `${title} RIVER`;
  const heading = document.getElementById("load-title");
  if (heading) heading.textContent = `${title.split(/\s+[–—-]\s+/)[0].trim()} RIVER 3D`;
  document.title = `${label} — Planet Eye AI River Intelligence`;
  walk(document.body);
  const obs = new MutationObserver(() => walk(document.body));
  obs.observe(document.body, { subtree: true, childList: true, characterData: true });
}

function statusPill() {
  const el = document.getElementById("api-status");
  const ids = jalnetraEndpointIds();
  const states = Object.fromEntries(ids.map((id) => [id, "wait"]));
  const draw = () => {
    const ok = ids.filter((id) => states[id] === "ok").length;
    const bad = ids.filter((id) => states[id] === "error").length;
    const run = ids.filter((id) => states[id] === "running").length;
    el.hidden = false;
    el.innerHTML = `<b>JALNETRA</b>${ok}/${ids.length} layers ready${run ? ` · ${run} running` : ""}${bad ? ` · ${bad} unavailable` : ""}`;
    if (ok + bad === ids.length) {
      setTimeout(() => {
        el.hidden = true;
      }, 6000);
    }
  };
  return {
    update(evt) {
      states[evt.id] = evt.state === "ok" ? "ok" : evt.state === "error" ? "error" : "running";
      draw();
    },
    show() {
      draw();
    },
  };
}

async function getDefaultMandoviRiver() {
  try {
    const res = await fetch("/data/mandovi/mandovi_river.kml");
    if (!res.ok) throw new Error("Could not fetch default KML");
    const text = await res.text();
    const maxDay = yesterday();
    const initialResults = {};
    try {
      const [wqRes, wdRes] = await Promise.all([
        fetch("/data/mandovi/water_quality.json"),
        fetch("/data/mandovi/water_depth.json"),
      ]);
      if (wqRes.ok) initialResults["water-quality"] = await wqRes.json();
      if (wdRes.ok) initialResults["water-depth"] = await wdRes.json();
    } catch {}
    return {
      saved: false,
      fileText: text,
      filename: "Mandovi_River_Coordinates_Cleaned.kml",
      start_date: shiftDays(maxDay, -29),
      end_date: maxDay,
      initialResults,
    };
  } catch (err) {
    console.warn("Default KML fetch error", err);
    return null;
  }
}

function askForKml(saved) {
  const gate = document.getElementById("upload-gate");
  const loading = document.getElementById("loading");
  const endInput = document.getElementById("kml-end");
  const savedBox = document.getElementById("saved-river");
  loading.classList.add("hidden");
  gate.hidden = false;
  const maxDay = yesterday();
  endInput.max = maxDay;
  endInput.value = maxDay;
  if (saved?.riverName) {
    savedBox.hidden = false;
    savedBox.innerHTML = `<p>Saved river: <strong>${saved.riverName}</strong></p><button type="button" class="gate-continue gate-go" id="continue-river">Continue ${saved.riverName}</button>`;
  }
  return new Promise((resolve) => {
    document.getElementById("continue-river")?.addEventListener("click", () => {
      gate.hidden = true;
      loading.classList.remove("hidden");
      resolve({ saved: true });
    });
    document.getElementById("upload-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = document.getElementById("kml-file").files?.[0];
      if (!file) return;
      let end = endInput.value || maxDay;
      if (end >= ymd(new Date())) end = maxDay;
      const start = shiftDays(end, -29);
      const text = await file.text();
      gate.hidden = true;
      loading.classList.remove("hidden");
      resolve({
        saved: false,
        fileText: text,
        filename: file.name,
        start_date: start,
        end_date: end,
      });
    });
  });
}

async function dtmFromBody(dataset, body) {
  if (!body) return null;
  const refs = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.tif_id || node.tif_download_url || node.download_url) refs.push(node);
    if (Array.isArray(node)) node.forEach(walk);
    else Object.values(node).forEach((v) => {
      if (v && typeof v === "object") walk(v);
    });
  };
  walk(body);
  const ref = refs[0];
  const url = tifDownloadUrl("fabdem-dtm", ref?.tif_download_url || ref?.download_url || ref?.tif_id);
  if (!url) return null;
  return loadFabdemDtmWithTimeout(
    url,
    dataset.frame,
    dataset.corridor,
    () => {},
    120000,
    { maxSampleDim: 512 },
  );
}

async function maybeDtm(dataset) {
  // First load prebundled high-res Mandovi FABDEM DTM with full 3D topography
  try {
    const localDtm = await loadFabdemDtmWithTimeout(
      "/data/mandovi/fabdem_dtm.tif",
      dataset.frame,
      dataset.corridor,
      () => {},
      15000,
      { maxSampleDim: 512 }
    );
    if (localDtm) {
      dataset.dtm = localDtm;
      console.info("Loaded high-resolution Mandovi FABDEM DTM:", localDtm);
      return;
    }
  } catch (err) {
    console.warn("Local DTM load notice:", err.message);
  }

  const body = await waitForEndpoint("fabdem-dtm", 50000);
  if (!body) return;
  try {
    dataset.dtm = await dtmFromBody(dataset, body);
  } catch (err) {
    console.warn("FABDEM terrain skipped", err.message);
  }
}

function pointWeather(session) {
  if (session?.centroid) {
    FALLBACK_WEATHER_LL.lat = session.centroid.lat;
    FALLBACK_WEATHER_LL.lon = session.centroid.lon;
    AQI_FALLBACK_LL.lat = session.centroid.lat;
    AQI_FALLBACK_LL.lon = session.centroid.lon;
  } else {
    // Mandovi River, Panaji, Goa
    FALLBACK_WEATHER_LL.lat = 15.4989;
    FALLBACK_WEATHER_LL.lon = 73.8278;
    AQI_FALLBACK_LL.lat = 15.4989;
    AQI_FALLBACK_LL.lon = 73.8278;
  }
}

async function boot() {
  const loading = document.getElementById("loading");
  const loadMsg = document.getElementById("load-msg");
  const loadBar = document.getElementById("load-bar");
  const loadPercent = document.getElementById("load-percent");
  const canvas = document.getElementById("scene");
  const uiRoot = document.getElementById("ui-root");
  const loadingScene = createLoadingScene(document.getElementById("loading-scene"));
  const pill = statusPill();

  let target = 0;
  let shown = 0;
  let frame = 0;
  function paint() {
    shown += (target - shown) * 0.12;
    if (Math.abs(target - shown) < 0.08) shown = target;
    if (loadBar) loadBar.style.width = `${shown}%`;
    if (loadPercent) loadPercent.textContent = `${Math.round(shown)}%`;
    if (shown !== target || !loading.classList.contains("hidden")) frame = requestAnimationFrame(paint);
    else frame = 0;
  }
  function progress(p, msg) {
    target = Math.max(0, Math.min(100, Number(p) * 100));
    if (msg && loadMsg) loadMsg.textContent = msg;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const forceUpload = urlParams.get("upload") === "true";

    const saved = await loadSaved();
    let choice = null;

    if (!forceUpload) {
      const defaultChoice = await getDefaultMandoviRiver();
      if (defaultChoice) {
        choice = defaultChoice;
      } else if (saved?.kmlText) {
        choice = { saved: true };
      }
    }

    if (!choice) {
      choice = await askForKml(saved);
    }

    let prepared;
    let session;
    if (choice.saved && saved?.kmlText) {
      prepared = prepareRiverUpload(saved.kmlText, saved.filename);
      const kmlChanged = prepared.kmlText !== saved.kmlText;
      const results = kmlChanged ? {} : { ...(saved.results || {}) };
      const errors = kmlChanged ? {} : { ...(saved.errors || {}) };
      for (const id of ["salinity", "water-quality", "lithology", "vegetation-type", "vegetation-health"]) {
        delete results[id];
        delete errors[id];
      }
      for (const id of ["bank-erosion", "water-depth", "lulc", "silt", "silt-classification", "silt-volume"]) {
        if (/GeometryCollection|Unsupported geometry/i.test(String(errors[id] || ""))) {
          delete results[id];
          delete errors[id];
        }
      }
      // Drop legacy combined silt cache — classification + volume are separate routes now.
      if (results.silt && !results["silt-classification"]) {
        results["silt-classification"] = results.silt;
      }
      delete results.silt;
      delete errors.silt;
      clearLiveOverlay();
      session = bindRiverSession({
        ...prepared,
        riverName: prepared.riverName || "Mandovi River",
        start_date: saved.start_date,
        end_date: saved.end_date,
        results,
        errors,
        siltDateFingerprints: kmlChanged ? {} : { ...(saved.siltDateFingerprints || {}) },
        fishingKmlText: kmlChanged ? "" : (saved.fishingKmlText || ""),
        pending: {},
      });
    } else {
      prepared = prepareRiverUpload(choice.fileText, choice.filename);
      clearLiveOverlay();
      session = bindRiverSession({
        ...prepared,
        riverName: prepared.riverName || "Mandovi River",
        start_date: choice.start_date,
        end_date: choice.end_date,
        results: choice.initialResults || {},
        errors: {},
        siltDateFingerprints: {},
        pending: {},
      });
    }

    watchRiverName(session.riverName);
    if (!session.results["water-depth"]) {
      try {
        const wdRes = await fetch("/data/mandovi/water_depth.json");
        if (wdRes.ok) session.results["water-depth"] = await wdRes.json();
      } catch {}
    }
    pointWeather(session);
    pill.show();
    // Silt classification + volume POST immediately in parallel (no queue delay).
    runJalNetra((evt) => {
      pill.update(evt);
      if (evt.state === "ok" || evt.state === "error") saveSession(session);
    });

    progress(0.15, `Reading ${session.riverName}…`);
    const dataset = await buildDatasetFromKml(prepared, progress);
    window.__RIVER_DATASET__ = dataset;

    progress(0.45, "Loading full 3D elevation topography…");
    await maybeDtm(dataset);

    progress(0.85, "Constructing 3D river digital twin…");

    const tooltip = createTooltip(uiRoot);
    mountCinematicOverlays(uiRoot, dataset);
    let sceneReady = false;
    const app = await createWorld(canvas, dataset, tooltip, {
      onCoreReady() {
        if (sceneReady) return;
        sceneReady = true;
        progress(1, "Ready");
        loading.classList.add("hidden");
        loadingScene.setVisible(false);
      },
    });
    if (!sceneReady) {
      progress(1, "Ready");
      loading.classList.add("hidden");
      loadingScene.setVisible(false);
    }

    mountUI(uiRoot, {
      dataset,
      onCamera: (mode) => app.setCamera(mode),
      onCompass: (dir) => app.rotateCompass(dir),
      onResetOrientation: () => app.resetOrientation(),
      onZoomIn: () => app.zoomIn(),
      onZoomOut: () => app.zoomOut(),
      onStartWaterFlow: () => app.startWaterFlow(),
      onTogglePauseWaterFlow: () => app.togglePauseWaterFlow(),
      isCinematicActive: () => app.isCinematicActive(),
      isCinematicPaused: () => app.isCinematicPaused(),
    });

    // Upload / Change KML control removed from the brand bar (Mandovi is fixed).
    watchRiverName(session.riverName);
    if (!session.results["water-depth"]) {
      try {
        const wdRes = await fetch("/data/mandovi/water_depth.json");
        if (wdRes.ok) session.results["water-depth"] = await wdRes.json();
      } catch {}
    }

    let last = performance.now();
    let budget = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      const raw = (now - last) / 1000;
      last = now;
      const q = app.getQuality?.() || { targetFps: 60 };
      const minDt = 1 / Math.max(20, q.targetFps || 60);
      budget += raw;
      if (budget < minDt * 0.92) return;
      const dt = Math.min(0.05, budget);
      budget = 0;
      app.update(dt);
    }
    requestAnimationFrame(loop);
    saveSession(session);
  } catch (err) {
    console.error(err);
    if (loadMsg) loadMsg.textContent = err?.message || String(err);
    target = 100;
    if (loadBar) {
      loadBar.style.width = "100%";
      loadBar.style.background = "#c45";
    }
  }
}

boot();
