import * as THREE from 'three';
import { makeTraffic, glowTexture } from './cityTraffic.js';

/*
 * The city outside the window: a deep, fog-drowned canyon of towers.
 *
 * Built in the same "screen units" as the room (rig-local, 1 unit ≈ 33 cm), so
 * sizes below are written in metres and converted with M. The room is around
 * the 100th floor (~350 m up), looking out of the window (-z):
 *
 *   - a cross street runs left↔right far below the window (never seen),
 *   - across it, the main street runs straight away and never ends,
 *   - the corner towers either side of it face the window, closing the view
 *     left and right — you can only guess the cross street behind them.
 *
 * Detail, roughly from far to near:
 *   - per-tower facade styles (floor height, bays, piers, streaks), in the shader,
 *   - ledges, utility boxes and pipes on the faces that can be seen,
 *   - cables sagging across the canyon, blinking red warning lights,
 *   - flying traffic (cityTraffic.js),
 *   - exponential fog (main.js, CITY_FOG), drifting haze sheets, light shafts
 *     and a warm glow rising from the street far below.
 */

const M = 3; // screen units per metre

export const CITY_FOG = {
  color: 0x5d6d7c,
  density: 1 / (240 * M), // per screen unit; main.js converts to per-px
};

const STREET_Y = -350 * M; // ~100 floors down
const MAIN_HALF = 16 * M; // main street half-width
const CROSS_FAR = -45 * M; // tower fronts across the cross street
const ALLEY = 5 * M;
const EXTENT = { x: 700 * M, z: -2000 * M };
const DETAIL_Y = { min: -170 * M, max: 230 * M }; // height band worth detailing (visible from the room)

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// ---------- Layout ----------

/**
 * Tight lots in columns either side of the main street, rows going away from
 * the window. Alleys are narrow enough to read as solid walls of buildings.
 * Also records the faces that can be seen from the room (onto the main street,
 * and the fronts facing the window), for detailing.
 */
function planCity(rand) {
  const towers = [];
  const faces = [];

  for (const side of [-1, 1]) {
    let x = MAIN_HALF;
    for (let col = 0; x < EXTENT.x; col++) {
      const width = (28 + rand() * 30) * M;
      let z = CROSS_FAR;
      for (let row = 0; z > EXTENT.z; row++) {
        const length = (26 + rand() * 34) * M;
        const cx = side * (x + width / 2);
        const cz = z - length / 2;
        const distance = Math.hypot(cx, cz);

        // Tall everywhere: 250–750 m, the odd giant beyond 1 km.
        const giant = rand() < 0.06;
        const h = (giant ? 1000 + rand() * 500 : 250 + rand() * 500) * M * (1 + distance / (3000 * M));
        const top = STREET_Y + h;
        towers.push({ x: cx, z: cz, w: width, d: length, h, giant });

        // Setbacks near the top.
        let th = h, k = 1;
        for (let s = 0; s < 2 && rand() < 0.5; s++) {
          k *= 0.6 + rand() * 0.25;
          th *= 1.06 + rand() * 0.12;
          towers.push({ x: cx, z: cz, w: width * k, d: length * k, h: th });
        }

        // Visible faces (only the nearer ones are worth the detail).
        if (col === 0 && row < 30) {
          faces.push({ axis: 'x', plane: side * x, normal: -side, from: cz - length / 2, to: cz + length / 2, top, distance });
        }
        if (row === 0 && col < 8) {
          faces.push({ axis: 'z', plane: CROSS_FAR, normal: 1, from: cx - width / 2, to: cx + width / 2, top, distance });
        }

        z -= length + ALLEY;
      }
      x += width + ALLEY;
    }
  }
  return { towers, faces };
}

// ---------- Towers ----------

/**
 * Facades computed in the shader from position, so every tower size tiles
 * correctly. Each tower gets its own style from a hash of its position: floor
 * height, bay width, window proportion, structural piers, mechanical bands,
 * vertical rain streaks, and how many windows are lit.
 */
function towerMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0x4f5964, roughness: 0.9, metalness: 0.05 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vCity;
varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vCity = (instanceMatrix * vec4(transformed, 1.0)).xyz;
vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCity;
varying float vSeed;
float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
const float M = ${M.toFixed(1)};
float floorH = mix(3.2, 4.4, fract(vSeed * 7.13)) * M;
float bayW = mix(1.3, 3.4, fract(vSeed * 13.7)) * M;
float sill = mix(0.18, 0.55, fract(vSeed * 3.31));
float mech = floor(mix(9.0, 18.0, fract(vSeed * 5.77)));
float piers = step(0.45, fract(vSeed * 9.41));

vec2 cell = vec2((vCity.x + vCity.z) / bayW, vCity.y / floorH);
vec2 f = fract(cell);
float glass = step(sill, f.y) * step(f.x, 0.86);
glass *= step(1.0, mod(floor(cell.y), mech));               // solid mechanical floors
glass *= 1.0 - piers * step(mod(floor(cell.x), 5.0), 0.5);   // a solid pier every 5 bays

// Concrete tone varies per column and darkens in long vertical streaks.
float streak = cityHash(vec2(floor(cell.x * 0.5), 3.0));
float grime = 0.82 + 0.18 * streak - 0.12 * smoothstep(0.6, 1.0, cityHash(vec2(floor(cell.x), floor(cell.y / 7.0))));
diffuseColor.rgb *= grime * mix(1.0, 0.28, glass);

float litRate = mix(0.012, 0.05, fract(vSeed * 2.17));
float lit = glass * step(1.0 - litRate, cityHash(floor(cell) + vSeed * 17.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float tone = cityHash(floor(cell) + 7.0);
vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(0.72, 0.84, 1.0), step(0.6, tone));
totalEmissiveRadiance += lit * warm * mix(0.4, 0.9, tone);`);
  };
  return material;
}

function makeTowers(plan, rand) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // base at y = 0
  const towers = new THREE.InstancedMesh(geo, towerMaterial(), plan.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  plan.forEach((t, i) => {
    m.makeScale(t.w, t.h, t.d).setPosition(t.x, STREET_Y, t.z);
    towers.setMatrixAt(i, m);
    towers.setColorAt(i, color.setHSL(0.58, 0.06 + rand() * 0.04, 0.38 + rand() * 0.25));
  });
  return towers;
}

// ---------- Facade details ----------

/**
 * Boxes stuck onto the visible faces: ledges at intervals, utility boxes and
 * vertical pipes. One instanced mesh for all of them.
 */
function makeFacadeDetail(faces, rand) {
  const parts = []; // { along, y, w, h, depth, face }

  for (const face of faces) {
    const yMax = Math.min(face.top - 10 * M, DETAIL_Y.max);
    if (yMax <= DETAIL_Y.min) continue;
    const span = face.to - face.from;

    // Ledges every 30–60 m.
    const step = (30 + rand() * 30) * M;
    for (let y = DETAIL_Y.min + rand() * step; y < yMax; y += step) {
      parts.push({ face, along: face.from + span / 2, y, w: span - 1 * M, h: (0.5 + rand() * 0.6) * M, depth: (0.8 + rand() * 1.2) * M });
    }

    // Utility boxes: more on nearer faces.
    const count = Math.round(THREE.MathUtils.clamp(9000 * M / face.distance, 12, 70));
    for (let i = 0; i < count; i++) {
      const w = (1.2 + rand() * 3) * M;
      parts.push({
        face,
        along: face.from + w / 2 + rand() * (span - w),
        y: DETAIL_Y.min + rand() * (yMax - DETAIL_Y.min),
        w, h: (0.8 + rand() * 2.2) * M, depth: (0.5 + rand() * 1.2) * M,
      });
    }

    // A few long vertical pipes.
    for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
      const h = (60 + rand() * 180) * M;
      parts.push({
        face,
        along: face.from + rand() * span,
        y: DETAIL_Y.min + rand() * (yMax - DETAIL_Y.min - h * 0.5) + h / 2,
        w: (0.4 + rand() * 0.4) * M, h, depth: (0.4 + rand() * 0.4) * M,
      });
    }
  }

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x3d454e, roughness: 0.85, metalness: 0.15 }),
    parts.length
  );
  const m = new THREE.Matrix4();
  parts.forEach((p, i) => {
    const out = p.face.plane + p.face.normal * p.depth / 2;
    if (p.face.axis === 'x') m.makeScale(p.depth, p.h, p.w).setPosition(out, p.y, p.along);
    else m.makeScale(p.w, p.h, p.depth).setPosition(p.along, p.y, out);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

/** Cables sagging across the main street between facing towers. */
function makeCables(rand) {
  const points = [];
  const segments = 16;
  for (let i = 0; i < 70; i++) {
    const z = CROSS_FAR - (20 + rand() * 900) * M;
    const y = (-150 + rand() * 260) * M;
    const sag = (3 + rand() * 12) * M;
    const skew = (rand() - 0.5) * 20 * M; // ends at slightly different depths
    for (let s = 0; s < segments; s++) {
      for (const k of [s / segments, (s + 1) / segments]) {
        points.push(
          THREE.MathUtils.lerp(-MAIN_HALF, MAIN_HALF, k),
          y - sag * 4 * k * (1 - k),
          z + skew * (k - 0.5)
        );
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1b2026 }));
}

/**
 * Red aircraft-warning lights on tower corners, blinking slowly out of sync.
 * Returns { points, update(t) }; point size is in world px so it needs `h`.
 */
function makeWarningLights(faces, towers, rand) {
  const lights = [];
  for (const face of faces) {
    const yMax = Math.min(face.top, DETAIL_Y.max);
    for (let y = DETAIL_Y.min + rand() * 60 * M; y < yMax; y += (50 + rand() * 60) * M) {
      for (const along of [face.from + 0.5 * M, face.to - 0.5 * M]) {
        if (rand() < 0.5) continue;
        const out = face.plane + face.normal * 0.6 * M;
        lights.push(face.axis === 'x' ? [out, y, along] : [along, y, out]);
      }
    }
  }
  // Rooftop beacons on the giants (seen far down the canyon).
  for (const t of towers) {
    if (t.giant) lights.push([t.x, STREET_Y + t.h + 4 * M, t.z]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(lights.flat(), 3));
  const colors = new Float32Array(lights.length * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const phases = lights.map(() => rand() * 10);
  const periods = lights.map(() => 1.6 + rand() * 1.4);

  const material = new THREE.PointsMaterial({
    map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, size: 1,
  });
  const points = new THREE.Points(geo, material);

  function update(t, h) {
    material.size = 3.5 * M * h; // ~3.5 m glow, in world px
    for (let i = 0; i < lights.length; i++) {
      const on = ((t + phases[i]) % periods[i]) < 0.35 ? 1 : 0.12;
      colors[i * 3] = on;
      colors[i * 3 + 1] = on * 0.12;
      colors[i * 3 + 2] = on * 0.08;
    }
    geo.attributes.color.needsUpdate = true;
  }
  return { points, update };
}

// ---------- Atmosphere ----------

function gradientTexture(stops, horizontal = false) {
  const c = document.createElement('canvas');
  c.width = horizontal ? 256 : 4;
  c.height = horizontal ? 4 : 256;
  const ctx = c.getContext('2d');
  const grad = horizontal ? ctx.createLinearGradient(0, 0, c.width, 0) : ctx.createLinearGradient(0, 0, 0, c.height);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tileable soft cloud noise (used as an alpha mask that drifts). */
function cloudTexture(rand) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const x = rand() * size, y = rand() * size, r = 10 + rand() * 50;
    const v = rand() < 0.5 ? 255 : 0;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${v},${v},${v},${0.12 + rand() * 0.1})`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Sky at the end of the canyon: hazy, brighter towards the horizon. */
function makeSky() {
  const tex = gradientTexture([[0, '#2b3542'], [0.5, '#55687a'], [0.72, '#7b8d9c'], [1, '#5d6d7c']]);
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(10000 * M, 4000 * M),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, depthWrite: false })
  );
  sky.position.set(0, 600 * M, -2600 * M);
  return sky;
}

/** Layers of haze, thickening towards the depths, with slowly drifting clouds. */
function makeHaze(rand) {
  const g = new THREE.Group();
  const drift = [];
  const tex = gradientTexture([
    [0, 'rgba(150,168,184,0)'],
    [0.4, 'rgba(150,168,184,0.3)'],
    [1, 'rgba(150,168,184,0.95)'],
  ]);
  for (const [z, opacity] of [[-70, 0.2], [-130, 0.26], [-200, 0.3], [-290, 0.34], [-420, 0.38], [-600, 0.44], [-850, 0.5]]) {
    const clouds = cloudTexture(rand);
    clouds.repeat.set(3 + rand() * 2, 1);
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(1600 * M, 400 * M),
      new THREE.MeshBasicMaterial({ map: tex, alphaMap: clouds, transparent: true, opacity, depthWrite: false })
    );
    sheet.position.set(0, -150 * M, z * M); // from deep below up to ~50 m above the window
    g.add(sheet);
    drift.push({ tex: clouds, speed: (0.004 + rand() * 0.006) * (rand() < 0.5 ? 1 : -1) });
  }

  // Warm glow rising from the streets far below.
  const warm = gradientTexture([[0, 'rgba(255,170,110,0)'], [1, 'rgba(255,170,110,1)']]);
  for (const z of [-160, -380, -700]) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(MAIN_HALF * 2.4, 320 * M),
      new THREE.MeshBasicMaterial({
        map: warm, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    glow.position.set(0, -200 * M, z * M);
    g.add(glow);
  }

  return {
    group: g,
    update(dt) { for (const d of drift) d.tex.offset.x += d.speed * dt; },
  };
}

/** Pale light shafts falling into the canyon. */
function makeShafts() {
  const g = new THREE.Group();
  const across = gradientTexture([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], true);
  const down = gradientTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  for (const [x, z, w, tilt] of [[-8, -200, 16, 0.1], [10, -340, 24, -0.07], [-2, -560, 34, 0.04]]) {
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(w * M, 500 * M),
      new THREE.MeshBasicMaterial({
        map: across, alphaMap: down, color: 0xbfd2e4, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    shaft.position.set(x * M, 0, z * M);
    shaft.rotation.z = tilt;
    g.add(shaft);
  }
  return g;
}

/** Skybridges spanning the main street, above and below the window. */
function makeBridges(rand) {
  const plan = [];
  for (let z = CROSS_FAR - 80 * M; z > -1200 * M; z -= (40 + rand() * 90) * M) {
    plan.push({ z, y: (-220 + rand() * 330) * M, h: (2 + rand() * 3) * M, d: (3 + rand() * 5) * M });
  }
  const bridges = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x343c45, roughness: 0.8 }),
    plan.length * 2
  );
  const m = new THREE.Matrix4();
  plan.forEach((b, i) => {
    m.makeScale(MAIN_HALF * 2 + 4 * M, b.h, b.d).setPosition(0, b.y, b.z);
    bridges.setMatrixAt(i * 2, m);
    // A thin railing/truss line under each bridge.
    m.makeScale(MAIN_HALF * 2 + 4 * M, 0.4 * M, b.d * 0.6).setPosition(0, b.y - b.h * 0.9, b.z);
    bridges.setMatrixAt(i * 2 + 1, m);
  });
  return bridges;
}

// ---------- Assembly ----------

/** Returns the city group; call `group.userData.update(t, dt)` every frame. */
export function makeCity() {
  const rand = seeded(2049);
  const g = new THREE.Group();
  const { towers, faces } = planCity(rand);

  const lights = makeWarningLights(faces, towers, rand);
  const haze = makeHaze(rand);
  const traffic = makeTraffic(M, rand, {
    mainHalf: MAIN_HALF,
    zFar: -1500 * M,
    crossNear: -10 * M,
    crossFar: CROSS_FAR + 5 * M,
    xSpan: 500 * M,
  });

  g.add(
    makeSky(),
    makeTowers(towers, rand),
    makeFacadeDetail(faces, rand),
    makeBridges(rand),
    makeCables(rand),
    lights.points,
    traffic.group,
    haze.group,
    makeShafts()
  );

  g.userData.update = (t, dt) => {
    const h = g.parent ? g.parent.scale.x : 1; // rig scale = viewport height in px
    lights.update(t, h);
    haze.update(dt);
    traffic.update(t, dt);
  };
  return g;
}
