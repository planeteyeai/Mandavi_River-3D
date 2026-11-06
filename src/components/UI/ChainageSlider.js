import { formatChainage, getStationAtChainage, generateTicks } from "../../utils/chainageUtils.js";
import { setState } from "../../state.js";

export function createChainageSlider({ state, riverData, scene, onStationChange }) {
  const chainages = riverData.chainage_m || riverData.chainage || [];
  const maxM = Math.min(chainages[chainages.length - 1] || 16000, 16000);
  const ticks = generateTicks(maxM, 2000);

  const bar = document.createElement("div");
  bar.className = "chainage-bar";
  bar.setAttribute("aria-label", "Chainage navigation slider");
  bar.innerHTML = `
    <div class="chainage-info">
      <div class="chainage-label">CHAINAGE</div>
      <div class="chainage-value" id="chainage-display">0+000 <span class="chainage-badge">C</span></div>
      <div class="chainage-sub" id="chainage-depth-display"></div>
    </div>
    <div class="chainage-track-wrap">
      <div class="chainage-ticks">
        ${ticks.map(v => `<span style="left:${(v/maxM)*100}%">${formatChainage(v)}</span>`).join("")}
      </div>
      <input
        id="chainage-input"
        type="range"
        min="0"
        max="${maxM}"
        step="500"
        value="0"
        aria-label="Select chainage station"
        title="Drag to navigate river stations"
      />
    </div>
    <div class="chainage-nav">
      <button id="chainage-back" aria-label="Previous station" title="Previous station (Arrow Left)">&#8249;</button>
      <button id="chainage-forward" aria-label="Next station" title="Next station (Arrow Right)">&#8250;</button>
    </div>
  `;
  document.body.appendChild(bar);

  const input = bar.querySelector("#chainage-input");
  const display = bar.querySelector("#chainage-display");
  const depthDisplay = bar.querySelector("#chainage-depth-display");

  function update(value) {
    const station = getStationAtChainage(riverData, Number(value));
    state.selectedChainageM = station.chainageM;
    state.selectedStationIndex = station.index;
    display.innerHTML = `${formatChainage(station.chainageM)} <span class="chainage-badge">C</span>`;
    const depthStr = station.depth != null ? `${Number(station.depth).toFixed(2)} m` : "–";
    const widthStr = station.width != null ? `${Number(station.width).toFixed(1)} m` : "–";
    depthDisplay.textContent = `Depth ${depthStr}  ·  Width ${widthStr}`;
    setState({ selectedChainageM: station.chainageM, selectedStationIndex: station.index });
    scene.setStation(station);
    onStationChange?.(station);
  }

  input.addEventListener("input", e => update(e.target.value));

  bar.querySelector("#chainage-back").addEventListener("click", () => {
    input.value = Math.max(0, Number(input.value) - 500);
    update(input.value);
  });
  bar.querySelector("#chainage-forward").addEventListener("click", () => {
    input.value = Math.min(maxM, Number(input.value) + 500);
    update(input.value);
  });

  // Keyboard navigation
  document.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { input.value = Math.max(0, Number(input.value) - 500); update(input.value); }
    if (e.key === "ArrowRight") { input.value = Math.min(maxM, Number(input.value) + 500); update(input.value); }
  });

  update(0);
}
