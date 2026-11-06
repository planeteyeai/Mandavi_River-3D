import { getHydrograph } from "../../api/hydrographApi.js";
import { formatChainage } from "../../utils/chainageUtils.js";

export function createHydrographPanel({ state }) {
  const panel = document.createElement("div");
  panel.className = "analysis-panel glass-panel hidden";
  panel.id = "hydrograph-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-icon">📉</span>
      <div><div class="panel-title">HYDROGRAPH</div><div class="panel-sub" id="hg-station">STATION 0+000</div></div>
      <button class="panel-close" id="hg-close" aria-label="Close">✕</button>
    </div>
    <div class="panel-body" id="hg-body">
      <div class="loading-msg">Select a station and load hydrograph.</div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#hg-close").addEventListener("click", () => panel.classList.add("hidden"));

  async function load(chainageM) {
    const sub = panel.querySelector("#hg-station");
    const body = panel.querySelector("#hg-body");
    if (sub) sub.textContent = `STATION ${formatChainage(chainageM)}`;
    body.innerHTML = '<div class="loading-msg">Loading hydrograph…</div>';
    const data = await getHydrograph(chainageM);
    if (!data) { body.innerHTML = '<div class="data-unavailable">DATA UNAVAILABLE<br><small>Backend not connected</small></div>'; return; }
    const obs = data.observed || []; const fcast = data.forecast || {};
    body.innerHTML = `
      <div class="hg-chart-wrap">
        <canvas id="hg-canvas" width="320" height="180"></canvas>
      </div>
      <div class="data-note">OBSERVED + MODEL FORECAST</div>
    `;
    // Simple sparkline
    const canvas = body.querySelector("#hg-canvas");
    if (canvas && obs.length) {
      const ctx = canvas.getContext("2d");
      const W = 320, H = 180, pad = 20;
      ctx.clearRect(0, 0, W, H);
      const vals = obs.map(v => typeof v === "object" ? v.value : v);
      const mn = Math.min(...vals), mx = Math.max(...vals) || mn + 1;
      const sx = (W - pad*2) / (vals.length - 1);
      const sy = (H - pad*2) / (mx - mn);
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2;
      ctx.beginPath();
      vals.forEach((v, i) => { const x = pad + i * sx, y = H - pad - (v - mn) * sy; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
    }
  }

  return {
    panel,
    show(chainageM) { panel.classList.remove("hidden"); load(chainageM); },
    hide() { panel.classList.add("hidden"); },
    reload(chainageM) { if (!panel.classList.contains("hidden")) load(chainageM); },
  };
}
