/**
 * Process src/data/Updates/original → processed/ (+ public/data/updates mirror).
 * Does not modify original source files.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const orig = path.join(root, "src/data/Updates/original");
const proc = path.join(root, "src/data/Updates/processed");
const pub = path.join(root, "public/data/updates");

fs.mkdirSync(proc, { recursive: true });
fs.mkdirSync(pub, { recursive: true });

function readZip(buf) {
  const entries = [];
  let i = 0;
  while (i + 30 < buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data);
    else throw new Error(`unsupported ZIP method ${method} for ${name}`);
    entries.push({ name, content });
    i = dataStart + compSize;
  }
  return entries;
}

function parseCoords(raw) {
  return String(raw)
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const p = tok.split(",").map(Number);
      return { lon: p[0], lat: p[1], alt: p[2] || 0 };
    })
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function tagText(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function parsePlacemarks(xml, sourceFile) {
  const out = [];
  const blocks = [...xml.matchAll(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi)];
  for (const b of blocks) {
    const content = b[0];
    const name = tagText(content, "name") || path.basename(sourceFile, ".kmz");
    const description = tagText(content, "description");
    const pointM = content.match(
      /<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/i,
    );
    if (!pointM) continue;
    const pts = parseCoords(pointM[1]);
    if (!pts[0]) continue;
    out.push({
      type: "Point",
      name,
      description,
      lon: pts[0].lon,
      lat: pts[0].lat,
      elevation: pts[0].alt,
      sourceFile,
      geometryType: "Point",
    });
  }
  return out;
}

function parseGroundOverlay(xml, sourceFile) {
  const name = tagText(xml, "name");
  const description = tagText(xml, "description");
  const north = Number(tagText(xml, "north"));
  const south = Number(tagText(xml, "south"));
  const east = Number(tagText(xml, "east"));
  const west = Number(tagText(xml, "west"));
  const hrefM = xml.match(/<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/i);
  const href = hrefM ? hrefM[1].trim().replace(/\s+/g, "") : null;
  let pngBuffer = null;
  if (href?.startsWith("data:image")) {
    const b64 = href.split(",")[1];
    pngBuffer = Buffer.from(b64, "base64");
  }
  return { name, description, north, south, east, west, href, pngBuffer, sourceFile };
}

const landmarks = [];
const assets = [];
const rejected = [];

for (const f of fs.readdirSync(orig)) {
  const full = path.join(orig, f);
  try {
    if (f.toLowerCase().endsWith(".kmz")) {
      const entries = readZip(fs.readFileSync(full));
      const kml = entries.find((e) => /\.kml$/i.test(e.name));
      if (!kml) {
        rejected.push({ file: f, reason: "No KML in KMZ" });
        continue;
      }
      const marks = parsePlacemarks(kml.content.toString("utf8"), f);
      if (!marks.length) {
        rejected.push({ file: f, reason: "No Point placemarks" });
        continue;
      }
      landmarks.push(...marks);
      assets.push({
        filename: f,
        dataType: "landmark",
        geometryType: "Point",
        crs: "EPSG:4326",
        features: marks.length,
        lon: marks[0].lon,
        lat: marks[0].lat,
        validation: "ok",
        provenance: "OBSERVED",
        sourceDescription: "Google Earth Pro placemark Point",
      });
    } else if (f.toLowerCase().endsWith(".kml")) {
      const xml = fs.readFileSync(full, "utf8");
      const ov = parseGroundOverlay(xml, f);
      if (!Number.isFinite(ov.north) || !ov.pngBuffer) {
        rejected.push({ file: f, reason: "Missing LatLonBox or embedded PNG" });
        continue;
      }
      const isLive = /live_water/i.test(f);
      const outName = isLive ? "water_extent.png" : "water_depth.png";
      fs.writeFileSync(path.join(proc, outName), ov.pngBuffer);
      fs.writeFileSync(path.join(pub, outName), ov.pngBuffer);
      assets.push({
        filename: f,
        dataType: isLive ? "live_water_extent" : "relative_water_depth",
        geometryType: "GroundOverlay raster",
        crs: "EPSG:4326",
        bounds: { north: ov.north, south: ov.south, east: ov.east, west: ov.west },
        description: ov.description,
        name: ov.name,
        imageBytes: ov.pngBuffer.length,
        processedImage: outName,
        provenance: isLive ? "DERIVED" : "RELATIVE ESTIMATE",
        validation: "ok",
        depthRange: isLive ? null : [0.5, 8.0],
        note: isLive
          ? "Sentinel-2 MNDWI water extent reference — not a live sensor feed."
          : "Sentinel-2 relative band-ratio depth estimate — not survey-grade bathymetry.",
      });
    }
  } catch (err) {
    rejected.push({ file: f, reason: String(err.message || err) });
  }
}

const geojson = {
  type: "FeatureCollection",
  name: "PROJECT LANDMARKS",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: landmarks.map((l) => ({
    type: "Feature",
    properties: {
      name: l.name,
      sourceFilename: l.sourceFile,
      geometryType: l.geometryType,
      provenance: "OBSERVED",
      description: l.description || null,
    },
    geometry: { type: "Point", coordinates: [l.lon, l.lat, l.elevation || 0] },
  })),
};
fs.writeFileSync(path.join(proc, "landmarks.geojson"), JSON.stringify(geojson, null, 2));
fs.writeFileSync(path.join(pub, "landmarks.geojson"), JSON.stringify(geojson, null, 2));

const live = assets.find((a) => a.dataType === "live_water_extent");
if (live) {
  const b = live.bounds;
  const poly = {
    type: "FeatureCollection",
    name: "Live Water Extent bounds",
    features: [
      {
        type: "Feature",
        properties: {
          name: live.name,
          sourceFilename: live.filename,
          provenance: "DERIVED",
          description: live.description,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [b.west, b.south],
              [b.east, b.south],
              [b.east, b.north],
              [b.west, b.north],
              [b.west, b.south],
            ],
          ],
        },
      },
    ],
  };
  fs.writeFileSync(path.join(proc, "water_extent.geojson"), JSON.stringify(poly, null, 2));
  fs.writeFileSync(path.join(pub, "water_extent.geojson"), JSON.stringify(poly, null, 2));
}

const meta = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: "src/data/Updates/original",
  processedDirectory: "src/data/Updates/processed",
  crs: {
    input: "EPSG:4326",
    scene: "EPSG:32643",
    localOrigin: "shared geoReference (geoToWorld)",
  },
  assets,
  rejected,
  landmarkCount: landmarks.length,
  notes: [
    "Original source files are never modified.",
    "water_depth PNG is a RELATIVE ESTIMATE from Sentinel-2 band-ratio; not OBSERVED survey bathymetry.",
    "live_water PNG is Sentinel-2 MNDWI water extent reference, not a live sensor feed.",
    "No water_depth.tif generated — source is embedded GroundOverlay PNG, not a GeoTIFF DEM.",
  ],
};
fs.writeFileSync(path.join(proc, "metadata.json"), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(pub, "metadata.json"), JSON.stringify(meta, null, 2));

console.log(
  JSON.stringify(
    {
      landmarks: landmarks.length,
      assets: assets.length,
      rejected,
      sample: landmarks.slice(0, 3),
      overlayBounds: assets.filter((a) => a.bounds).map((a) => ({ file: a.filename, bounds: a.bounds })),
    },
    null,
    2,
  ),
);
