export async function getMeta() { return safeFetch("/api/meta"); }
export async function getState() { return safeFetch("/api/state"); }
export async function getMargins() { return safeFetch("/api/margins"); }
export async function getAlerts() { return safeFetch("/api/alerts"); }
export async function getScorecard() { return safeFetch("/api/scorecard"); }
async function safeFetch(url, opts = {}) {
  try { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); }
  catch (e) { console.warn("[API]", url, e.message); return null; }
}
