import { getForecastProfile } from "../../api/forecastApi.js";

export function createForecastPanel() {
  const panel = document.createElement("div");
  panel.className = "analysis-panel glass-panel hidden";
  panel.id = "forecast-panel";
  panel.innerHTML = `
    <div class="panel-header"><span class="panel-icon">📈</span><div><div class="panel-title">FORECAST</div><div class="panel-sub">MULA–MUTHA</div></div><button class="panel-close" id="forecast-close" aria-label="Close">✕</button></div>
    <div class="panel-body">
      <label class="field-label">LEAD TIME <span id="lead-val">24h</span></label>
      <input type="range" id="lead-slider" min="1" max="72" step="1" value="24" class="analysis-slider" aria-label="Forecast lead time" />
      <div id="forecast-content" class="forecast-content">
        <div class="loading-msg">Loading forecast…</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#forecast-close").addEventListener("click", () => panel.classList.add("hidden"));

  let currentLead = 24;
  const leadSlider = panel.querySelector("#lead-slider");
  const leadVal = panel.querySelector("#lead-val");
  leadSlider.addEventListener("input", () => {
    currentLead = Number(leadSlider.value);
    leadVal.textContent = `${currentLead}h`;
    loadForecast(currentLead);
  });

  async function loadForecast(lead) {
    const content = panel.querySelector("#forecast-content");
    content.innerHTML = '<div class="loading-msg">Loading…</div>';
    const data = await getForecastProfile(lead);
    if (!data) { content.innerHTML = '<div class="data-unavailable">DATA UNAVAILABLE</div>'; return; }
    const p10 = data.p10 ?? "—"; const p50 = data.median ?? data.p50 ?? "—"; const p90 = data.p90 ?? "—";
    content.innerHTML = `
      <div class="forecast-bands">
        <div class="band p10"><span class="band-label">P10</span><div class="band-bar" style="width:${Math.min(100,(p10/5)*100)}%"></div><span class="band-val">${typeof p10 === "number" ? p10.toFixed(2)+" m" : p10}</span></div>
        <div class="band p50"><span class="band-label">MEDIAN</span><div class="band-bar" style="width:${Math.min(100,(p50/5)*100)}%"></div><span class="band-val">${typeof p50 === "number" ? p50.toFixed(2)+" m" : p50}</span></div>
        <div class="band p90"><span class="band-label">P90</span><div class="band-bar" style="width:${Math.min(100,(p90/5)*100)}%"></div><span class="band-val">${typeof p90 === "number" ? p90.toFixed(2)+" m" : p90}</span></div>
      </div>
      <div class="data-note">MODEL / SIMULATION DATA</div>
    `;
  }

  return {
    panel,
    show() { panel.classList.remove("hidden"); loadForecast(currentLead); },
    hide() { panel.classList.add("hidden"); },
  };
}
