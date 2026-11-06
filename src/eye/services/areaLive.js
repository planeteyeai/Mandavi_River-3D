/** Coordinates and identity of the river the user uploaded. */

export function riverSession() {
  return typeof window !== "undefined" ? window.__RIVER_SESSION__ : null;
}

export function riverFingerprint(session = riverSession()) {
  if (!session?.kmlText) return "";
  const lat = Number(session.centroid?.lat);
  const lon = Number(session.centroid?.lon);
  return [
    session.riverName || "",
    Number.isFinite(lat) ? lat.toFixed(4) : "",
    Number.isFinite(lon) ? lon.toFixed(4) : "",
    String(session.kmlText.length),
  ].join("|");
}

/** Centroid of the uploaded river. Null until a KML is loaded. */
export function activeRiverPoint() {
  const session = riverSession();
  const lat = Number(session?.centroid?.lat);
  const lon = Number(session?.centroid?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = session?.riverName || "This river";
  return { lat, lon, label: name, name };
}

/** Survey flood lines exist only for the Mula–Mutha corridor. */
export function riverIsMulaMutha() {
  const point = activeRiverPoint();
  if (!point) return false;
  const name = String(point.name || "").toLowerCase();
  const named = /mula|mutha/.test(name);
  const inside =
    point.lat > 18.35 && point.lat < 18.65 && point.lon > 73.7 && point.lon < 74.05;
  return named && inside;
}

export function areaTimeZone(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (a >= 6 && a <= 37 && b >= 68 && b <= 98) return "Asia/Kolkata";
  return "auto";
}

export function calendarDay(timeZone, date = new Date()) {
  const zone = timeZone && timeZone !== "auto" ? timeZone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
