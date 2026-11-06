// ============================================================
// PLANET.EYE Global Application State
// Single source of truth for the entire application
// ============================================================

export const AppState = {
  river: "Mula-Mutha",
  riverData: null,
  selectedChainageM: 0,
  selectedStationIndex: 0,
  activeMode: "overview",   // overview | forecast | hydrograph | simulation | flood
  forecastLeadHours: 24,
  simulationHour: 0,
  simulationRunning: false,
  floodStageM: 0,
  waterAnimation: true,
  flowSpeed: 0.35,
  viewMode: "3d",
  layers: {
    water: true,
    flow: true,
    chainage: true,
    buildings: true,
    vegetation: true,
    flood: false,
    depth: false,
    width: false
  },
  _listeners: new Set()
};

/**
 * Patch state and notify all subscribers.
 * @param {Partial<typeof AppState>} patch
 */
export function setState(patch) {
  Object.assign(AppState, patch);
  for (const fn of AppState._listeners) {
    try { fn(AppState); } catch (e) { console.warn("State listener error:", e); }
  }
}

/**
 * Subscribe to all state changes.
 * @param {function} listener
 * @returns {function} unsubscribe
 */
export function subscribe(listener) {
  AppState._listeners.add(listener);
  return () => AppState._listeners.delete(listener);
}

export function setActiveMode(mode) {
  setState({ activeMode: mode });
}

export function setLayer(name, visible) {
  const layers = { ...AppState.layers, [name]: visible };
  setState({ layers });
}
