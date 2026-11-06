import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

const COUNT = 900;

/**
 * Rain is shown only when the selected river location reports precipitation.
 * Drops fall over the channel and the adjoining banks, following terrain.
 */
export function createRiverRain(dataset, { getTerrainY = () => SURFACE_Y } = {}) {
  const stations = dataset?.corridor?.stations || [];
  const group = new THREE.Group();
  group.name = "riverRain";
  group.visible = true;

  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  const life = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    life[i] = -1;
    pos[i * 3 + 1] = -999;
    vel[i] = 18 + Math.random() * 22;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(28.0 / -mv.z, 1.2, 4.5);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5, 0.15);
        float d = length(c * vec2(1.8, 0.55));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d) * uOpacity;
        gl_FragColor = vec4(0.78, 0.88, 0.98, a);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 12;
  group.add(points);

  let intensity = 0.35; // 0..1 from live weather
  let windX = 0.15;
  let windZ = 0.05;
  let raining = false;
  let activeOpacity = 0;

  function pickStationXZ() {
    if (!stations.length) return { x: 0, z: 0, half: 40 };
    const s = stations[Math.floor(Math.random() * stations.length)];
    const u = Math.random() * 2 - 1;
    const half = Math.max(12, (s.halfWidth || 40) * 3.2);
    const px = -(s.flowZ || 0);
    const pz = s.flowX || 1;
    const plen = Math.hypot(px, pz) || 1;
    return {
      x: s.x + (px / plen) * u * half,
      z: s.z + (pz / plen) * u * half,
      half,
    };
  }

  function respawn(i) {
    const p = pickStationXZ();
    pos[i * 3] = p.x + (Math.random() - 0.5) * 6;
    pos[i * 3 + 1] = getTerrainY(pos[i * 3], pos[i * 3 + 2]) + 42 + Math.random() * 65;
    pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 6;
    vel[i] = 22 + Math.random() * 28 + intensity * 18;
    life[i] = 0.6 + Math.random() * 1.1;
  }

  function applyLiveWeather(weather) {
    if (!weather) return;
    const code = Number(weather.code);
    const precip = Number(weather.precipitation);
    const cloud = Number(weather.cloudCover);

    const wetCode = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
    const wetRate = Number.isFinite(precip) ? precip : 0;
    intensity = wetCode || wetRate > 0
      ? THREE.MathUtils.clamp(0.22 + Math.max(wetRate, wetCode ? 0.15 : 0) * 0.22, 0.22, 1)
      : 0;

    const wind = Number(weather.wind);
    if (Number.isFinite(wind)) {
      const a = ((Number(weather.windDir) || 220) * Math.PI) / 180;
      const w = THREE.MathUtils.clamp(wind / 40, 0.05, 0.55);
      windX = Math.sin(a) * w;
      windZ = Math.cos(a) * w;
    }
  }

  function update(dt) {
    if (state.cinematicActive) {
      mat.uniforms.uOpacity.value = 0;
      return;
    }

    const currentIntensity = intensity;
    raining = currentIntensity > 0;

    const targetOpacity = raining ? 0.35 + currentIntensity * 0.55 : 0;
    activeOpacity += (targetOpacity - activeOpacity) * Math.min(1, dt * 6);
    mat.uniforms.uOpacity.value = activeOpacity;

    if (activeOpacity < 0.02 && !raining) return;

    const spawnRate = raining ? 100 + currentIntensity * 240 : 0;
    let toSpawn = spawnRate * dt;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] < 0) {
        if (toSpawn > 0 && raining) {
          respawn(i);
          toSpawn -= 1;
        }
        continue;
      }
      life[i] -= dt;
      pos[i * 3] += windX * vel[i] * dt * 0.35;
      pos[i * 3 + 1] -= vel[i] * dt;
      pos[i * 3 + 2] += windZ * vel[i] * dt * 0.35;
      const groundY = getTerrainY(pos[i * 3], pos[i * 3 + 2]);
      if (pos[i * 3 + 1] <= groundY + 0.4 || life[i] <= 0) {
        if (raining && toSpawn > 0) {
          respawn(i);
          toSpawn -= 1;
        } else {
          life[i] = -1;
          pos[i * 3 + 1] = -999;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    group,
    update,
    applyLiveWeather,
    dispose() {
      geo.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}
