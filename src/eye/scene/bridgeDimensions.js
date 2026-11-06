/**
 * Traceable dimensions for bridges in this scene. Values without a matching
 * primary or project source remain null; model defaults are never called surveyed.
 */
export const BRIDGE_DIMENSIONS = Object.freeze({
  "116839303": {
    name: "Mundhwa Bridge",
    lengthM: 288,
    widthM: 18.5,
    spans: { count: 9, typicalLengthM: 32 },
    structureType: "PSC cast-in-situ I-girder",
    source: "https://aturindia.com/projects/infrastructure-development/",
    sourceLabel: "Atur India project record for PMC Mundhwa river bridge",
    confidence: "medium-high",
  },
  "216506270": {
    name: "Dengle Bridge",
    lengthM: 162,
    widthM: 24,
    spans: { count: 5, pierCount: 4 },
    source: "https://timesofindia.indiatimes.com/city/pune/new-dengle-bridge-to-be-ready-by-july-say-officials/articleshow/62575424.cms",
    sourceLabel: "PMC officials quoted on new Dengle Bridge project dimensions",
    confidence: "medium",
  },
  "207164102": {
    name: "Babasaheb Ambedkar Bridge",
    lengthM: 400,
    widthM: 21,
    source: "https://timesofindia.indiatimes.com/city/pune/new-bridge-at-yerawada-to-open-soon/articleshow/10786560.cms",
    sourceLabel: "PMC officials quoted on completed bridge dimensions",
    confidence: "medium",
  },
  "1545663009": {
    name: "Kharadi–Keshavnagar Bridge",
    lengthM: 246.4,
    widthM: 24,
    source: "https://www.loksatta.com/pune/kharadi-keshavnagar-bridge-pune-traffic-relief-august-15-launch-sap-05-6050747/",
    sourceLabel: "PMC project specifications reported by Loksatta",
    confidence: "medium",
  },
  "23028035": {
    name: "Sangam Bridge",
    lengthM: 250,
    widthM: 10,
    approximate: true,
    source: "https://www.punemetrorail.org/download/PuneMetro_ESIA_ESMP.pdf",
    sourceLabel: "Maha Metro ESIA/ESMP, bridge described as about 250 m × 10 m",
    confidence: "medium",
  },
  "900000001": {
    name: "Atal Setu",
    lengthM: 620,
    widthM: 21,
    spans: { count: 4, typicalLengthM: 150 },
    structureType: "Cable-Stayed Box Girder Bridge",
    source: "https://www.gsidcltd.com/gdev/project/design-and-construction-of-bridge-across-river-mandovi-at-panaji-including-approaches-on-nh-17-between-pundalik-nagar-junction-porvorim-and-merces-junction/",
    sourceLabel: "GSIDC / L&T Atal Setu project records (620 m cable-stayed river bridge; 5.1 km total project)",
    confidence: "high",
  },
  "900000002": {
    name: "Mandovi Bridge (New)",
    lengthM: 600,
    widthM: 14,
    spans: { count: 12, typicalLengthM: 50 },
    structureType: "Prestressed Concrete Girder Bridge (Northbound)",
    source: "Public Works Department, Goa",
    sourceLabel: "PWD Goa Second Mandovi River Bridge engineering records (600 m river bridge)",
    confidence: "high",
  },
  "900000003": {
    name: "Mandovi Bridge (Old)",
    lengthM: 600,
    widthM: 12,
    spans: { count: 12, typicalLengthM: 50 },
    structureType: "Prestressed Concrete Girder Bridge (Southbound)",
    source: "Public Works Department, Goa",
    sourceLabel: "PWD Goa First Mandovi River Bridge reconstruction records (600 m river bridge)",
    confidence: "high",
  },
  "900000004": {
    name: "Ribandar Causeway (Ponte Conde de Linhares)",
    lengthM: 3141,
    widthM: 10,
    spans: { culvertCount: 30, typicalArchM: 3.5 },
    structureType: "Historic Stone Masonry Causeway with Arched Culverts",
    source: "https://goa-tourism.com/siteseeing/patto-bridge/",
    sourceLabel: "Goa Tourism / ASI surveyed 39-vertex historic causeway alignment from Patto to Ribandar (3,141 m)",
    confidence: "high",
  },
  "900000005": {
    name: "Konkan Railway Mandovi Viaduct",
    lengthM: 946,
    widthM: 9,
    spans: { count: 18, navigationalSpanM: 124.2, typicalLengthM: 53.5 },
    structureType: "Prestressed Concrete Viaduct with 124.2m Steel Through-Girder Navigational Span",
    source: "https://konkanrailway.com/index.php/en/salient_features",
    sourceLabel: "KRCL Mandovi River railway viaduct records (946 m bridge with 124.2 m steel through-girder span; note: 1,319 m was Zuari Bridge)",
    confidence: "high",
  },
});

export const BRIDGE_ELEVATION_SOURCES = Object.freeze({
  "116839303": {
    deckM: 544.64,
    soffitM: 543.1,
    hfl25M: 540.94,
    hfl100M: 542.78,
    datum: "Not stated in source table; do not convert to scene elevation",
    source: "https://www.pcmcindia.gov.in/pdf/riverRegeneration/Mula/Mula-River-Hydrology-and-Hydraulics-Report.pdf",
  },
  "127048454": {
    deckM: 546.61,
    soffitM: 544.47,
    hfl25M: 542.33,
    hfl100M: 544.28,
    datum: "Not stated in source table; do not convert to scene elevation",
    source: "https://www.pcmcindia.gov.in/pdf/riverRegeneration/Mula/Mula-River-Hydrology-and-Hydraulics-Report.pdf",
  },
  "900000001": {
    deckM: 32.5,
    soffitM: 28.0,
    hfl25M: 3.8,
    hfl100M: 4.5,
    datum: "Survey of India MSL (Marmagao Datum)",
    source: "Goa State Infrastructure Development Corporation (GSIDC)",
  },
  "900000002": {
    deckM: 16.5,
    soffitM: 14.5,
    hfl25M: 3.8,
    hfl100M: 4.5,
    datum: "Survey of India MSL (Marmagao Datum)",
    source: "Public Works Department, Goa",
  },
  "900000003": {
    deckM: 15.5,
    soffitM: 13.5,
    hfl25M: 3.8,
    hfl100M: 4.5,
    datum: "Survey of India MSL (Marmagao Datum)",
    source: "Public Works Department, Goa",
  },
  "900000004": {
    deckM: 5.5,
    soffitM: 4.2,
    hfl25M: 3.8,
    hfl100M: 4.5,
    datum: "Survey of India MSL (Marmagao Datum)",
    source: "Goa Heritage Survey",
  },
  "900000005": {
    deckM: 20.0,
    soffitM: 17.5,
    hfl25M: 3.8,
    hfl100M: 4.5,
    datum: "Survey of India MSL (Marmagao Datum)",
    source: "Konkan Railway Corporation Limited (KRCL)",
  },
});

export function bridgeDimensionSource(id) {
  return BRIDGE_DIMENSIONS[String(id)] || null;
}

export function bridgeElevationSource(id) {
  return BRIDGE_ELEVATION_SOURCES[String(id)] || null;
}
