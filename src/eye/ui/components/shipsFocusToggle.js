import { Ship } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";

/**
 * Left-side Ships on/off control — only while a submenu (map-focus) is open.
 * Default: ON (ships stay visible under Water Quality / Pollution / Geology / etc.).
 */
export function mountShipsFocusToggle(root) {
  let host = document.getElementById("left-ui-stack");
  if (!host) {
    host = document.createElement("div");
    host.id = "left-ui-stack";
    host.className = "left-ui-stack";
    root.appendChild(host);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ships-focus-toggle";
  btn.className = "ships-focus-toggle map-chrome";
  btn.hidden = true;
  btn.setAttribute("aria-pressed", "true");
  btn.title = "Ships on";
  btn.innerHTML = `
    <span class="ships-focus-toggle__icon" aria-hidden="true">${lucideHtml(Ship, {
      size: 18,
      strokeWidth: 1.85,
    })}</span>
    <span class="ships-focus-toggle__copy">
      <strong>Ships</strong>
      <em class="ships-focus-toggle__state">On</em>
    </span>
  `;
  host.prepend(btn);

  const stateEl = btn.querySelector(".ships-focus-toggle__state");

  function applyShips(on) {
    state.shipsVisibleInFocus = !!on;
    window.__MM_SCENE__?.setShipsVisible?.(!!on);
    btn.classList.toggle("is-on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Ships on" : "Ships off";
    if (stateEl) stateEl.textContent = on ? "On" : "Off";
  }

  function submenuActive() {
    return !!(
      state.mapFocusKind ||
      root.classList.contains("map-focus") ||
      root.classList.contains("water-quality-open") ||
      root.classList.contains("pollution-hud-open") ||
      root.classList.contains("land-use-open") ||
      root.classList.contains("geology-open") ||
      root.classList.contains("climate-focus") ||
      root.classList.contains("aqi-focus")
    );
  }

  function syncChrome() {
    const on = submenuActive();
    btn.hidden = !on;
    if (on) {
      // Entering any submenu → ships default ON unless user flipped them off.
      if (state.shipsVisibleInFocus == null) state.shipsVisibleInFocus = true;
      applyShips(state.shipsVisibleInFocus !== false);
    } else {
      // Leave submenu → restore ships on the map.
      applyShips(true);
      state.shipsVisibleInFocus = true;
    }
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyShips(!(state.shipsVisibleInFocus !== false));
  });

  const onChrome = () => syncChrome();
  document.addEventListener("map-focus-change", onChrome);
  document.addEventListener("analytics-submenu-change", onChrome);

  // Initial: hidden until a submenu opens; ships stay visible.
  state.shipsVisibleInFocus = true;
  applyShips(true);
  syncChrome();

  return {
    el: btn,
    setVisible(on) {
      applyShips(on);
    },
    dispose() {
      document.removeEventListener("map-focus-change", onChrome);
      document.removeEventListener("analytics-submenu-change", onChrome);
      btn.remove();
    },
  };
}
