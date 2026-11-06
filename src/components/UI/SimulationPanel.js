import { advanceSimulation, resetSimulation } from "../../api/simulationApi.js";
import { setState, subscribe } from "../../state.js";

export function createSimulationPanel({ state }) {
  const panel = document.createElement("div");
  panel.className = "analysis-panel glass-panel hidden";
  panel.id = "simulation-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-icon">⚡</span>
      <div><div class="panel-title">DATA SIMULATIONS</div><div class="panel-sub">HYDROLOGY MODEL</div></div>
      <button class="panel-close" id="sim-close" aria-label="Close">✕</button>
    </div>
    <div class="panel-body">
      <div class="sim-time">SIMULATION TIME<br><span id="sim-hour">Hour 000</span></div>
      <div class="sim-controls">
        <button class="sim-btn" data-h="-24">-24h</button>
        <button class="sim-btn" data-h="-6">-6h</button>
        <button class="sim-btn" data-h="-1">-1h</button>
        <button class="sim-btn" data-h="1">+1h</button>
        <button class="sim-btn" data-h="6">+6h</button>
        <button class="sim-btn" data-h="24">+24h</button>
      </div>
      <div class="sim-playback">
        <button id="sim-play" class="sim-play-btn" aria-label="Play simulation" title="Play (Space)">▶ PLAY</button>
        <button id="sim-reset" class="sim-btn" aria-label="Reset simulation" title="Reset">↺ RESET</button>
      </div>
      <div class="data-note">MODEL / SIMULATION — Not live gauge</div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#sim-close").addEventListener("click", () => panel.classList.add("hidden"));

  const hourEl = panel.querySelector("#sim-hour");
  function updateHour() { hourEl.textContent = `Hour ${String(state.simulationHour).padStart(3,"0")}`; }

  panel.querySelectorAll(".sim-btn[data-h]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const h = Number(btn.dataset.h);
      await advanceSimulation(h);
      setState({ simulationHour: state.simulationHour + h });
      updateHour();
    });
  });

  const playBtn = panel.querySelector("#sim-play");
  let playing = false;
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "⏸ PAUSE" : "▶ PLAY";
    setState({ simulationRunning: playing });
  });
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !e.target.matches("input,button")) {
      e.preventDefault();
      playBtn.click();
    }
  });
  panel.querySelector("#sim-reset").addEventListener("click", async () => {
    await resetSimulation();
    setState({ simulationHour: 0, simulationRunning: false });
    playing = false;
    playBtn.textContent = "▶ PLAY";
    updateHour();
  });

  return {
    panel,
    show() { panel.classList.remove("hidden"); updateHour(); },
    hide() { panel.classList.add("hidden"); },
  };
}
