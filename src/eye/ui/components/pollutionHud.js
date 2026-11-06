import { Atom, Fish, Hexagon } from "lucide";
import { lucideHtml } from "../icons.js";

/**
 * Pollution floating HUD — icon-only; name on hover only.
 * Eutrophication · Nitrogen · BOD–COD (mutually exclusive toggles).
 * (Coliform lives under Water Quality.)
 */
export const POLLUTION_OPTIONS = [
  {
    id: "eutrophication",
    tip: "Eutrophication",
    icon: Fish,
    tone: "poll-tone-eutro",
    layerId: "pollution_eutrophication",
  },
  {
    id: "nitrogen",
    tip: "Nitrogen",
    icon: Atom,
    tone: "poll-tone-nitrogen",
    layerId: "pollution_nitrogen",
  },
  {
    id: "bod_cod",
    tip: "BOD–COD",
    icon: Hexagon,
    tone: "poll-tone-bod",
    layerId: "bod_cod",
  },
];

/**
 * @param {HTMLElement} root
 * @param {{ onSelect?: (opt: object) => void|Promise<void>, onClose?: () => void }} [hooks]
 */
export function mountPollutionHud(root, hooks = {}) {
  const wrap = document.createElement("div");
  wrap.className = "poll-hud";
  wrap.id = "pollution-hud";
  wrap.hidden = true;
  wrap.setAttribute("role", "toolbar");
  wrap.setAttribute("aria-label", "Pollution layers");

  wrap.innerHTML = `
    <div class="poll-hud__row">
      ${POLLUTION_OPTIONS.map(
        (o) => `
        <button type="button"
          class="poll-hud__item ${o.tone}"
          data-poll="${o.id}"
          data-tip="${escapeAttr(o.tip)}"
          aria-label="${escapeAttr(o.tip)}"
          aria-pressed="false"
          title="">
          <span class="poll-hud__icon" aria-hidden="true">${lucideHtml(o.icon, {
            size: 26,
            strokeWidth: 1.75,
            className: "poll-hud__svg",
          })}</span>
          <span class="poll-hud__dot" aria-hidden="true"></span>
        </button>`,
      ).join("")}
    </div>
    <p class="poll-hud__status" id="poll-hud-status" hidden></p>
  `;

  // Body mount escapes #ui-root overflow:hidden clipping of fixed HUD.
  document.body.appendChild(wrap);

  const statusEl = wrap.querySelector("#poll-hud-status");
  let activeId = null;
  let open = false;

  function setActiveOption(id) {
    activeId = id;
    wrap.querySelectorAll(".poll-hud__item").forEach((btn) => {
      const on = btn.dataset.poll === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setStatus(html, { unavailable = false } = {}) {
    if (!statusEl) return;
    if (!html) {
      statusEl.hidden = true;
      statusEl.innerHTML = "";
      statusEl.classList.remove("is-unavail");
      return;
    }
    statusEl.hidden = false;
    statusEl.classList.toggle("is-unavail", !!unavailable);
    statusEl.innerHTML = html;
  }

  function positionUnderPollutionIcon() {
    // When a pollution raster is active, lift icons to the top bar slot (like WQ / TSS).
    if (
      root.classList.contains("pollution-focus") ||
      document.getElementById("ui-root")?.classList.contains("pollution-focus")
    ) {
      wrap.classList.add("poll-hud--top");
      wrap.style.left = "50%";
      wrap.style.top = `calc(max(14px, env(safe-area-inset-top)) + 12px)`;
      wrap.style.transform = "translateX(-50%)";
      return;
    }
    wrap.classList.remove("poll-hud--top");
    const btn = document.querySelector('.analytics-controls [data-analytics="Pollution"]');
    if (!btn || btn.offsetParent === null) {
      wrap.style.left = "50%";
      wrap.style.top = "calc(max(14px, env(safe-area-inset-top)) + 78px)";
      wrap.style.transform = "translateX(-50%)";
      return;
    }
    const r = btn.getBoundingClientRect();
    wrap.style.left = `${Math.round(r.left + r.width / 2)}px`;
    wrap.style.top = `${Math.round(r.bottom + 14)}px`;
    wrap.style.transform = "translateX(-50%)";
  }

  wrap.querySelectorAll("[data-poll]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.poll;
      const opt = POLLUTION_OPTIONS.find((o) => o.id === id);
      if (!opt) return;
      setStatus("");
      try {
        await hooks.onSelect?.(opt);
      } catch (err) {
        setStatus(
          `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
          { unavailable: true },
        );
      }
      positionUnderPollutionIcon();
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  function onResize() {
    if (open) positionUnderPollutionIcon();
  }

  function show() {
    open = true;
    positionUnderPollutionIcon();
    wrap.hidden = false;
    wrap.removeAttribute("hidden");
    wrap.style.display = "flex";
    wrap.style.opacity = "1";
    void wrap.offsetWidth;
    wrap.classList.add("is-open");
    root.classList.add("pollution-hud-open");
    document.getElementById("ui-root")?.classList.add("pollution-hud-open");
    window.addEventListener("resize", onResize);
    // Reposition after layout (nav tip chrome may shift).
    requestAnimationFrame(() => {
      if (open) positionUnderPollutionIcon();
    });
  }

  function hide() {
    open = false;
    wrap.classList.remove("is-open", "poll-hud--top");
    root.classList.remove("pollution-hud-open");
    document.getElementById("ui-root")?.classList.remove("pollution-hud-open");
    wrap.style.opacity = "";
    wrap.style.display = "";
    window.removeEventListener("resize", onResize);
    setActiveOption(null);
    setStatus("");
    window.setTimeout(() => {
      if (!open) {
        wrap.hidden = true;
        wrap.setAttribute("hidden", "");
      }
    }, 180);
    hooks.onClose?.();
  }

  function isOpen() {
    return open;
  }

  function getActiveOptionId() {
    return activeId;
  }

  return {
    el: wrap,
    show,
    hide,
    isOpen,
    setActiveOption,
    setStatus,
    getActiveOptionId,
    reposition: positionUnderPollutionIcon,
  };
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
