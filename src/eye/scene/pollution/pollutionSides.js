/**
 * Named pollution / WQ corridor sides along Mandovi River (west → east).
 * Every garbage / pollution site is assigned to the nearest side so arrow
 * navigation covers the full set with Mandovi place names only.
 *
 * Pune (Mula–Mutha) side names are not used in this project.
 */
export const POLLUTION_KEY_SIDES = [
  { id: "miramar_aguada", index: 1, name: "Miramar / Aguada Bay", lon: 73.80504, lat: 15.48367 },
  { id: "reis_magos_betim", index: 2, name: "Reis Magos / Betim", lon: 73.8115, lat: 15.4965 },
  { id: "panaji", index: 3, name: "Panaji / Santa Monica", lon: 73.82821, lat: 15.50186 },
  { id: "ribandar", index: 4, name: "Ribandar", lon: 73.8455, lat: 15.5052 },
  { id: "chorao_chimbel", index: 5, name: "Chorao / Chimbel", lon: 73.86206, lat: 15.50445 },
  { id: "old_goa_divar", index: 6, name: "Old Goa / Divar", lon: 73.8805, lat: 15.5038 },
];

/** Squared lon/lat distance — fine for local Mandovi AOI ranking. */
export function nearestPollutionSide(lon, lat, sides = POLLUTION_KEY_SIDES) {
  let best = sides[0];
  let bestD = Infinity;
  for (const s of sides) {
    const d = (s.lon - lon) ** 2 + (s.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Assign each record to a side; return side summaries with sites sorted west→east.
 * @param {object[]} records
 * @param {typeof POLLUTION_KEY_SIDES} [sidesList]
 */
export function buildPollutionSides(records = [], sidesList = POLLUTION_KEY_SIDES) {
  const buckets = sidesList.map((s) => ({
    ...s,
    sites: [],
    count: 0,
    meters: null,
  }));
  const byId = new Map(buckets.map((b) => [b.id, b]));

  for (const r of records) {
    const side = nearestPollutionSide(r.lon, r.lat, sidesList);
    const bucket = byId.get(side.id);
    if (!bucket) continue;
    r.sideId = side.id;
    r.sideName = side.name;
    bucket.sites.push({
      id: r.id,
      name: r.displayLabel || r.name || `Site ${r.sourceIndex ?? r.id}`,
      chainageLabel: r.chainageLabel || null,
      meters: Number.isFinite(r.riverChainageMeters) ? r.riverChainageMeters : null,
      densityLevel: r.densityLevel || null,
      lon: r.lon,
      lat: r.lat,
    });
  }

  for (const b of buckets) {
    // Geographic order along corridor (lon west→east), then lat — not chainage,
    // because many western sites snap to the same high chainage near Aguada.
    b.sites.sort((a, c) => {
      const dLon = (a.lon ?? 0) - (c.lon ?? 0);
      if (Math.abs(dLon) > 1e-7) return dLon;
      return (a.lat ?? 0) - (c.lat ?? 0);
    });
    b.count = b.sites.length;
    if (b.sites.length) {
      const mid = b.sites[Math.floor(b.sites.length / 2)];
      b.meters = mid.meters;
      b.focusSiteId = mid.id;
    }
  }

  return buckets;
}
