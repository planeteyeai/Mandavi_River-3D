export async function advanceSimulation(hours) {
  try {
    const r = await fetch(`/api/advance?hours=${hours}`, { method: "POST" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch (e) { console.warn("[simulationApi]", e.message); return null; }
}
export async function resetSimulation() {
  try {
    const r = await fetch("/api/reset", { method: "POST" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch (e) { console.warn("[simulationApi]", e.message); return null; }
}
