/**
 * River place labels come from the supplied river dataset. Do not add names by
 * reverse-geocoding coordinates or by guessing destinations from the river name.
 */
export async function resolveRiverDestinations(dataset) {
  if (!dataset) return [];
  const destinations = Array.isArray(dataset.providedDestinations)
    ? dataset.providedDestinations.filter((place) =>
        place && typeof place.name === "string" && place.name.trim(),
      )
    : [];

  dataset.destinations = destinations;
  if (!dataset.osm) dataset.osm = {};
  dataset.osm.places = destinations.map((place) => ({ ...place, name: place.name.trim() }));
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("river-destinations-updated", { detail: destinations }));
  }
  return destinations;
}
