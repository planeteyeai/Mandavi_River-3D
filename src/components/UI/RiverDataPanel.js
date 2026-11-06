import { formatChainage } from "../../utils/chainageUtils.js";

export function createRiverDataPanel({ state, riverData }) {
  const panel = document.createElement("div");
  panel.className = "river-data-panel glass-panel";
  panel.id = "river-data-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-icon">🌊</span>
      <div>
        <div class="panel-title">RIVER DATA</div>
        <div class="panel-sub">MULA&ndash;MUTHA</div>
      </div>
    </div>
    <div class="data-rows">
      <div class="data-row"><span class="data-key">STATION</span><span class="data-val" id="rdp-station">0+000</span></div>
      <div class="data-row"><span class="data-key">DEPTH</span><span class="data-val" id="rdp-depth">— m</span></div>
      <div class="data-row"><span class="data-key">WIDTH</span><span class="data-val" id="rdp-width">— m</span></div>
      <div class="data-row"><span class="data-key">LAT</span><span class="data-val" id="rdp-lat">—</span></div>
      <div class="data-row"><span class="data-key">LON</span><span class="data-val" id="rdp-lon">—</span></div>
      <div class="data-row"><span class="data-key">STAGE</span><span class="data-val" id="rdp-stage">SIM</span></div>
      <div class="data-row"><span class="data-key">FLOW</span><span class="data-val" id="rdp-flow">MODEL</span></div>
    </div>
    <div class="status-badge safe" id="rdp-status">SAFE</div>
  `;
  document.body.appendChild(panel);

  return {
    update(station) {
      document.getElementById("rdp-station").textContent = formatChainage(station.chainageM);
      document.getElementById("rdp-depth").textContent = station.depth != null ? `${Number(station.depth).toFixed(2)} m` : "—";
      document.getElementById("rdp-width").textContent = station.width != null ? `${Number(station.width).toFixed(1)} m` : "—";
      document.getElementById("rdp-lat").textContent = station.lat != null ? Number(station.lat).toFixed(6) : "—";
      document.getElementById("rdp-lon").textContent = station.lon != null ? Number(station.lon).toFixed(6) : "—";
    }
  };
}
