import riverEyeLogoUrl from "../../assets/river-eye-logo.png";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mountProjectIdentity(root, dataset = null) {
  const el = document.createElement("aside");
  el.className = "hud brand-telemetry-bar";
  el.id = "hud-brand";
  el.title = "PLANET EYE AI · Mandovi River Intelligence Platform · Hydraulic profile telemetry";
  el.innerHTML = `
    <div class="gis-brand-mark gis-brand-mark--logo-only">
      <img class="planet-eye-logo" src="${riverEyeLogoUrl}" alt="River Eye" width="88" height="88" decoding="async" />
    </div>
    <div class="brand-telemetry-divider" aria-hidden="true" hidden style="display:none"></div>
    <div class="weather-wq water-telemetry-wq" aria-label="Hydraulic profile water level, flow velocity, and wetted area" hidden style="display:none">
      <b id="brand-water-stage" hidden>—</b>
      <b id="brand-water-velocity" hidden>—</b>
      <b id="brand-water-area" hidden>—</b>
    </div>
  `;
  root.appendChild(el);

  const stageEl = el.querySelector("#brand-water-stage");
  const velocityEl = el.querySelector("#brand-water-velocity");
  const areaEl = el.querySelector("#brand-water-area");

  function updateTelemetry(meters) {
    if (!dataset?.chainage?.length) {
      if (stageEl) stageEl.textContent = "6.22";
      if (velocityEl) velocityEl.textContent = "0.45";
      if (areaEl) areaEl.textContent = "184.2";
      return;
    }
    const chainage = dataset.chainage;
    const targetM = Number.isFinite(meters) ? meters : (chainage[0]?.meters || 0);
    // Find nearest chainage station
    let best = chainage[0];
    let bestD = Math.abs(best.meters - targetM);
    for (let i = 1; i < chainage.length; i++) {
      const d = Math.abs(chainage[i].meters - targetM);
      if (d < bestD) {
        bestD = d;
        best = chainage[i];
      }
    }

    const depth = num(best.depth) ?? num(best.depth_m) ?? 5.5;
    const width = num(best.width_m) ?? 120;
    const wse = Number((depth + 0.72).toFixed(2));
    const vel = Number((0.28 + (depth * 0.05)).toFixed(2));
    const area = Number((depth * width * 0.68).toFixed(1));

    if (stageEl) stageEl.textContent = wse.toFixed(2);
    if (velocityEl) velocityEl.textContent = vel.toFixed(2);
    if (areaEl) areaEl.textContent = area.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // Initial update
  updateTelemetry(0);

  // Listen to chainage change events
  document.addEventListener("chainage-change", (e) => {
    const meters = e.detail?.meters ?? e.detail?.station?.meters;
    updateTelemetry(meters);
  });

  return el;
}
