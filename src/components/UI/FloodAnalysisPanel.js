import { getMargins, getAlerts } from "../../api/riverApi.js";

export function createFloodAnalysisPanel({ scene }) {
  const panel = document.createElement("div");
  panel.className = "analysis-panel glass-panel hidden";
  panel.id = "flood-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-icon">🌊</span>
      <div><div class="panel-title">FLOOD ANALYSIS</div><div class="panel-sub">RISK ASSESSMENT</div></div>
      <button class="panel-close" id="flood-close" aria-label="Close">✕</button>
    </div>
    <div class="panel-body">
      <div class="flood-status-row">
        <div class="flood-badge safe" id="flood-status">SAFE</div>
        <div class="flood-margin" id="flood-margin">Margin: —</div>
      </div>
      <div id="flood-alerts" class="flood-alerts"></div>
      <div class="data-note">⚠ Flood extent requires DEM integration for real inundation</div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#flood-close").addEventListener("click", () => panel.classList.add("hidden"));

  async function load() {
    const [margins, alerts] = await Promise.all([getMargins(), getAlerts()]);
    if (margins) {
      const statusEl = panel.querySelector("#flood-status");
      const marginEl = panel.querySelector("#flood-margin");
      const status = margins.status || "SAFE";
      statusEl.textContent = status;
      statusEl.className = `flood-badge ${status.toLowerCase()}`;
      marginEl.textContent = margins.margin_m != null ? `Margin: ${margins.margin_m.toFixed(2)} m` : "Margin: —";
    }
    if (alerts?.length) {
      panel.querySelector("#flood-alerts").innerHTML = alerts.map(a =>
        `<div class="flood-alert ${(a.level||"").toLowerCase()}"><span>${a.level || "INFO"}</span> ${a.message || ""}</div>`
      ).join("");
    }
  }

  return {
    panel,
    show() { panel.classList.remove("hidden"); load(); },
    hide() { panel.classList.add("hidden"); },
  };
}
