/**
 * Hydrology Profile Service
 *
 * Orchestrates the complete pipeline:
 * 1. Loads authoritative 1,698 chainage stations & sounding depths
 * 2. Checks telemetry service for active gauge observations
 * 3. Solves 1D hydraulic profile using HydraulicProfileEngine
 * 4. Pushes results to HydrologyStore
 */

import { HydraulicProfileEngine } from "./hydraulicProfileEngine.js";
import { telemetryService, GAUGE_STATIONS } from "./hydrologyTelemetryService.js";
import { hydrologyStore } from "./hydrologyStore.js";
import { PROVENANCE_STATUS } from "./hydrologyContract.js";
import { startLiveHydrologyPolling, subscribeLiveHydrology, estimatedBaseflowM3s } from "./liveHydrologyService.js";
import { reseedForecastDischarge } from "../forecastService.js";
import { activeRiverPoint } from "../areaLive.js";

let _engineInstance = null;
let _initPromise = null;

/**
 * Bootstrap the hydrology profile service (idempotent).
 * @param {Array<{ chainage_m: number, width_m: number, lon: number, lat: number }>} [chainageData]
 * @param {Array<{ chainage_m: number, depth_m: number, flagged?: boolean }>} [soundingData]
 */
export async function initHydrologyProfileService(chainageData = null, soundingData = null) {
  if (!_initPromise) {
    _initPromise = (async () => {
      let stations = chainageData;
      let soundings = soundingData;

      // Ensure stations have required hydraulic properties (chainage_m, width_m)
      if (!stations || !stations.length || stations[0]?.width_m == null) {
        stations = await fetchJson("/data/naditwin/chainage_profile.json").catch(() => []);
      }
      if (!soundings || !soundings.length) {
        soundings = await fetchJson("/data/naditwin/depth_profile.json").catch(() => []);
      }

      if (!stations.length) {
        console.warn("[HydrologyProfileService] Chainage profile unavailable");
        return null;
      }

      _engineInstance = new HydraulicProfileEngine(stations, soundings);

      // Start live Open-Meteo polling (every 15 min, free, no API key)
      startLiveHydrologyPolling();

      // Re-solve hydraulic profile whenever new rainfall data arrives
      subscribeLiveHydrology((liveData) => {
        if (liveData?.available && Number.isFinite(liveData.Q_total)) {
          refreshHydrologyProfile({
            discharge_m3s: liveData.Q_total,
            source: liveData.provenance?.discharge || "LIVE_RIVER_DISCHARGE",
            provenance: PROVENANCE_STATUS.LIVE,
          });
          reseedForecastDischarge().catch(() => {});
          console.info(
            `[LiveHydrology] Profile updated: Q=${liveData.Q_total.toFixed(1)} m³/s`,
            liveData.provenance?.discharge || "",
          );
        }
      });

      // Attempt initial solve with verified telemetry or initial baseline
      await refreshHydrologyProfile();

      return _engineInstance;
    })();
  }
  return _initPromise;
}

/**
 * Solves the hydraulic profile given current boundary conditions.
 * @param {object} [customParams]
 * @param {number} [customParams.discharge_m3s]
 * @param {string} [customParams.source]
 * @param {string} [customParams.provenance]
 */
export async function refreshHydrologyProfile(customParams = {}) {
  if (!_engineInstance) {
    await initHydrologyProfileService();
  }
  if (!_engineInstance) return null;

  let Q = customParams.discharge_m3s ?? null;
  let source = customParams.source ?? "RIVER_DISCHARGE";
  let provenance = customParams.provenance ?? PROVENANCE_STATUS.LIVE;

  if (Q == null) {
    const gauge = nearbyGaugeObservation();
    if (gauge) {
      Q = gauge.value;
      source = gauge.source;
      provenance = gauge.status;
    } else {
      const { getCachedLiveHydrology } = await import("./liveHydrologyService.js");
      const live = getCachedLiveHydrology();
      if (live?.available && Number.isFinite(live.Q_total)) {
        Q = live.Q_total;
        source = live.provenance?.discharge || "LIVE_RIVER_DISCHARGE";
        provenance = PROVENANCE_STATUS.LIVE;
      } else {
        const estimate = estimatedBaseflowM3s();
        Q = Number.isFinite(estimate) ? estimate : 0;
        source = "CATCHMENT_ESTIMATE";
        provenance = PROVENANCE_STATUS.MODELLED ?? PROVENANCE_STATUS.LIVE;
      }
    }
  }

  const result = _engineInstance.solveProfile({
    upstreamQ_m3s: Q,
    dischargeSource: source,
    dischargeProvenance: provenance,
  });

  hydrologyStore.setHydraulicProfile(result);
  return result;
}

function nearbyGaugeObservation() {
  const river = activeRiverPoint();
  if (!river) return null;
  for (const gauge of GAUGE_STATIONS) {
    const dLat = (gauge.lat - river.lat) * 111;
    const dLon = (gauge.lon - river.lon) * 111 * Math.cos((river.lat * Math.PI) / 180);
    if (Math.hypot(dLat, dLon) > 25) continue;
    const obs = telemetryService.getObservation(gauge.stationId);
    const value = obs?.discharge?.value;
    if (value == null || !Number.isFinite(Number(value))) continue;
    return {
      value: Number(value),
      source: obs.discharge.source || gauge.stationName,
      status: obs.discharge.status,
    };
  }
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error(`HTTP not JSON ${url}`);
  return JSON.parse(text);
}
