import {
  Waves,
  Grid3x3,
  Landmark,
  Layers3,
  Layers,
  X,
  ChevronDown,
  MapPin,
  Mountain,
  Satellite,
  Route,
  Droplets,
} from "lucide";
import { lucideHtml } from "../icons.js";
import {
  layerRowHtml,
  bindAllLayerIndicators,
} from "./layerToggle.js";

/** User-facing layer checkbox IDs. */
const LAYER_IDS = [
  "water",
  "sat-drape",
  "map-ref-grid",
  "br-names",
  "osm-roads",
  "bridges-layer",
  "project-landmarks",
  "depth-zones",
  "water-surface-toggle",
  "riverbed-toggle",
  "survey-stations-toggle",
  "water-anim-toggle",
  "chain",
];

function sectionHtml(id, title, body, { open = true } = {}) {
  return `
    <details class="lp-section" id="${id}" ${open ? "open" : ""}>
      <summary class="lp-section-head">
        <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
        <span class="lp-section-title">${title}</span>
      </summary>
      <div class="lp-section-body">${body}</div>
    </details>`;
}

export function mountLayersPanel(root) {
  const panel = document.createElement("section");
  panel.className = "hud layers-panel lp-panel";
  panel.id = "layers-panel";
  panel.innerHTML = `
    <header class="layers-panel-header lp-header">
      <div class="lp-header-title">
        ${lucideHtml(Layers, { size: 16 })}
        <strong>LAYERS</strong>
      </div>
      <button type="button" class="layers-close lp-close" id="layers-close" aria-label="Close layers panel">
        ${lucideHtml(X, { size: 16 })}
      </button>
    </header>
    <div class="layers-panel-body lp-body">
      ${sectionHtml(
        "lp-sec-base",
        "Base Layers",
        `
        ${layerRowHtml({ icon: Mountain, label: "3D Terrain", id: "terrain-always", checked: true, hint: "always on" })}
        ${layerRowHtml({
          icon: Satellite,
          label: "Satellite Terrain Texture",
          id: "sat-drape",
          hint: "optional drape on 3D terrain",
        })}
        ${layerRowHtml({ icon: Route, label: "Roads", id: "osm-roads", checked: true })}
        ${layerRowHtml({ icon: Waves, label: "River System", id: "water", checked: true })}
        ${layerRowHtml({ icon: Landmark, label: "Bridges", id: "bridges-layer", checked: true })}
        ${layerRowHtml({ icon: Landmark, label: "Bridge Names", id: "br-names" })}
        ${layerRowHtml({ icon: Grid3x3, label: "Map Reference Grid", id: "map-ref-grid", hint: "KML + coordinates" })}
      `,
      )}

      ${sectionHtml(
        "lp-sec-landmarks",
        "Project Landmarks",
        `
        ${layerRowHtml({
          icon: MapPin,
          label: "All Project Landmarks",
          id: "project-landmarks",
          checked: true,
          hint: "Updates KMZ points",
        })}
        <div class="layers-stats lp-stats" id="project-landmarks-stats"></div>
        <div class="lp-landmark-list" id="project-landmarks-list"></div>
      `,
      )}

      ${sectionHtml(
        "lp-sec-depth",
        "Bathymetry & Water Depth",
        `
        <div class="depth-zones-section" id="depth-zones-section">
          ${layerRowHtml({
            icon: Layers3,
            label: "Bathymetry Colour Overlay",
            id: "depth-zones",
            hint: "0.5–8.0 m",
          })}
          ${layerRowHtml({ icon: Waves, label: "Water Surface", id: "water-surface-toggle", checked: true })}
          ${layerRowHtml({ icon: Mountain, label: "3D Riverbed Mesh", id: "riverbed-toggle", checked: true })}
          ${layerRowHtml({
            icon: MapPin,
            label: "Verified Survey Bathymetry / Stations",
            id: "survey-stations-toggle",
            checked: true,
            hint: "CSIR-NIO OBSERVED",
          })}
          <div class="layers-stats depth lp-stats" id="depth-zones-stats"></div>
        </div>
      `,
      )}

      ${sectionHtml(
        "lp-sec-water",
        "Water",
        `
        ${layerRowHtml({ icon: Droplets, label: "Water Animation", id: "water-anim-toggle", checked: true })}
        ${layerRowHtml({ icon: Mountain, label: "Riverbank", id: "riverbank-info", checked: true, hint: "carved into terrain" })}
      `,
      )}

    </div>
  `;
  root.appendChild(panel);

  // Terrain / riverbank rows are informational (always on)
  for (const id of ["terrain-always", "riverbank-info"]) {
    const inp = panel.querySelector(`#${id}`);
    if (inp) {
      inp.disabled = true;
      inp.checked = true;
      inp.closest(".lp-row")?.classList.add("is-on", "lp-row--locked");
    }
  }

  bindAllLayerIndicators(root, LAYER_IDS);

  return { panel, layerIds: LAYER_IDS };
}
