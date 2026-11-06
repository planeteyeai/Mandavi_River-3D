/**
 * Official water-quality class schemes for Mula–Mutha Hydrology.
 * Ranges and colors are the single source of truth for legends, polygons, and tooltips.
 */

/** @typedef {{ id:string, kmlClass?:string, label:string, color:string, range:string, unit:string, min:number, max:number|null, inclusiveMax?:boolean }} WqClass */

/** TSS — Mandovi spectral proxy (tss (1).kml), not lab mg/L */
export const TSS_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low",
    label: "Low",
    color: "#2196F3",
    range: "TSS ≤ 0.62",
    unit: "Index",
    min: 0,
    max: 0.62,
    inclusiveMax: true,
  },
  {
    id: "medium",
    kmlClass: "Medium",
    label: "Medium",
    color: "#FFC107",
    range: "0.62–1.17",
    unit: "Index",
    min: 0.62,
    max: 1.17,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#F44336",
    range: "TSS > 1.17",
    unit: "Index",
    min: 1.17,
    max: null,
    inclusiveMax: false,
  },
]);

/**
 * Salinity — Mandovi smoothed PSU classes (Mandovi_Salinity_smoothed_v2.kml).
 * Colors match KML PolyStyle (aabbggrr → #RRGGBB).
 */
export const SALINITY_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    kmlClass: "1 Very Low",
    label: "Very Low",
    color: "#00A651",
    range: "< 0.5 PSU",
    unit: "PSU",
    min: 0,
    max: 0.5,
    inclusiveMax: false,
  },
  {
    id: "low",
    kmlClass: "2 Low",
    label: "Low",
    color: "#00FF00",
    range: "0.5–5 PSU",
    unit: "PSU",
    min: 0.5,
    max: 5,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "3 Moderate",
    label: "Moderate",
    color: "#FFFF00",
    range: "5–18 PSU",
    unit: "PSU",
    min: 5,
    max: 18,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "4 High",
    label: "High",
    color: "#FFA500",
    range: "18–30 PSU",
    unit: "PSU",
    min: 18,
    max: 30,
    inclusiveMax: true,
  },
  {
    id: "very_high",
    kmlClass: "5 Very High",
    label: "Very High",
    color: "#FF0000",
    range: "> 30 PSU",
    unit: "PSU",
    min: 30,
    max: null,
    inclusiveMax: false,
  },
]);

/** Chlorophyll-a (NDCI) — Mandovi water-pixel proxy (chlorophyll.kml) */
export const CHLOROPHYLL_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low Chlorophyll",
    label: "Low",
    color: "#C8E6C9",
    range: "NDCI < 0",
    unit: "NDCI",
    min: -1,
    max: 0,
    inclusiveMax: false,
  },
  {
    id: "high",
    kmlClass: "High Chlorophyll",
    label: "High",
    color: "#1B5E20",
    range: "NDCI ≥ 0",
    unit: "NDCI",
    min: 0,
    max: 1,
    inclusiveMax: true,
  },
]);

/** Water Surface Temperature (WST) — 5 classes (°C) */
export const WST_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    label: "Very Low",
    color: "#1565C0",
    range: "<27 °C",
    unit: "°C",
    min: 0,
    max: 27,
    inclusiveMax: false,
  },
  {
    id: "low",
    label: "Low",
    color: "#64B5F6",
    range: "27–30 °C",
    unit: "°C",
    min: 27,
    max: 30,
    inclusiveMax: false,
  },
  {
    id: "moderate",
    label: "Moderate",
    color: "#FFD54F",
    range: "30–33 °C",
    unit: "°C",
    min: 30,
    max: 33,
    inclusiveMax: false,
  },
  {
    id: "high",
    label: "High",
    color: "#E53935",
    range: "33–36 °C",
    unit: "°C",
    min: 33,
    max: 36,
    inclusiveMax: false,
  },
  {
    id: "very_high",
    label: "Very High",
    color: "#8E0000",
    range: "≥36 °C",
    unit: "°C",
    min: 36,
    max: null,
    inclusiveMax: true,
  },
]);

/** NDWI — Permanent Water — 2 classes */
export const NDWI_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "non_water",
    label: "Non-water",
    color: "#8D6E63",
    range: "NDWI ≤ 0",
    unit: "NDWI",
    min: -1.0,
    max: 0.0,
    inclusiveMax: true,
  },
  {
    id: "water",
    label: "Water",
    color: "#0D47A1",
    range: "NDWI > 0",
    unit: "NDWI",
    min: 0.0,
    max: 1.0,
    inclusiveMax: true,
  },
]);

export const WQ_LAYER_SCHEMES = {
  water_quality_wst: {
    id: "water_quality_wst",
    title: "Water Surface Temperature",
    metric: "Water Temperature",
    unit: "°C",
    classes: WST_CLASSES,
    subtitle: "5 classes · Landsat 9 ST_B10 (°C)",
  },
  water_quality_tss: {
    id: "water_quality_tss",
    title: "TSS / Turbidity",
    metric: "Turbidity / TSS Proxy",
    unit: "Index",
    classes: TSS_CLASSES,
    subtitle: "3 classes · Mandovi Sentinel-2 proxy",
  },
  water_quality_ndwi: {
    id: "water_quality_ndwi",
    title: "NDWI",
    metric: "Permanent Water",
    unit: "NDWI",
    classes: NDWI_CLASSES,
    subtitle: "2 classes · Permanent Water Index",
  },
  water_quality_ndci: {
    id: "water_quality_ndci",
    title: "Chlorophyll-a (NDCI)",
    metric: "Chlorophyll Proxy",
    unit: "NDCI",
    classes: CHLOROPHYLL_CLASSES,
    subtitle: "2 classes · Mandovi NDCI proxy",
  },
  salinity: {
    id: "salinity",
    title: "Salinity",
    metric: "Salinity",
    unit: "PSU",
    classes: SALINITY_CLASSES,
    subtitle: "5 classes · Mandovi smoothed PSU",
  },
};

/**
 * Classify a numeric sample into the official scheme.
 * Boundary rules:
 * - TSS: 10 → Low, 50 → Moderate, >50 → High
 * - Salinity (NDSI): lower edge inclusive, 1.00 → Very High
 * - Chlorophyll-a: 2 → Low, >2 → High
 * @param {number} value
 * @param {WqClass[]} classes
 */
export function classifyWaterQualityValue(value, classes) {
  const v = Number(value);
  if (!Number.isFinite(v) || !classes?.length) return null;

  // Walk in order; each class owns [min, max] with inclusiveMax on the upper edge.
  // Open-ended High classes own (min, ∞).
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    const min = Number(c.min);
    const max = c.max == null ? null : Number(c.max);
    const next = classes[i + 1];

    if (max == null) {
      // ">X" class — strictly greater than min
      if (v > min) return c;
      continue;
    }

    // Prefer assigning the shared upper boundary to this class when inclusiveMax
    // and the next class starts at the same number.
    const upperOk = c.inclusiveMax ? v <= max : v < max;
    if (v >= min && upperOk) {
      // If next class also claims this exact value as its min with exclusive prev,
      // keep current when inclusiveMax.
      if (next && v === max && next.min === max && c.inclusiveMax) return c;
      return c;
    }
  }
  return null;
}

/** Representative midpoint (or just-above threshold) for tooltip numeric display. */
export function classRepresentativeValue(c) {
  if (!c) return null;
  const min = Number(c.min);
  if (c.max == null) {
    if (c.unit === "µg/L") return min + 1;
    return min + 10;
  }
  return (min + Number(c.max)) / 2;
}

export function formatWqValue(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  const digits = unit === "NDSI" ? 2 : 1;
  return `${v.toFixed(digits)} ${unit}`;
}
