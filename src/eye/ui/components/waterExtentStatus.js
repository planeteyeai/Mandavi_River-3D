/** Small chip: satellite water observation date (not a live gauge). */

export function mountWaterExtentStatus(root) {
  let el = root.querySelector("#water-extent-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "water-extent-status";
    el.className = "water-extent-status";
    el.hidden = true;
    root.appendChild(el);
  }

  function formatDay(iso) {
    if (!iso) return null;
    const d = String(iso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }

  return {
    /**
     * @param {{ asOf?: string|null, s1?: string|null, s2?: string|null, provenance?: string|null }} detail
     */
    show(detail = {}) {
      const day = formatDay(detail.asOf) || formatDay(detail.s1) || formatDay(detail.s2);
      const live = detail.provenance === "LIVE_JALNETRA_API";
      const cached = detail.provenance === "CACHED_JALNETRA_API";
      const source = live ? "latest satellite" : cached ? "cached satellite" : "bundled satellite";
      el.hidden = false;
      el.dataset.kind = live ? "live" : cached ? "cached" : "bundled";
      el.textContent = day ? `River water · ${source} · ${day}` : `River water · ${source}`;
      el.title =
        "Extent from Sentinel-1/2 via JalNetra — updates when the app fetches a newer scene (not a real-time gauge).";
    },
    hide() {
      el.hidden = true;
      el.textContent = "";
    },
    el,
  };
}
