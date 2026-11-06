export async function getHydrograph(chainageM) {
  try {
    const r = await fetch(`/api/hydrograph?chainage=${chainageM}`);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch (e) { console.warn("[hydrographApi]", e.message); return null; }
}
