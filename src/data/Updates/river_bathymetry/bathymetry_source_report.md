# Bathymetry Source Report

## Primary measured source
- **Authority:** CSIR - National Institute of Oceanography (CSIR-NIO), Dona Paula, Goa
- **Report:** Geo-morphological studies and EIA/EMP for the sand mining clusters of Rivers in Goa - Mandovi River Pre & Post Monsoon Report (August 2021)
- **Instrument:** Bathy-500HD echosounder + Squid 500 sparker
- **Vertical datum:** Chart Datum (CD) / MSL (Mormugao)
- **Stations:** 34 (NIO-MAND-67 … 100)
- **Cross-sections:** 120
- **Sounding / profile points:** 2040
- **Depth range (profile points):** 0.60 – 15.25 m

## Satellite / derived (NOT used as OBSERVED bed)
- `src/data/Updates/original/water_depth_mandavi.kml` — RELATIVE ESTIMATE (Sentinel-2), display overlay only
- `live_water_mandavi.kml` — DERIVED MNDWI water extent, sea/river extent reference

## Scene integration
- Corridor vertex depths replaced via `applySurveyBathymetry` using `bathymetryService.getBathymetryAt`
- Provenance per vertex: OBSERVED / INTERPOLATED / UNAVAILABLE
- Relation: `riverbedY = SURFACE_Y - depthM` (scene); CD/MSL bed = `-depthM`
- Sea mouth apron: `seaConnectionLayer` guided by survey CH 0+000 (73.765714, 15.490669)
- Water volume: `estimateWaterVolume` integrates depth × cell area over OBSERVED/INTERPOLATED cells; stage rise → provenance **SIMULATED**
- Cross-section modal samples CSIR-NIO profile points (not a procedural parabola) when available
- Outside survey envelope: shallow continuity placeholders only (no invented deep channels)

## Not overwritten
Original survey JSON and Updates originals are left unchanged.
