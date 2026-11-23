/**
 * Pollution hotspot markers ranked from BOD/COD + Eutrophication + Nitrogen + Coliform.
 * Shade of red = combined severity from real CSV/KML sources — no random values.
 */
import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { nearestChainage, formatStation } from "../geo/chainage.js";
import {
  ensureBodCodPixels,
  sampleBodCodAtLonLat,
} from "../services/bodCodPixelService.js";
import {
  fetchBodCodViewerData,
  sampleLiveBodCodAtMeters,
} from "../services/bodCodService.js";
import { SURFACE_Y } from "./river.js";

export const POLLUTION_HOTSPOTS_URL = "/data/mandovi/pollution_hotspots.json";

const FALLBACK_RED = "#E53935";
const FALLBACK_DEEP = "#8B0000";

/**
 * @param {{ corridor?: { stations?: object[] } }} [dataset]
 */
export function createPollutionHotspotLayer(dataset = {}) {
  const group = new THREE.Group();
  group.name = "pollutionHotspotLayer";
  group.visible = false;
  group.renderOrder = 46;

  /** @type {object | null} */
  let data = null;
  /** @type {THREE.Object3D[]} */
  const nodes = [];
  let selectedId = null;
  let loadPromise = null;
  const chainage = Array.isArray(dataset?.chainage) ? dataset.chainage : [];

  function clear() {
    for (const n of nodes) {
      n.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else {
            o.material.map?.dispose?.();
            o.material.dispose?.();
          }
        }
      });
      group.remove(n);
    }
    nodes.length = 0;
  }

  function makeRing(radius, color, opacity) {
    const geo = new THREE.RingGeometry(radius * 0.72, radius, 48);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 47;
    return mesh;
  }

  function makeLabel(hotspot) {
    const color = hotspot.color || FALLBACK_RED;
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 300;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);

    ctx.fillStyle = "rgba(40, 6, 8, 0.94)";
    roundRect(ctx, 8, 8, c.width - 16, c.height - 16, 22);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = "800 24px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`#${hotspot.rank}  ${String(hotspot.shadeLabel || "Hotspot")}`, 36, 44);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 32px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(String(hotspot.name || "Hotspot").slice(0, 28), 36, 86);

    ctx.fillStyle = "#FFEBEE";
    ctx.font = "700 24px 'Segoe UI', Arial, sans-serif";
    const bod = Number.isFinite(hotspot.maxBod) ? fmt(hotspot.maxBod) : "—";
    const cod = Number.isFinite(hotspot.maxCod) ? fmt(hotspot.maxCod) : "—";
    ctx.fillText(`BOD ${bod}   COD ${cod}  mg/L`, 36, 128);

    ctx.font = "600 18px 'Segoe UI', Arial, sans-serif";
    ctx.fillStyle = "#FFCDD2";
    const eutro = hotspot.eutrophication?.valueText || "—";
    const nitro = hotspot.nitrogen?.valueText || "—";
    const coli = hotspot.coliform?.valueText || "—";
    ctx.fillText(`Algae  ${String(eutro).slice(0, 36)}`, 36, 168);
    ctx.fillText(`Nitrogen  ${String(nitro).slice(0, 34)}`, 36, 200);
    ctx.fillText(`Bacteria  ${String(coli).slice(0, 34)}`, 36, 232);

    ctx.fillStyle = color;
    ctx.font = "700 18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(`${Math.round((Number(hotspot.composite) || 0) * 100)}% combined score`, 36, 268);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    spr.scale.set(32, 13.4, 1);
    spr.renderOrder = 50;
    spr.center.set(0.5, 0);
    return spr;
  }

  function build(hotspots) {
    clear();
    const list = Array.isArray(hotspots) ? hotspots : [];
    for (const h of list) {
      let local;
      try {
        local = lonLatToLocal(h.lon, h.lat);
      } catch {
        continue;
      }
      if (!Number.isFinite(local?.x) || !Number.isFinite(local?.z)) continue;

      const color = h.color || FALLBACK_RED;
      const deep = h.shade === "extreme" || h.shade === "severe" ? FALLBACK_DEEP : color;
      const root = new THREE.Group();
      root.name = `pollutionHotspot_${h.rank}`;
      root.position.set(local.x, SURFACE_Y + 0.35, local.z);
      root.userData.hotspot = h;

      const thick = Math.min(
        1,
        Math.max(0.25, (h.thickness || h.bodPixelCount || 1) / 120),
      );
      const severity = Math.min(1, Math.max(0.3, Number(h.composite) || 0.5));
      const outerR = 12 + thick * 20 + severity * 10;
      const glow = makeRing(outerR, color, 0.18 + severity * 0.22);
      const core = makeRing(outerR * 0.45, deep, 0.5 + severity * 0.2);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(outerR * 0.28, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.4 + severity * 0.35,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.05;
      disc.renderOrder = 46;

      const pin = new THREE.Mesh(
        new THREE.ConeGeometry(1.2 + severity * 0.6, 5 + severity * 2, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      pin.rotation.x = Math.PI;
      pin.position.y = 4.2;

      const label = makeLabel(h);
      label.position.y = 10.2;

      root.add(glow, core, disc, pin, label);
      group.add(root);
      nodes.push(root);
    }
  }

  async function ensureLoaded() {
    if (data) return data;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(POLLUTION_HOTSPOTS_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Pollution hotspots HTTP ${res.status}`);
      data = await res.json();
      build(data.hotspots || []);
      return data;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  function setSelected(idOrRank) {
    selectedId = idOrRank;
    for (const n of nodes) {
      const h = n.userData.hotspot;
      const on = h && (h.id === idOrRank || h.rank === idOrRank);
      n.scale.setScalar(on ? 1.18 : 1);
    }
  }

  function focusHotspot(idOrRank, opts = {}) {
    const node = nodes.find(
      (n) => n.userData.hotspot?.id === idOrRank || n.userData.hotspot?.rank === idOrRank,
    );
    const h = node?.userData?.hotspot;
    if (!h || !node) return null;
    setSelected(h.id);
    const x = node.position.x;
    const z = node.position.z;
    const y = SURFACE_Y;
    const toP = { x: x + 38, y: y + 42, z: z + 48 };
    const toL = { x, y: y + 2, z };
    const flightOpts = { durMs: opts.durMs ?? 900, fov: 48 };
    const scene = window.__MM_SCENE__;
    if (typeof scene?.startGarbageFlight === "function") {
      scene.startGarbageFlight(toP, toL, flightOpts);
    } else if (typeof scene?.startDrainageFlight === "function") {
      scene.startDrainageFlight(toP, toL, flightOpts);
    }

    // Sync chainage + pin exact BOD/COD so LIVE WEATHER matches the hotspot card.
    void syncHotspotBodCod(h, x, z);

    return { hotspot: h, x, z, toP, toL };
  }

  async function syncHotspotBodCod(h, x, z) {
    try {
      await ensureBodCodPixels();
    } catch {
      /* CSV may already be cached */
    }
    let liveData = null;
    try {
      liveData = await fetchBodCodViewerData(undefined, { forceLive: false });
    } catch {
      /* CSV / twin may still work */
    }
    const chain = sceneChainage();
    const near = nearestChainage(x, z, chain);
    const meters = Number.isFinite(near?.meters) ? near.meters : null;
    const live = meters != null ? sampleLiveBodCodAtMeters(meters, liveData) : null;
    const sampled =
      Number.isFinite(h.lon) && Number.isFinite(h.lat)
        ? sampleBodCodAtLonLat(h.lon, h.lat)
        : null;
    // Prefer JalNetra live at this chainage; else CSV / hotspot peak.
    const bod = Number.isFinite(live?.bod)
      ? live.bod
      : Number.isFinite(h.maxBod)
        ? h.maxBod
        : sampled?.bod;
    const cod = Number.isFinite(live?.cod)
      ? live.cod
      : Number.isFinite(h.maxCod)
        ? h.maxCod
        : sampled?.cod;

    if (meters != null) {
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: {
            meters,
            focus: false,
            fromPollutionHotspot: true,
            label: formatStation(meters),
            lon: h.lon,
            lat: h.lat,
          },
        }),
      );
    }

    document.dispatchEvent(
      new CustomEvent("pollution-hotspot-select", {
        detail: {
          id: h.id,
          rank: h.rank,
          name: h.name,
          lon: h.lon,
          lat: h.lat,
          meters,
          label: meters != null ? formatStation(meters) : h.name,
          bod,
          cod,
          liveDate: live?.date || null,
          source: live?.source || "csv",
          eutrophication: h.eutrophication || null,
          nitrogen: h.nitrogen || null,
          coliform: h.coliform || null,
          composite: h.composite,
          color: h.color,
          shadeLabel: h.shadeLabel,
        },
      }),
    );
  }

  function sceneChainage() {
    if (chainage.length) return chainage;
    return window.__MM_SCENE__?.dataset?.chainage || [];
  }

  function getData() {
    return data;
  }

  function getHotspots() {
    return data?.hotspots || [];
  }

  group.userData = {
    ensureLoaded,
    setVisible,
    setSelected,
    focusHotspot,
    getData,
    getHotspots,
    clear,
  };

  void dataset;
  return group;
}

function fmt(v) {
  return Number.isFinite(v) ? Number(v).toFixed(1) : "—";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
