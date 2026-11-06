import { ChevronLeft, ChevronRight } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { streamBodCodFor, bodLevel, codLevel, fmtMgL } from "../../data/streamsBodCod.js";

/**
 * Compact drainage navigator above the chainage ruler.
 * ‹  Name (D-n)  i / N  ›
 */
export function mountJoiningStreamsNav(root) {
  const el = document.createElement("div");
  el.className = "joining-streams-nav map-chrome";
  el.id = "joining-streams-nav";
  el.hidden = true;
  el.setAttribute("aria-label", "Joining streams navigation");
  el.innerHTML = `
    <button type="button" class="joining-streams-nav__btn" id="js-nav-prev" aria-label="Previous drainage">
      ${lucideHtml(ChevronLeft, { size: 18, strokeWidth: 2.25 })}
    </button>
    <div class="joining-streams-nav__body">
      <div class="joining-streams-nav__name" id="js-nav-name">—</div>
      <div class="joining-streams-nav__meta" id="js-nav-meta">0 / 0</div>
      <div class="joining-streams-nav__wq" id="js-nav-wq" hidden></div>
    </div>
    <button type="button" class="joining-streams-nav__btn" id="js-nav-next" aria-label="Next drainage">
      ${lucideHtml(ChevronRight, { size: 18, strokeWidth: 2.25 })}
    </button>
  `;
  root.appendChild(el);

  const nameEl = el.querySelector("#js-nav-name");
  const metaEl = el.querySelector("#js-nav-meta");
  const wqEl = el.querySelector("#js-nav-wq");

  function setWq(rec) {
    const q = rec ? streamBodCodFor(rec) : null;
    if (!wqEl) return;
    wqEl.hidden = !q;
    wqEl.innerHTML = q
      ? `<span class="jsl-wq" data-level="${bodLevel(q.bodMean)}">BOD <b>${fmtMgL(q.bodMean)}</b></span>` +
        `<span class="jsl-wq" data-level="${codLevel(q.codMean)}">COD <b>${fmtMgL(q.codMean)}</b></span>` +
        `<span class="jsl-wq-unit">mg/L</span>`
      : "";
  }

  el.querySelector("#js-nav-prev")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.__MM_SCENE__?.stepJoiningStream?.(-1);
  });
  el.querySelector("#js-nav-next")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.__MM_SCENE__?.stepJoiningStream?.(1);
  });
  el.querySelector("#js-nav-prev")?.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.querySelector("#js-nav-next")?.addEventListener("pointerdown", (e) => e.stopPropagation());

  function setVisible(on) {
    const show = !!on && !!state.joiningStreamsMode;
    el.hidden = !show;
    if (show) el.style.pointerEvents = "auto";
  }

  function update(rec, list = []) {
    const total = list.length || 0;
    if (!rec || !total) {
      if (nameEl) nameEl.textContent = "—";
      if (metaEl) metaEl.textContent = total ? `0 / ${total}` : "0 / 0";
      setWq(null);
      return;
    }
    const idx = rec.navigationNumber ?? (rec.navIndex ?? 0) + 1;
    const totalNav = rec.navigationCount || total;
    // Source name only — never fall back to D-ID / Unnamed …
    const raw = String(rec.displayName || rec.meta?.name || rec.meta?.nameEn || rec.name || "").trim();
    const name = raw && !/^unnamed\b/i.test(raw) ? raw : "";
    if (nameEl) {
      nameEl.textContent = name;
      nameEl.hidden = !name;
      nameEl.style.display = name ? "" : "none";
    }
    if (metaEl) metaEl.textContent = `${idx} / ${totalNav}`;
    setWq(rec);
  }

  window.__MM_JOINING_NAV__ = { update, setVisible, el };

  return {
    el,
    update,
    setVisible,
    dispose() {
      el.remove();
      if (window.__MM_JOINING_NAV__?.el === el) delete window.__MM_JOINING_NAV__;
    },
  };
}
