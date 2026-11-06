export async function getForecastProfile(lead = 24) {
  try {
    const r = await fetch(`/api/forecast/profile?lead=${lead}`);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch (e) { console.warn("[forecastApi]", e.message); return null; }
}
