import { setState, setActiveMode, subscribe } from "../../state.js";

const MODES = [
  { id: "forecast",    label: "Forecast" },
  { id: "hydrograph", label: "Hydrograph" },
  { id: "simulation", label: "Data Simulations" },
  { id: "flood",      label: "Flood Analysis" },
];

export function createTopBar({ state, scene, onModeChange, onKmlUpload }) {
  const bar = document.createElement("nav");
  bar.className = "top-bar";
  bar.setAttribute("role", "navigation");
  bar.innerHTML = `
    <div class="top-bar__brand">
      <div class="top-bar__logo">
        <span class="logo-eye">◉</span>
        <div class="logo-text">
          <strong>PLANET.EYE</strong>
          <small>AI RIVER INTELLIGENCE</small>
        </div>
      </div>
    </div>
    <div class="top-bar__title">MULA&ndash;MUTHA</div>
    
    <div style="margin-left: 1rem; display: flex; align-items: center;">
      <label class="nav-btn" style="cursor:pointer; font-size:12px; padding:6px 12px; margin:0;" title="Upload KML of River">
        Upload KML
        <input type="file" id="kml-upload" accept=".kml" style="display:none;" />
      </label>
    </div>
    <div class="top-bar__nav" role="menubar">
      ${MODES.map(m => `
        <button
          id="nav-${m.id}"
          class="nav-btn"
          role="menuitem"
          aria-label="${m.label} mode"
          title="${m.label}"
          data-mode="${m.id}"
        >${m.label}</button>
      `).join("")}
    </div>
    <div class="top-bar__weather" id="weather-badge">
      <span class="weather-icon">🌧</span>
      <span id="weather-temp">27°C</span>
      <span id="weather-desc">Drizzle</span>
    </div>
  `;
  document.body.appendChild(bar);

  const buttons = bar.querySelectorAll(".nav-btn");
  
  const fileInput = bar.querySelector("#kml-upload");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file && onKmlUpload) {
        onKmlUpload(file);
      }
      e.target.value = null; // reset
    });
  }

  buttons.forEach(btn => {
    if (btn.tagName === 'LABEL') return;
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      const current = state.activeMode;
      if (current === mode) {
        setActiveMode("overview");
        onModeChange?.("overview");
      } else {
        setActiveMode(mode);
        onModeChange?.(mode);
      }
    });
  });

  subscribe((s) => {
    buttons.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.mode === s.activeMode);
    });
  });
}
