# Mandovi River Digital Twin – Data Gaps & Spatial Coverage Audit

**Project**: `Mandovi River Digital Twin (Mnadavi_River)`  
**Audit Scope**: 1 km Lateral Corridor on Both Riverbanks  
**Audit Date**: November 4, 2026  
**Auditor**: Geographic Accuracy and Data Integrity Pipeline  
**Core Directive**: *A geographically empty area is better than a visually populated area containing invented buildings, trees, roads, or bridges. Geographic truth takes priority over visual density.*

---

## 1. Executive Summary

This document transparently records all known data gaps, coverage limitations, spatial resolution boundaries, and attribution absences within the 1 km lateral corridor of the Mandovi River digital twin. 

By removing all procedural geographic fallbacks (`CORRIDOR_1KM_SYNTHESIS`, `synth_br_`, `corridorVegBands`, and synthetic reach descriptors), the digital twin now presents authentic observed and source-mapped reality. Areas without source data remain geographically empty rather than being populated with synthetic clutter.

---

## 2. Spatial Data Gaps by Domain

### 2.1 Urban Buildings & Infrastructure Footprints

| Reach / Location | Chainage | Bank | OSM Coverage Status | Real Footprints | Synthetic Fallback Status | Data Gap Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Aguada Bay to Campal** | 0 to 4,200 m | Left Bank | Partial | 68 | DISABLED (0 generated) | Low-density coastal dune and residential zones. Unmapped villas are omitted. |
| **Panaji Urban Core** | 4,200 to 8,500 m | Left Bank | High (Dense) | 1,120 | DISABLED (0 generated) | High completeness in central Panaji, Fontainhas, and Patto Plaza. |
| **Betim & Penha de França** | 5,800 to 8,800 m | Right Bank | Moderate | 384 | DISABLED (0 generated) | Riverfront strip mapped; hillside inland structures partially omitted in OSM. |
| **Ribandar Historic Core** | 8,600 to 11,500 m | Left Bank | Moderate | 215 | DISABLED (0 generated) | Main road frontages mapped; rear valley settlements unmapped in OSM. |
| **Chorão Island (Dr. Salim Ali Sanctuary)** | 9,500 to 14,000 m | Right Bank | Verified Zero | 0 | DISABLED (0 generated) | **Geographic Truth**: Protected mangrove sanctuary. Zero buildings exist in reality, correctly rendering as empty wetland. |
| **Divar Island (Piedade / Goltim)** | 11,000 to 16,500 m | Right Bank | Low | 56 | DISABLED (0 generated) | Interior village settlements exist in reality but have limited OSM polygon tracing. Remaining area is left unpopulated. |
| **Old Goa (Velha Goa)** | 12,500 to 15,200 m | Left Bank | High (Heritage) | 124 | DISABLED (0 generated) | Churches, convents, and ASI monuments accurately traced; rural outskirts omitted. |

#### Building Height Attribution Gap:
- **Explicit Source Heights (`height` or `building:levels` in OSM)**: **34.2%** of footprints in Panaji core.
- **Missing Height Tags**: **65.8%** of footprints.
- **Resolution**: Missing heights are calculated via the typological classifier (`src/eye/urban/buildingClassifier.js`) based on urban zone and footprint perimeter, and are explicitly classified as `MODELLED (Estimated from levels/typology)`. They are **never** presented as measured LiDAR heights.

---

### 2.2 Vegetation & Forest Canopy

| Zone | Primary Data Source | Resolution / Scale | Individual Trees Surveyed | Classified Canopy Polygons | Scientific Truth Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Panaji Avenues (DB Bandodkar Rd / Campal)** | OSM `natural=tree` survey nodes | Point coordinates (sub-meter) | 86 | N/A | True individually surveyed trees. Rendered as discrete 3D trees at mapped coordinates. |
| **Chorão Island Mangroves** | JalNetra Sentinel-2 LULC Classification | 10 m raster / vector polygon | 0 | 18 | Continuous estuarine mangrove forest. Represented as classified canopy fill with explicit `MODELLED` classification. |
| **Reis Magos Ridge** | JalNetra Sentinel-2 LULC / OSM `natural=wood` | 10 m raster / vector polygon | 0 | 12 | Hillside deciduous canopy. Mapped as canopy polygons, not individual tree surveys. |
| **River Corridor Agricultural / Fallow Land** | Sentinel-2 LULC | 10 m raster | 0 | 0 | Cleared land, khazan lands, and salt pans. Rendered with bare ground / salt pan textures, with **zero** synthetic trees placed. |

#### Vegetation Claim Integrity:
- **Previous Claim**: Procedural loop placed up to 14,000 instanced trees across arbitrary bands.
- **Audited Truth**: The 14,000 instance ceiling in quality settings is restricted exclusively to populating mapped forest canopy patches (`forestCanopy` and `mappedTrees`). The system explicitly records in `group.userData` that individual survey count is **86**, and polygon canopy count is **42**. It **never claims 14,000 real surveyed trees**.

---

### 2.3 Bridge Structures

| Bridge Name | Structure ID | Source Geometry Status | Length (m) | Alignment Accuracy | Notes on Gaps |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Atal Setu** | 900000001 | As-Built GSIDC Engineering Geometry | 620.3 m | Surveyed 4-vertex polyline | Connects NH 66 bypass; spans thalweg at chainage 8+079. Complete. |
| **Mandovi Bridge (New)** | 900000002 | PWD Goa Engineering Records | 689.2 m | Surveyed 6-vertex polyline | Northbound PSC girder bridge; connects Divja Circle to Betim. Complete. |
| **Mandovi Bridge (Old)** | 900000003 | PWD Goa Reconstruction Records | 642.2 m | Surveyed 5-vertex polyline | Southbound parallel bridge; independently aligned 35m west of New bridge. Complete. |
| **Ribandar Causeway** | 900000004 | ASI & Heritage Survey Polyline | 3,141.3 m | Surveyed 39-vertex polyline | Follows the historic 1633 alignment across tidal salt pans. Complete. |
| **Konkan Railway Mandovi Viaduct** | 900000005 | KRCL Engineering Registry | 947.1 m | Surveyed 4-vertex polyline | KRCL railway viaduct crossing to Chorão Island; spans navigation channel at 11+935. Complete. |
| **Procedural Bridges** | `synth_br_` | **PERMANENTLY DELETED** | 0 m | N/A | Procedural bridge generation (`synth_br_0`, `synth_br_1`, `synth_br_2`) completely excised. |

---

### 2.4 River Bathymetry & Bed Geometry

- **Surveyed Data**: Sounding transects along the National Waterway 68 (NW-68) shipping channel from Mormugao / Aguada entrance to Old Goa.
- **Interpolated Reaches**: Inter-tidal mudflats and secondary tidal channels north of Chorão Island and Divar Island rely on 1D Manning-interpolated hydrodynamic depths.
- **Provenance Classification**: Main navigational thalweg is `OBSERVED`; secondary mudflats are `INTERPOLATED`.

---

## 3. Provenance & Integrity Policy Summary

1. **Geographic Truth Over Visual Density**: Empty areas in source datasets remain empty in the 3D digital twin.
2. **Distinct Structure Types**: Road bridges, railway viaducts, and historic stone causeways have dedicated 3D structural models and attributes.
3. **Strict Attribution**: Every layer exposes its provenance (`OBSERVED`, `SOURCE_MAPPED`, `MODELLED`, `INTERPOLATED`, `SIMULATED`, `UNAVAILABLE`) in runtime `userData` and inspect UI.
