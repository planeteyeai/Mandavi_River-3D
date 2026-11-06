/**
 * BOD / COD per joining stream (Mandovi upstreams S01–S07).
 * Source: src/data/response_1793955844081.json (Landsat 8+9 BOD, COD with Sentinel-2 correction).
 * Matched to drainage records by stream name ("Upstream 01 (CH 6+686)") or number.
 */
import {
  streams,
  start_date as startDate,
  end_date as endDate,
  landsat_image_count as landsatCount,
  sentinel2_image_count as s2Count,
  data_refreshed_at as refreshedAt,
} from "../../data/response_1793955844081.json";

const byKey = new Map();
for (const s of streams || []) {
  const num = /upstream\s*0*(\d+)/i.exec(s.stream_name || "")?.[1] ?? /S0*(\d+)/i.exec(s.stream_id || "")?.[1];
  const entry = {
    id: s.stream_id,
    name: s.stream_name,
    chainage: s.chainage_label,
    bodMean: s.stats?.bod_mg_L_mean,
    bodMin: s.stats?.bod_mg_L_min,
    bodMax: s.stats?.bod_mg_L_max,
    codMean: s.stats?.cod_mg_L_mean,
    codMin: s.stats?.cod_mg_L_min,
    codMax: s.stats?.cod_mg_L_max,
    pixels: s.stats?.pixel_count ?? s.pixels?.length ?? 0,
  };
  byKey.set(String(s.stream_name || "").trim().toLowerCase(), entry);
  if (num) byKey.set(`#${Number(num)}`, entry);
}

export const streamsBodCodMeta = { startDate, endDate, landsatCount, s2Count, refreshedAt };

/** @returns {object|null} BOD/COD stats for a drainage record or stream name */
export function streamBodCodFor(recOrName) {
  const names =
    typeof recOrName === "string"
      ? [recOrName]
      : [recOrName?.meta?.name, recOrName?.displayName, recOrName?.name];
  for (const n of names) {
    const s = String(n || "").trim();
    if (!s) continue;
    const hit = byKey.get(s.toLowerCase());
    if (hit) return hit;
    const num = /upstream\s*0*(\d+)/i.exec(s)?.[1];
    if (num && byKey.has(`#${Number(num)}`)) return byKey.get(`#${Number(num)}`);
  }
  return null;
}

/** CPCB-style bands: BOD ≤3 good, ≤6 moderate, else high. COD ≤10 / ≤30. */
export function bodLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 3 ? "good" : v <= 6 ? "moderate" : "high";
}
export function codLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 10 ? "good" : v <= 30 ? "moderate" : "high";
}

export function fmtMgL(v, digits = 1) {
  return Number.isFinite(v) ? Number(v).toFixed(digits) : "—";
}
