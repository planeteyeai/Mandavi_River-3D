// ============================================================
// KML Parser - Parses KML files into riverData format
// ============================================================

export function parseKML(kmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(kmlText, "text/xml");
  
  const coordinatesTags = xmlDoc.getElementsByTagName("coordinates");
  if (coordinatesTags.length === 0) {
    throw new Error("No coordinates found in KML.");
  }
  
  // Use the longest coordinates tag assuming it's the main river line
  let bestCoordsStr = "";
  for (let i = 0; i < coordinatesTags.length; i++) {
    const text = coordinatesTags[i].textContent.trim();
    if (text.length > bestCoordsStr.length) {
      bestCoordsStr = text;
    }
  }

  const coordPairs = bestCoordsStr.split(/\s+/).filter(Boolean);
  
  if (coordPairs.length < 2) {
    throw new Error("Not enough coordinates to form a river.");
  }

  const lon = [];
  const lat = [];
  const chainage_m = [];
  const width_m = [];
  const depth_m = [];

  // Simple haversine for distance in meters
  const R = 6371000;
  function getDistance(lon1, lat1, lon2, lat2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let totalDist = 0;
  for (let i = 0; i < coordPairs.length; i++) {
    const parts = coordPairs[i].split(",");
    const cLon = parseFloat(parts[0]);
    const cLat = parseFloat(parts[1]);
    
    lon.push(cLon);
    lat.push(cLat);
    width_m.push(50); // default width
    depth_m.push(5);  // default depth

    if (i === 0) {
      chainage_m.push(0);
    } else {
      const dist = getDistance(lon[i-1], lat[i-1], cLon, cLat);
      totalDist += dist;
      chainage_m.push(totalDist);
    }
  }

  return {
    chainage_m,
    lon,
    lat,
    width_m,
    depth_m,
    real_width_m: width_m,
    real_depth_m: depth_m,
    landmarks: [] // empty for KML
  };
}
