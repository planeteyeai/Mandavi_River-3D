/** Binary-search interpolation over the authoritative KML chainage points. */
export function interpolateChainage(points, meters) {
  const sorted = points || [];
  if (!sorted.length) return null;
  const value = Number(meters);
  if (!Number.isFinite(value)) return { ...sorted[0] };
  if (value <= sorted[0].meters) return { ...sorted[0], meters: sorted[0].meters };
  const last = sorted[sorted.length - 1];
  if (value >= last.meters) return { ...last, meters: last.meters };

  let lo = 0;
  let hi = sorted.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].meters <= value) lo = mid;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  const t = (value - a.meters) / Math.max(1e-9, b.meters - a.meters);
  const out = { ...a, meters: value, label: formatStation(value) };
  for (const key of ["lon", "lat", "x", "z", "easting", "northing", "depth", "depth_m", "width_m"]) {
    if (Number.isFinite(a[key]) && Number.isFinite(b[key])) out[key] = a[key] + (b[key] - a[key]) * t;
  }
  return out;
}

export function formatStation(meters) {
  const value = Math.max(0, Math.round(Number(meters) || 0));
  return `${Math.floor(value / 1000)}+${String(value % 1000).padStart(3, "0")}`;
}

/** Nearest chainage label to a local XZ point. */
export function nearestChainage(x, z, chainage) {
  if (!chainage?.length) return null;
  let best = chainage[0];
  let bestD = Infinity;
  for (const c of chainage) {
    const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = c;
    }
  }
  return { ...best, dist: Math.sqrt(bestD) };
}

// Mula–Mutha only — never use these names on Mandovi.
export const CHAINAGE_DESTINATIONS = [
  { id: "sangam", name: "Sangam", chainage_m: 565 },
  { id: "bund-garden", name: "Bund Garden", chainage_m: 3468 },
  { id: "dhanori", name: "Dhanori", chainage_m: 5915 },
  { id: "wadgaon-sheri", name: "Wadgaon Sheri", chainage_m: 7543 },
  { id: "hadapsar", name: "Hadapsar", chainage_m: 9136 },
  { id: "mundhwa", name: "Mundhwa", chainage_m: 9547 },
  { id: "kharadi", name: "Kharadi", chainage_m: 10712 },
  { id: "manjari", name: "Manjari", chainage_m: 15430 },
];

/** Mandovi place markers along reversed chainage (Old Goa 0+000 → Aguada 12+715). */
export const MANDOVI_CHAINAGE_DESTINATIONS = [
  { id: "old-goa", name: "Old Goa Confluence", chainage_m: 0 },
  { id: "divar", name: "Divar Island", chainage_m: 1515 },
  { id: "ribandar", name: "Ribandar / Chorao", chainage_m: 3515 },
  { id: "atal-setu", name: "Atal Setu / Mandovi Bridges", chainage_m: 5115 },
  { id: "panaji-port", name: "Panaji Port / Betim", chainage_m: 6515 },
  { id: "panaji-west", name: "Panaji / Kala Academy", chainage_m: 7915 },
  { id: "miramar", name: "Miramar / Campal", chainage_m: 9215 },
  { id: "reis-magos", name: "Reis Magos Fort Reach", chainage_m: 10715 },
  { id: "aguada", name: "Aguada Bay", chainage_m: 12715 },
];

export function getDestinations(sel, customList = null) {
  let prev = null;
  let next = null;
  let current = null;
  let list = Array.isArray(customList) && customList.length > 0 ? customList : null;
  if (!list) {
    const rName = window.__RIVER_SESSION__?.riverName || window.__RIVER_DATASET__?.riverName || "";
    const isMandovi = /mandov|mandav/i.test(rName) || window.__RIVER_DATASET__?.isMandovi;
    if (window.__RIVER_DATASET__?.destinations?.length > 0) {
      list = window.__RIVER_DATASET__.destinations;
    } else if (isMandovi) {
      list = MANDOVI_CHAINAGE_DESTINATIONS;
    } else if (/mula[\s-]*mutha/i.test(rName)) {
      list = CHAINAGE_DESTINATIONS;
    } else {
      list = [];
    }
  }
  for (const dest of list) {
    // Treat near-hits as arrived so the name banner can grow at the point.
    if (Math.abs(dest.chainage_m - sel) <= 40) {
      current = dest;
    } else if (dest.chainage_m < sel) {
      prev = dest;
    } else if (dest.chainage_m > sel && !next) {
      next = dest;
    }
  }
  return { prev, next, current };
}
