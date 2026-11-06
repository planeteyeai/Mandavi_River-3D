import { setState, setLayer, subscribe } from "../../state.js";

const BUTTONS = [
  { id: "tb-layers",   icon: "⬡", label: "Layers",   tip: "Toggle layers" },
  { id: "tb-3d",       icon: "◈", label: "3D",        tip: "3D view" },
  { id: "tb-water",    icon: "≋", label: "Water",     tip: "Toggle water" },
  { id: "tb-flood",    icon: "⚠", label: "Flood",     tip: "Flood analysis" },
  { id: "tb-settings", icon: "⚙", label: "Settings",  tip: "Settings" },
];

export function createRightToolbar({ state, scene, onLayersToggle }) {
  const bar = document.createElement("div");
  bar.className = "right-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Map controls");
  bar.innerHTML = BUTTONS.map(b => `
    <button
      id="${b.id}"
      class="toolbar-btn"
      title="${b.tip}"
      aria-label="${b.label}"
      data-id="${b.id}"
    >
      <span class="tb-icon">${b.icon}</span>
      <span class="tb-label">${b.label}</span>
    </button>
  `).join("") + `
    <div class="toolbar-divider"></div>
    <button class="toolbar-btn zoom-btn" id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
    <button class="toolbar-btn zoom-btn" id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
  `;
  document.body.appendChild(bar);

  // Layers panel
  const layersPanel = document.createElement("div");
  layersPanel.className = "layers-panel glass-panel hidden";
  layersPanel.id = "layers-panel";
  layersPanel.innerHTML = `
    <div class="panel-title">LAYERS</div>
    ${["water","flow","chainage","buildings","vegetation","flood"].map(l => `
      <label class="layer-toggle">
        <input type="checkbox" data-layer="${l}" ${state.layers[l] ? "checked" : ""}/>
        <span class="toggle-track"></span>
        <span class="toggle-label">${l.charAt(0).toUpperCase() + l.slice(1)}</span>
      </label>
    `).join("")}
  `;
  document.body.appendChild(layersPanel);

  bar.querySelector("#tb-layers").addEventListener("click", () => {
    layersPanel.classList.toggle("hidden");
  });

  layersPanel.querySelectorAll("input[data-layer]").forEach(input => {
    input.addEventListener("change", () => {
      const name = input.dataset.layer;
      const visible = input.checked;
      setLayer(name, visible);
      scene.setLayer(name, visible);
    });
  });

  bar.querySelector("#tb-water").addEventListener("click", () => {
    const v = !state.layers.water;
    setLayer("water", v);
    scene.setLayer("water", v);
    bar.querySelector("#tb-water").classList.toggle("active", v);
  });

  // Compass
  const compass = document.createElement("div");
  compass.className = "compass";
  compass.innerHTML = `<div class="compass-n">N</div><div class="compass-ring">◎</div>`;
  document.body.appendChild(compass);
}
