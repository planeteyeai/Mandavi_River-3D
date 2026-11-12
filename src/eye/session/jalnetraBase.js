/**
 * Same-origin JalNetra base for browser (Vite + Vercel proxy).
 * Absolute Railway URL only as a non-browser fallback.
 */

const REMOTE_API_BASE = "https://jalnetra-software-production.up.railway.app";
const PROXY_API_BASE = "/jalnetra-api";

export function resolveJalnetraBase() {
  const env =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE;
  if (env) return String(env).replace(/\/$/, "");
  if (typeof window !== "undefined") return PROXY_API_BASE;
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    return PROXY_API_BASE;
  }
  return REMOTE_API_BASE;
}

export const API_BASE = resolveJalnetraBase();
