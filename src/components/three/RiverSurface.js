import * as THREE from "three";
import { lonLatToLocal } from "../../utils/chainageUtils.js";

/**
 * Build a river ribbon mesh from the actual Mula-Mutha centerline.
 * Converts geographic coordinates to local metric XZ space.
 */
export function createRiverSurface(data, originLon, originLat) {
  const chainages = data.chainage_m || data.chainage || [];
  const lats = data.lat || data.latitude || [];
  const lons = data.lon || data.longitude || [];
  const widths = data.real_width_m || data.width_m || data.width || [];

  if (chainages.length < 2) return new THREE.Group();

  const n = chainages.length;
  const positions = [];
  const indices = [];

  for (let i = 0; i < n; i++) {
    const { x, z } = lonLatToLocal(lons[i], lats[i], originLon, originLat);
    const halfW = Math.max(8, (widths[i] || 50) * 0.5);

    // Compute tangent for perpendicular offset
    let tx = 0, tz = 1;
    if (i < n - 1) {
      const next = lonLatToLocal(lons[i + 1], lats[i + 1], originLon, originLat);
      const dx = next.x - x, dz = next.z - z;
      const len = Math.hypot(dx, dz) || 1;
      tx = dx / len; tz = dz / len;
    }
    // Left bank
    positions.push(x - tz * halfW, 0.2, z + tx * halfW);
    // Right bank
    positions.push(x + tz * halfW, 0.2, z - tx * halfW);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlowSpeed: { value: 0.35 } },
    vertexShader: `
      uniform float uTime;
      uniform float uFlowSpeed;
      varying vec2 vUv;
      void main() {
        vUv = vec2(position.x * 0.002, position.z * 0.002 + uTime * uFlowSpeed * 0.3);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float wave1 = sin(vUv.x * 8.0 + uTime * 1.2) * 0.04;
        float wave2 = sin(vUv.y * 5.0 + uTime * 0.8 + 1.3) * 0.03;
        float wave3 = sin((vUv.x + vUv.y) * 12.0 + uTime * 0.6) * 0.02;
        float brightness = 0.52 + wave1 + wave2 + wave3;
        vec3 deep = vec3(0.04, 0.22, 0.45);
        vec3 shallow = vec3(0.12, 0.55, 0.75);
        float t = smoothstep(0.45, 0.65, brightness);
        vec3 color = mix(deep, shallow, t);
        gl_FragColor = vec4(color, 0.92);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "river-surface";

  // update method called from animation loop
  mesh.update = function(time, speed) {
    mat.uniforms.uTime.value = time * 0.001;
    mat.uniforms.uFlowSpeed.value = speed;
  };

  return mesh;
}
