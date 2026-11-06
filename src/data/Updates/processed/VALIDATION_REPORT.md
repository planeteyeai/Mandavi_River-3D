# Mandavi Updates — Validation Report

Generated: see `validation_report.json` for machine-readable detail.

## 1. Files successfully imported (13/13)

| File | Status | Notes |
|------|--------|-------|
| Betim Fishing Jetty.kmz | OK | Point placemark |
| Chimbel Creek Mouth.kmz | OK | Point placemark |
| Chorao Island.kmz | OK | Point placemark |
| Indoor Stadium.kmz | OK | Point placemark |
| Miramar Beach.kmz | OK | Point placemark |
| Offshore Casinos.kmz | OK | Point placemark |
| Ourem Creek Mouth.kmz | OK | Point placemark |
| Reis Magos Fort.kmz | OK | Point placemark |
| Santa Monica Jetty.kmz | OK | Point placemark |
| St Inez Creek Mouth.kmz | OK | Point placemark |
| SV Road Main Drain.kmz | OK | Point placemark |
| live_water_mandavi.kml | OK | GroundOverlay → `water_extent.png` |
| water_depth_mandavi.kml | OK | GroundOverlay → `water_depth.png` |

**Rejected:** none

## 2. CRS & bounding boxes

- Input CRS: EPSG:4326 (lon, lat)
- Scene CRS: EPSG:32643 → local ENU via `geoToWorld`
- Live water / relative depth LatLonBox:
  - N 15.52859903 · S 15.45930980 · E 73.88313675 · W 73.76545998

## 3. Landmark coordinates (source KMZ Points)

| Name | Lon | Lat |
|------|-----|-----|
| Betim Fishing Jetty | 73.83427422 | 15.50408777 |
| Chimbel Creek Mouth | 73.86206283 | 15.50445365 |
| Chorao Island | 73.87215604 | 15.51329708 |
| Indoor Stadium | 73.81238629 | 15.49096546 |
| Miramar Beach | 73.80504351 | 15.48367283 |
| Offshore Casinos | (from KMZ) | (from KMZ) |
| Ourem Creek Mouth | 73.83445671 | 15.49900991 |
| Reis Magos Fort | 73.81056979 | 15.49574321 |
| Santa Monica Jetty | 73.82820933 | 15.50186064 |
| St Inez Creek Mouth | 73.82082912 | 15.50043611 |
| SV Road Main Drain | 73.82383067 | 15.50104979 |

## 4. Coordinate alignment (control points)

Four independent landmarks checked through forward + inverse `geoToWorld` / `worldToGeo`:

| Control | Round-trip error | Source match |
|---------|------------------|--------------|
| Betim Fishing Jetty | 0.000000 m | yes |
| Reis Magos Fort | 0.000000 m | yes |
| Chorao Island | 0.000000 m | yes |
| Miramar Beach | 0.000000 m | yes |

**Result: all passed** (max error 0 m)

No arbitrary visual offsets were applied.

## 5. Bathymetry provenance

| Layer | Provenance | Notes |
|-------|------------|-------|
| Live Water Extent | DERIVED | Sentinel-2 MNDWI · window 2026-10-04→2026-11-03 · ~2254.61 ha |
| Relative Water Depth | RELATIVE ESTIMATE | Sentinel-2 band-ratio · 0.5–8.0 m · **not survey-grade** |
| Survey Stations / 3D riverbed | OBSERVED (where CSIR-NIO present) | Existing app survey pipeline |
| Animated water mesh | MODELLED / SIMULATED surface | Separate from GroundOverlays |

## 6. Missing / not fabricated

- No `water_depth.tif` — source is GroundOverlay PNG, not GeoTIFF
- Updates package does not replace FABDEM terrain DEM
- Screenshots of the live 3D view require running `npm run dev` and capturing the canvas

## 7. Remaining limitations

1. Relative depth must never be labelled as observed sonar depth.
2. Live water is a composite RS product, not a live sensor feed.
3. KMZ landmark altitudes are 0; markers use terrain height sampling.
4. Hydrology (BOD/COD/pollution/flow) and flood layers remain API-driven when data is available.
