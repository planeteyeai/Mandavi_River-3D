# River Mouth Validation

## Target
Connect Mandovi estuary continuously to the Arabian Sea using measured mouth geography.

## Control points
| ID | Name | Lon | Lat | Role |
|----|------|-----|-----|------|
| CS0 | Survey CH 0+000 | 73.765714 | 15.490669 | Sea / Aguada reference |
| NIO-67 | Miramar / Mandovi Mouth | 73.796333 | 15.480389 | Official mouth station |
| LiveWater west | Updates LatLonBox | 73.76545998 | — | Sea extent west bound |

## Implementation
- `applySurveyBathymetry` maps corridor chainage so CH 0 aligns with survey mouth.
- `seaConnectionLayer` builds a water+bed apron from corridor tip to CS0 when gap > 80 m.
- Live-water / OSM water used as water-mask guidance where available.
- Depths on the apron follow mouth survey profile (MODELLED seam fill), not invented inland channels.

## Pass criteria
- No dry terrain strip between estuary tip and Aguada Bay reference
- Water surface elevation continuous at SURFACE_Y
- Riverbed remains below water (bedY = SURFACE_Y - depth)
