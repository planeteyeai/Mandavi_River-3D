/**
 * User-friendly pollution hotspot panel.
 * List = quick pick · detail card = full numbers (no duplicate walls of chips).
 */
export function mountPollutionHotspotPanel(root) {
  const el = document.createElement("aside");
  el.className = "poll-hotspot-panel map-chrome";
  el.id = "pollution-hotspot-panel";
  el.hidden = true;
  el.setAttribute("aria-label", "Pollution hotspots");
  root.appendChild(el);

  let open = false;
  /** @type {object | null} */
  let data = null;
  /** @type {object | null} */
  let selected = null;

  function friendlyClass(label) {
    const s = String(label || "");
    if (/highly\s*risk/i.test(s)) return "High risk";
    if (/hypereutrophic/i.test(s)) return "Very nutrient-rich";
    if (/eutrophic/i.test(s) && !/hyper/i.test(s)) return "Nutrient-rich";
    if (/mesotrophic/i.test(s)) return "Moderate nutrients";
    if (/oligotrophic/i.test(s)) return "Low nutrients";
    return s;
  }

  function detailRows(h) {
    if (!h) return "";
    const rows = [];
    const bod = h.maxBod ?? h.bod;
    const cod = h.maxCod ?? h.cod;
    if (Number.isFinite(Number(bod)) || Number.isFinite(Number(cod))) {
      rows.push({
        lab: "Organic load",
        val: `BOD ${fmt(bod)} · COD ${fmt(cod)} mg/L`,
        tip: "From Mandovi BOD/COD survey grid",
      });
    }
    const eutro = h.eutrophication;
    rows.push({
      lab: "Algae / nutrients",
      val: eutro?.valueText || eutro?.display
        ? `${friendlyClass(eutro.classLabel)} · ${eutro.valueText || eutro.display}`
        : "Not mapped at this point",
      tip: eutro?.display || "No eutrophication class pixel near this hotspot",
    });
    const nitro = h.nitrogen;
    rows.push({
      lab: "Nitrogen risk",
      val: nitro?.valueText || nitro?.display
        ? `${friendlyClass(nitro.classLabel)} · class ${nitro.valueText || "—"}`
        : "Not mapped at this point",
      tip: "Risk class only — not mg N/L",
    });
    const coli = h.coliform;
    rows.push({
      lab: "Bacteria (E. coli)",
      val: coli?.valueText || coli?.display
        ? `${friendlyClass(coli.classLabel)} · ${coli.valueText || coli.display}`
        : "Not mapped at this point",
      tip: coli?.display || "Coliform class from KML",
    });
    return `
      <dl class="php-facts">
        ${rows
          .map(
            (r) => `
          <div class="php-fact" title="${escapeAttr(r.tip)}">
            <dt>${escapeHtml(r.lab)}</dt>
            <dd>${escapeHtml(r.val)}</dd>
          </div>`,
          )
          .join("")}
      </dl>`;
  }

  function selectHotspot(h) {
    selected = h || null;
    const detail = el.querySelector("#php-detail");
    if (!detail) return;
    if (!h) {
      detail.innerHTML = `<p class="php-empty">Select a place in the list</p>`;
      return;
    }
    detail.style.setProperty("--php-red", h.color || "#E53935");
    detail.innerHTML = `
      <div class="php-detail-top">
        <span class="php-badge">${escapeHtml(h.shadeLabel || "Hotspot")}</span>
        <span class="php-score">${pct(h.composite)}</span>
      </div>
      <h3 class="php-place">${escapeHtml(h.name || "Hotspot")}</h3>
      <p class="php-meta">#${h.rank} · ${(h.layersPresent || []).length} pollution signals</p>
      ${detailRows(h)}
    `;
    el.querySelectorAll(".php-item").forEach((btn) => {
      const on = Number(btn.dataset.hotspotRank) === h.rank;
      btn.classList.toggle("is-active", on);
    });
  }

  function render() {
    if (!open) {
      el.hidden = true;
      return;
    }
    const list = data?.hotspots || [];
    if (!selected) selected = list[0] || data?.highest || null;

    const shades = data?.redShades || [];
    el.innerHTML = `
      <header class="php-head">
        <div>
          <h2 class="php-title">Pollution hotspots</h2>
          <p class="php-sub">Worst zones from survey + satellite layers</p>
        </div>
        <button type="button" class="php-close" id="php-close" aria-label="Close">×</button>
      </header>

      <div class="php-legend" aria-label="Severity colours">
        ${shades
          .map(
            (s) =>
              `<span style="--php-red:${escapeAttr(s.hex)}"><i></i>${escapeHtml(s.label)}</span>`,
          )
          .join("")}
      </div>

      <section class="php-detail" id="php-detail" aria-live="polite"></section>

      <p class="php-list-label">Ranked places — tap one</p>
      <ul class="php-list" role="list">
        ${list
          .map((h) => {
            const brief = listBrief(h);
            return `
            <li>
              <button type="button" class="php-item" style="--php-red:${escapeAttr(
                h.color || "#E53935",
              )}" data-hotspot-id="${escapeAttr(h.id)}" data-hotspot-rank="${h.rank}">
                <span class="php-rank">#${h.rank}</span>
                <span class="php-body">
                  <strong>${escapeHtml(h.name)}</strong>
                  <span class="php-brief">
                    <em class="php-level">${escapeHtml(h.shadeLabel || "")}</em>
                    ${brief}
                  </span>
                </span>
              </button>
            </li>`;
          })
          .join("")}
      </ul>
      <footer class="php-foot">Darker red = worse combined pollution</footer>
    `;
    el.hidden = false;

    el.querySelector("#php-close")?.addEventListener("click", (e) => {
      e.preventDefault();
      hide();
      document.dispatchEvent(new CustomEvent("pollution-hotspot-toggle", { detail: { open: false } }));
    });

    el.querySelectorAll("[data-hotspot-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const rank = Number(btn.dataset.hotspotRank);
        const h = list.find((x) => x.rank === rank) || list.find((x) => x.id === btn.dataset.hotspotId);
        if (!h) return;
        selectHotspot(h);
        window.__MM_SCENE__?.focusPollutionHotspot?.(h.id || h.rank);
      });
    });

    selectHotspot(selected);
  }

  async function show(payload) {
    open = true;
    if (payload) data = payload;
    selected = data?.hotspots?.[0] || data?.highest || null;
    if (!data) {
      el.hidden = false;
      el.innerHTML = `<p class="php-loading">Loading hotspots…</p>`;
      try {
        data = await window.__MM_SCENE__?.ensurePollutionHotspots?.();
        selected = data?.hotspots?.[0] || null;
      } catch (err) {
        el.innerHTML = `<p class="php-error">${escapeHtml(err?.message || "Failed to load")}</p>`;
        return;
      }
    }
    render();
  }

  function hide() {
    open = false;
    selected = null;
    el.hidden = true;
    window.__MM_NAV__?.setPollutionHotspotPressed?.(false);
    window.__MM_SCENE__?.setPollutionHotspotsVisible?.(false);
  }

  function isOpen() {
    return open;
  }

  return { el, show, hide, isOpen, render };
}

function listBrief(h) {
  const bits = [];
  if (Number.isFinite(h.maxBod) || Number.isFinite(h.maxCod)) {
    bits.push(`<em>BOD ${fmt(h.maxBod)}</em><em>COD ${fmt(h.maxCod)}</em>`);
  }
  const coli = h.coliform?.valueText || h.coliformValue;
  const nitro = h.nitrogen?.valueText || h.nitrogenValue;
  const eutro = h.eutrophication?.valueText || h.eutrophicationValue;
  if (coli) bits.push(`<em>Bacteria ${escapeHtml(coli)}</em>`);
  else if (nitro) bits.push(`<em>N ${escapeHtml(nitro)}</em>`);
  else if (eutro) bits.push(`<em>Algae ${escapeHtml(eutro)}</em>`);
  if (!bits.length) bits.push(`<em>${(h.layersPresent || []).length} layers</em>`);
  return bits.join("");
}

function fmt(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—";
}

function pct(v) {
  return Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)}%` : "—";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
