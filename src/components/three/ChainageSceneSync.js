import { lonLatToLocal } from "../../utils/chainageUtils.js";
/**
 * Syncs the 3D chainage marker position with a station object.
 * Converts geographic coords to local scene coords.
 */
export function createChainageSceneSync(marker, data, originLon, originLat) {
  return {
    setStation(station) {
      if (station.lat == null || station.lon == null) return;
      const { x, z } = lonLatToLocal(station.lon, station.lat, originLon, originLat);
      marker.setLocalPosition(x, z);
      marker.setWidth(station.width);
    }
  };
}
