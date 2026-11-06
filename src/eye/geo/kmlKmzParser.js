/**
 * Robust KML / KMZ parser for PLANET.EYE Updates assets.
 * Supports XML namespace prefixes, Placemark Point/LineString/Polygon,
 * ExtendedData, and GroundOverlay (LatLonBox + embedded Base64 PNG).
 */

/** @typedef {{ lon: number, lat: number, alt?: number }} LonLatAlt */
/** @typedef {{
 *   name: string,
 *   description?: string | null,
 *   sourceFilename: string,
 *   geometryType: 'Point' | 'LineString' | 'Polygon',
 *   lon?: number, lat?: number, elevation?: number,
 *   coordinates?: LonLatAlt[],
 *   rings?: LonLatAlt[][],
 *   extendedData?: Record<string, string>,
 * }} PlacemarkFeature */
/** @typedef {{
 *   name: string | null,
 *   description: string | null,
 *   color?: string | null,
 *   north: number, south: number, east: number, west: number,
 *   rotation?: number,
 *   href: string | null,
 *   imageDataUrl: string | null,
 *   sourceFilename: string,
 * }} GroundOverlayFeature */

const NS_TAG = "(?:\\w+:)?";

function tagText(xml, tag) {
  const re = new RegExp(`<${NS_TAG}${tag}\\b[^>]*>([\\s\\S]*?)</${NS_TAG}${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function parseCoords(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const parts = tok.split(",");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      const alt = Number(parts[2] || 0);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { lon, lat, alt: Number.isFinite(alt) ? alt : 0 };
    })
    .filter(Boolean);
}

function parseExtendedData(block) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of block.matchAll(
    /<(?:\w+:)?Data\s+name="([^"]+)"[^>]*>\s*<(?:\w+:)?value>\s*([^<]*?)\s*<\/(?:\w+:)?value>/gi,
  )) {
    out[m[1].trim()] = m[2].trim();
  }
  for (const m of block.matchAll(
    /<(?:\w+:)?SimpleData\s+name="([^"]+)">\s*([^<]*)\s*<\/(?:\w+:)?SimpleData>/gi,
  )) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/**
 * Minimal ZIP (KMZ) reader — Stored (0) and Deflate (8).
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<{ name: string, data: Uint8Array }[]>}
 */
export async function unzipKmz(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = [];
  let i = 0;
  while (i + 30 <= buf.length) {
    if (view.getUint32(i, true) !== 0x04034b50) break;
    const method = view.getUint16(i + 8, true);
    const compSize = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const nameBytes = buf.subarray(i + 30, i + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = i + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`KMZ entry "${name}" uses unsupported compression method ${method}`);
    }
    entries.push({ name, data });
    i = dataStart + compSize;
  }
  return entries;
}

async function inflateRaw(compressed) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream unavailable — cannot inflate KMZ");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Parse KML text into placemarks + ground overlays.
 * @param {string} text
 * @param {string} [sourceFilename]
 */
export function parseKmlDocument(text, sourceFilename = "document.kml") {
  const xml = String(text || "");
  /** @type {PlacemarkFeature[]} */
  const placemarks = [];
  /** @type {GroundOverlayFeature[]} */
  const groundOverlays = [];

  const docName = tagText(xml, "name");
  const docDescription = tagText(xml, "description");

  const pmBlocks = [...xml.matchAll(new RegExp(`<${NS_TAG}Placemark\\b[\\s\\S]*?</${NS_TAG}Placemark>`, "gi"))];
  for (const blockMatch of pmBlocks) {
    const block = blockMatch[0];
    const name = tagText(block, "name") || sourceFilename;
    const description = tagText(block, "description");
    const extendedData = parseExtendedData(block);

    const pointM = block.match(
      new RegExp(
        `<${NS_TAG}Point\\b[\\s\\S]*?<${NS_TAG}coordinates>([\\s\\S]*?)</${NS_TAG}coordinates>`,
        "i",
      ),
    );
    if (pointM) {
      const pts = parseCoords(pointM[1]);
      if (pts[0]) {
        placemarks.push({
          name,
          description,
          sourceFilename,
          geometryType: "Point",
          lon: pts[0].lon,
          lat: pts[0].lat,
          elevation: pts[0].alt,
          extendedData,
        });
      }
      continue;
    }

    const lineM = block.match(
      new RegExp(
        `<${NS_TAG}LineString\\b[\\s\\S]*?<${NS_TAG}coordinates>([\\s\\S]*?)</${NS_TAG}coordinates>`,
        "i",
      ),
    );
    if (lineM) {
      const coordinates = parseCoords(lineM[1]);
      if (coordinates.length >= 2) {
        placemarks.push({
          name,
          description,
          sourceFilename,
          geometryType: "LineString",
          coordinates,
          extendedData,
        });
      }
      continue;
    }

    const polyBlocks = [
      ...block.matchAll(new RegExp(`<${NS_TAG}Polygon\\b[\\s\\S]*?</${NS_TAG}Polygon>`, "gi")),
    ];
    if (polyBlocks.length) {
      const rings = [];
      for (const pb of polyBlocks) {
        const coordsBlocks = [
          ...pb[0].matchAll(
            new RegExp(`<${NS_TAG}coordinates>([\\s\\S]*?)</${NS_TAG}coordinates>`, "gi"),
          ),
        ];
        for (const c of coordsBlocks) {
          const ring = parseCoords(c[1]);
          if (ring.length >= 4) rings.push(ring);
        }
      }
      if (rings.length) {
        placemarks.push({
          name,
          description,
          sourceFilename,
          geometryType: "Polygon",
          rings,
          extendedData,
        });
      }
    }
  }

  const goBlocks = [
    ...xml.matchAll(new RegExp(`<${NS_TAG}GroundOverlay\\b[\\s\\S]*?</${NS_TAG}GroundOverlay>`, "gi")),
  ];
  for (const goMatch of goBlocks) {
    const block = goMatch[0];
    const name = tagText(block, "name");
    const description = tagText(block, "description") || docDescription;
    const color = tagText(block, "color");
    const north = Number(tagText(block, "north"));
    const south = Number(tagText(block, "south"));
    const east = Number(tagText(block, "east"));
    const west = Number(tagText(block, "west"));
    const rotation = Number(tagText(block, "rotation") || 0);
    const hrefRaw = tagText(block, "href");
    const href = hrefRaw ? hrefRaw.replace(/\s+/g, "") : null;
    let imageDataUrl = null;
    if (href?.startsWith("data:image")) {
      imageDataUrl = href;
    }
    if (
      Number.isFinite(north) &&
      Number.isFinite(south) &&
      Number.isFinite(east) &&
      Number.isFinite(west)
    ) {
      groundOverlays.push({
        name,
        description,
        color,
        north,
        south,
        east,
        west,
        rotation: Number.isFinite(rotation) ? rotation : 0,
        href: href?.startsWith("data:") ? "data:image/png;base64,[embedded]" : href,
        imageDataUrl,
        sourceFilename,
      });
    }
  }

  return {
    documentName: docName,
    documentDescription: docDescription,
    placemarks,
    groundOverlays,
    sourceFilename,
  };
}

/**
 * Load and parse a KMZ ArrayBuffer / fetch Response body.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} [sourceFilename]
 */
export async function parseKmzBuffer(buffer, sourceFilename = "archive.kmz") {
  const entries = await unzipKmz(buffer);
  const kmlEntry =
    entries.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) ||
    entries.find((e) => /\.kml$/i.test(e.name));
  if (!kmlEntry) {
    throw new Error(`KMZ "${sourceFilename}" contains no KML document`);
  }
  const text = new TextDecoder().decode(kmlEntry.data);
  return parseKmlDocument(text, sourceFilename);
}

/**
 * Fetch + parse a KML or KMZ URL (project-relative).
 * @param {string} url
 * @param {string} [filename]
 */
export async function loadKmlOrKmz(url, filename) {
  const name = filename || decodeURIComponent(String(url).split("/").pop() || "file");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (/\.kmz$/i.test(name) || /\.kmz$/i.test(url)) {
    const buf = await res.arrayBuffer();
    return parseKmzBuffer(buf, name);
  }
  const text = await res.text();
  return parseKmlDocument(text, name);
}

/**
 * Decode an embedded GroundOverlay imageDataUrl once (cached by caller).
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode GroundOverlay PNG"));
    img.src = dataUrl;
  });
}
