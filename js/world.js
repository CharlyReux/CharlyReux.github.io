import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeCity } from './city.js';
import { woodMaps, plasticMaps, brushedMaps, keycapMaps, legendTexture } from './textures.js';

/*
 * The room around the welcome page, built in "screen units": the main screen
 * is 1 unit tall, centred at the origin, facing +z. main.js scales the whole
 * rig by the viewport height so the CSS page ends up at 1:1 pixels.
 *
 * Rough real-world scale: 1 unit ≈ 33 cm (a 27" monitor's screen height).
 */

export const BEZEL = 0.035;
const SHELF_TOP = -0.91; // raised board the monitors stand on
const SHELF = { back: -0.6, front: 0.5, thickness: 0.04 };
export const DESK_TOP = SHELF_TOP - 0.3; // main desk surface, ≈ 10 cm lower

const FLOOR_Y = DESK_TOP - 2.3; // desk ≈ 75 cm tall
const WALL_Z = -0.7; // front face of the wall
const WALL_DEPTH = 0.15;

export const SIDE_W = 1.6; // side screens are 16:10
const SIDE_ANGLE = 0.45; // ≈ 26°, turned towards the viewer
const GAP = 0.06;

// Leaves a strip of wall on the left (in view) for the hammer; runs off-view on the right.
const WINDOW = { left: -2.2, right: 7, bottom: -0.6, top: 2.6, paneWidth: 1.6 };

// ---------- Materials ----------

// Surfaces you look at closely get procedural textures (textures.js): baked
// colour, roughness variation and bump, so maps carry the colour (white base).
const mat = {
  bezel: new THREE.MeshStandardMaterial({ ...plasticMaps({ color: "#1a1a1f", seed: 11 }), bumpScale: 0.4, metalness: 0.1 }),
  stand: new THREE.MeshStandardMaterial({ ...brushedMaps({ color: "#33333a", seed: 12 }), metalness: 0.8 }),
  desk: new THREE.MeshStandardMaterial({ ...woodMaps({ dark: "#4a3526", light: "#8c6b50", seed: 13 }), bumpScale: 1.2 }),
  shelf: new THREE.MeshStandardMaterial({ ...woodMaps({ dark: "#5a412b", light: "#a07d5e", seed: 14 }), bumpScale: 1.2 }),
  deskLeg: new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.6 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xcfc8bd, roughness: 0.95 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.5, metalness: 0.2 }),
  sill: new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.6 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x3b2e25, roughness: 0.8 }),
  kbBase: new THREE.MeshStandardMaterial({ ...brushedMaps({ color: "#2e2e35", seed: 15 }), metalness: 0.6 }),
  key: new THREE.MeshStandardMaterial({ color: 0x34343b, ...keycapMaps({ seed: 16 }), bumpScale: 0.3 }),
  mouse: new THREE.MeshStandardMaterial({ ...plasticMaps({ color: "#26262c", seed: 17, dust: 120 }), bumpScale: 0.3, metalness: 0.1 }),
  pad: new THREE.MeshStandardMaterial({ ...plasticMaps({ color: "#141418", seed: 18, dust: 160 }), roughness: 1, bumpScale: 0.6 }),
};

function setRepeat(material, x, y) {
  for (const key of ["map", "roughnessMap", "bumpMap"]) material[key]?.repeat.set(x, y);
}

function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------- Monitors ----------

/** A monitor centred on its screen (the screen itself is a CSS3D page added by main.js). */
function makeMonitor(width) {
  const g = new THREE.Group();

  const bezel = mesh(new THREE.BoxGeometry(1, 1 + BEZEL * 2, 0.05), mat.bezel);
  bezel.scale.x = width + BEZEL * 2;
  bezel.position.z = -0.026; // front face just behind the screen plane
  g.add(bezel);

  const neck = mesh(new THREE.BoxGeometry(0.12, 0.42, 0.035), mat.stand);
  neck.position.set(0, -0.69, -0.09);
  g.add(neck);

  const base = mesh(new THREE.BoxGeometry(0.46, 0.02, 0.28), mat.stand);
  base.position.set(0, SHELF_TOP + 0.01, -0.06);
  g.add(base);

  g.userData.bezel = bezel;
  return g;
}

// ---------- Keyboard & mouse ----------

function makeKeyboard() {
  const g = new THREE.Group();
  const W = 1.32, D = 0.42, H = 0.03;

  const base = mesh(new THREE.BoxGeometry(W, H, D), mat.kbBase);
  base.position.y = H / 2;
  g.add(base);

  // Key layout: 4 full rows of 15, then a bottom row with a space bar.
  const pitch = 0.084, size = 0.07, cols = 15;
  const slots = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) slots.push([c, r, 1]);
  for (const c of [0, 1, 2, 3]) slots.push([c, 4, 1]);
  slots.push([4, 4, 7]); // space bar spans 7 keys
  for (const c of [11, 12, 13, 14]) slots.push([c, 4, 1]);

  const LABELS = [
    ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "\\", "⌫"],
    ["Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "Del", "Home"],
    ["Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "#", "Enter", "PgUp"],
    ["Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Shift", "↑", "End", "PgDn"],
  ];
  const BOTTOM = { 0: "Ctrl", 1: "Fn", 2: "Alt", 3: "Cmd", 4: "", 11: "Alt", 12: "←", 13: "↓", 14: "→" };

  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.025, size), mat.key, slots.length);
  keys.castShadow = true;
  const m = new THREE.Matrix4();
  const tint = new THREE.Color();
  const x0 = -((cols - 1) * pitch) / 2, z0 = -2 * pitch;
  const legends = [];
  slots.forEach(([c, r, span], i) => {
    const width = size + (span - 1) * pitch;
    const x = x0 + c * pitch + ((span - 1) * pitch) / 2;
    const z = z0 + r * pitch;
    m.makeScale(width, 1, 1).setPosition(x, H + 0.0125, z);
    keys.setMatrixAt(i, m);
    // Slight per-key variation; much-used keys are a touch lighter (shiny wear).
    const label = r < 4 ? LABELS[r][c] : BOTTOM[c];
    const worn = ["W", "A", "S", "D", "E", "Shift", "Ctrl", "Space", "⌫", "Enter"].includes(label) || span > 1;
    keys.setColorAt(i, tint.setScalar((worn ? 1.12 : 0.94) + Math.random() * 0.08));
    legends.push({ x, z, w: width, label });
  });
  g.add(keys);

  const legendPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshBasicMaterial({ map: legendTexture(legends, W, D), transparent: true, opacity: 0.7, depthWrite: false })
  );
  legendPlane.rotation.x = -Math.PI / 2;
  legendPlane.position.y = H + 0.0255;
  g.add(legendPlane);
  return g;
}

/**
 * Ergonomic mouse (~12 × 6.5 × 4 cm), front towards -z, resting on y = 0.
 * The shell is a sphere reshaped by `mouseShape`: wider at the back, a waist
 * for the thumb, highest towards the rear, flat underneath. Grooves are tubes
 * laid on that same surface.
 */
const MOUSE = { halfL: 0.18, halfW: 0.105, height: 0.12 };

function mouseShape(x, y, z) {
  const width = 0.86 + 0.14 * z - 0.08 * Math.exp(-(((z + 0.05) / 0.35) ** 2)); // waist
  const rise = 1 - 0.55 * ((z - 0.3) / 1.3) ** 2; // hump towards the back
  return new THREE.Vector3(
    x * MOUSE.halfW * width,
    y > 0 ? y * MOUSE.height * rise : y * 0.006,
    z * MOUSE.halfL
  );
}

/** Point on the top of the shell for unit-sphere x/z (|x|,|z| < 1). */
function mouseSurface(x, z, lift = 0.0015) {
  const y = Math.sqrt(Math.max(0, 1 - x * x - z * z));
  const p = mouseShape(x, y, z);
  p.y += lift;
  return p;
}

function makeMouse() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.95 });

  // Shell
  const geo = new THREE.SphereGeometry(1, 72, 36);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const p = mouseShape(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  const shell = mesh(geo, mat.mouse);
  shell.position.y = 0.006;
  g.add(shell);

  // Rubber skirt around the base, a touch wider than the shell.
  const skirt = mesh(geo, rubber);
  skirt.scale.set(1.02, 0.16, 1.02);
  skirt.position.y = 0.006;
  g.add(skirt);

  // Grooves: across the top where the buttons end, and down the middle.
  const groove = (points) => {
    const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.0018, 6), dark, { cast: false });
    tube.position.y = 0.006;
    g.add(tube);
  };
  const zEnd = 0.05; // buttons cover the front ~half
  groove(Array.from({ length: 13 }, (_, i) => mouseSurface(-0.8 + (1.6 * i) / 12, zEnd)));
  groove(Array.from({ length: 9 }, (_, i) => mouseSurface(0, -0.97 + ((zEnd + 0.97) * i) / 8)));

  // Scroll wheel in a recessed slot, with rubber ridges.
  const top = mouseSurface(0, -0.5, 0);
  const slot = mesh(new THREE.BoxGeometry(0.02, 0.012, 0.05), dark, { cast: false });
  slot.position.set(0, top.y + 0.0, top.z);
  slot.rotation.x = 0.28;
  g.add(slot);
  const wheel = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 24), rubber);
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, top.y + 0.004, top.z);
  g.add(wheel);
  for (let i = 0; i < 16; i++) {
    const ridge = mesh(new THREE.BoxGeometry(0.0125, 0.002, 0.003), mat.key, { cast: false });
    const a = (i / 16) * Math.PI * 2;
    ridge.position.set(0, top.y + 0.004 + Math.cos(a) * 0.0175, top.z + Math.sin(a) * 0.0175);
    ridge.rotation.x = -a;
    g.add(ridge);
  }

  // Two thumb buttons on the left side.
  for (const [z, len] of [[-0.28, 0.04], [0.02, 0.036]]) {
    const side = mouseShape(-1, 0.45, z / 1);
    const b = mesh(new THREE.CapsuleGeometry(0.006, len, 4, 8), mat.mouse);
    b.rotation.x = Math.PI / 2;
    b.position.set(side.x - 0.002, 0.006 + side.y * 0.85, side.z);
    g.add(b);
  }

  // Small status light behind the wheel.
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.008, 0.002, 0.003),
    new THREE.MeshBasicMaterial({ color: 0xff5a2a, toneMapped: false })
  );
  const ledAt = mouseSurface(0, -0.2, 0.0005);
  led.position.set(0, 0.006 + ledAt.y, ledAt.z);
  g.add(led);
  return g;
}

/** XL cloth desk mat with rounded corners and a stitched edge; rests on y = 0. */
const MAT_THICKNESS = 0.008;

function makeDeskMat(width, depth) {
  const r = 0.06;
  const s = new THREE.Shape();
  s.moveTo(-width / 2 + r, -depth / 2);
  s.lineTo(width / 2 - r, -depth / 2);
  s.quadraticCurveTo(width / 2, -depth / 2, width / 2, -depth / 2 + r);
  s.lineTo(width / 2, depth / 2 - r);
  s.quadraticCurveTo(width / 2, depth / 2, width / 2 - r, depth / 2);
  s.lineTo(-width / 2 + r, depth / 2);
  s.quadraticCurveTo(-width / 2, depth / 2, -width / 2, depth / 2 - r);
  s.lineTo(-width / 2, -depth / 2 + r);
  s.quadraticCurveTo(-width / 2, -depth / 2, -width / 2 + r, -depth / 2);

  const geo = new THREE.ExtrudeGeometry(s, { depth: MAT_THICKNESS, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2); // lie flat, top at y = thickness
  const hem = new THREE.MeshStandardMaterial({ color: 0x2c2c33, roughness: 0.9 });
  // Extrude groups: 0 = top/bottom faces (cloth), 1 = sides (stitched hem).
  const pad = mesh(geo, [mat.pad, hem], { cast: false });
  for (const key of ['map', 'roughnessMap', 'bumpMap']) mat.pad[key]?.repeat.set(1.5, 1.5);
  return pad;
}

// ---------- Room ----------

function makeWall() {
  const g = new THREE.Group();
  const { left, right, bottom, top, paneWidth } = WINDOW;
  const width = right - left;
  const midX = (left + right) / 2;
  const panes = Math.round(width / paneWidth);

  const shape = new THREE.Shape();
  shape.moveTo(-12, FLOOR_Y);
  shape.lineTo(12, FLOOR_Y);
  shape.lineTo(12, 6);
  shape.lineTo(-12, 6);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(left, bottom);
  hole.lineTo(left, top);
  hole.lineTo(right, top);
  hole.lineTo(right, bottom);
  hole.closePath();
  shape.holes.push(hole);

  const wall = mesh(new THREE.ExtrudeGeometry(shape, { depth: WALL_DEPTH, bevelEnabled: false }), mat.wall, { cast: false });
  wall.position.z = WALL_Z - WALL_DEPTH;
  g.add(wall);

  // Frame: outer border plus mullions, set back in the reveal.
  const t = 0.05, d = 0.06, z = WALL_Z - WALL_DEPTH * 0.6;
  const bar = (w, h, x, y) => {
    const b = mesh(new THREE.BoxGeometry(w, h, d), mat.frame);
    b.position.set(x, y, z);
    g.add(b);
  };
  const midY = (top + bottom) / 2, height = top - bottom;
  bar(width, t, midX, top - t / 2);
  bar(width, t, midX, bottom + t / 2);
  bar(t, height, left + t / 2, midY);
  bar(t, height, right - t / 2, midY);
  for (let i = 1; i < panes; i++) bar(t * 0.7, height, left + (width * i) / panes, midY);

  const sill = mesh(new THREE.BoxGeometry(width + 0.2, 0.03, WALL_DEPTH + 0.12), mat.sill);
  sill.position.set(midX, bottom - 0.015, WALL_Z - WALL_DEPTH / 2 + 0.06);
  g.add(sill);

  return g;
}

/** Two-step desk: the main surface, plus a raised shelf at the back for the monitors. */
function makeDesk() {
  const g = new THREE.Group();
  const top = mesh(new THREE.BoxGeometry(1, 0.05, 2.3), mat.desk);
  top.position.set(0, DESK_TOP - 0.025, 0.5);
  g.add(top);

  const depth = SHELF.front - SHELF.back;
  const shelf = mesh(new THREE.BoxGeometry(1, SHELF.thickness, depth), mat.shelf);
  shelf.position.set(0, SHELF_TOP - SHELF.thickness / 2, (SHELF.front + SHELF.back) / 2);
  g.add(shelf);

  // Solid wooden end panels hold the shelf up.
  const panelH = SHELF_TOP - SHELF.thickness - DESK_TOP;
  const panels = [-1, 1].map((side) => {
    const p = mesh(new THREE.BoxGeometry(0.05, panelH, depth), mat.shelf);
    p.position.set(0, DESK_TOP + panelH / 2, shelf.position.z);
    p.userData.side = side;
    g.add(p);
    return p;
  });

  const legH = DESK_TOP - 0.05 - FLOOR_Y;
  const legs = [-1, 1].flatMap((side) =>
    [-0.5, 1.5].map((z) => {
      const leg = mesh(new THREE.BoxGeometry(0.08, legH, 0.08), mat.deskLeg);
      leg.position.set(0, FLOOR_Y + legH / 2, z);
      leg.userData.side = side;
      g.add(leg);
      return leg;
    })
  );

  g.userData = { top, shelf, panels, legs };
  return g;
}

// ---------- Toy car ----------

const CAR_DIR = "assets/models/octane/";
const CAR_LENGTH = 0.4; // screen units (≈ 13 cm, toy-car size)

// The FBX references its textures by absolute paths from the author's machine;
// remap them to the files shipped in CAR_DIR.
const CAR_TEXTURES = [
  [/chasis/i, "chassis.jpg"],
  [/W2048/i, "body.jpg"],
  [/W512/i, "wheel.jpg"],
];

/** Loads the car model into a group. Front faces +x, wheels rest on y = 0. */
function makeCar() {
  const g = new THREE.Group();

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.endsWith(".fbx")) return url;
    const hit = CAR_TEXTURES.find(([re]) => re.test(decodeURIComponent(url)));
    return hit ? CAR_DIR + hit[1] : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  });

  new FBXLoader(manager).load(CAR_DIR + "octane.fbx", (model) => {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of [].concat(o.material)) {
        m.normalMap = null; // the wheel normal map isn't included in the download
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.needsUpdate = true;
      }
    });

    // Normalise: longest horizontal side -> CAR_LENGTH, centred, resting on y = 0.
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(CAR_LENGTH / Math.max(size.x, size.z));
    box.setFromObject(model, true);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    g.add(model);
  });

  return g;
}

// ---------- Small props ----------

const textureLoader = new THREE.TextureLoader();

function loadTexture(url) {
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Framed print, centred on its face, facing +z. */
function makePoster(width) {
  const g = new THREE.Group();
  const aspect = 1500 / 962; // source image size
  const height = width / aspect;
  const border = 0.03;

  const frame = mesh(new THREE.BoxGeometry(width + border * 2, height + border * 2, 0.025), mat.frame);
  frame.position.z = 0.0125;
  g.add(frame);

  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: loadTexture('assets/images/poster.webp'), roughness: 0.75 })
  );
  art.position.z = 0.026;
  art.receiveShadow = true;
  g.add(art);
  return g;
}

/** Game case lying flat, cover up. Long side along z; rests on y = 0. */
function makeDvdCase() {
  const W = 0.405, L = 0.57, T = 0.042; // 135 × 190 × 14 mm
  const cover = loadTexture('assets/images/dvd-case.webp');
  // Crop the photo down to the case itself (pixel bounds in the 1080×1440 source).
  const [x0, x1, y0, y1] = [165, 845, 210, 1215];
  cover.repeat.set((x1 - x0) / 1080, (y1 - y0) / 1440);
  cover.offset.set(x0 / 1080, 1 - y1 / 1440);

  const plastic = new THREE.MeshStandardMaterial({ color: 0x8fd12a, roughness: 0.35 });
  const top = new THREE.MeshStandardMaterial({ map: cover, roughness: 0.3 });
  // Box faces: +x, -x, +y (cover), -y, +z, -z
  const box = mesh(new THREE.BoxGeometry(W, T, L), [plastic, plastic, top, plastic, plastic, plastic]);
  box.position.y = T / 2; // the +y face's texture top lands on the far (-z) edge
  const g = new THREE.Group();
  g.add(box);
  return g;
}

/** Orange silicone finger-extensor trainer lying flat: a little body with five rings. */
function makeFingerTrainer() {
  const g = new THREE.Group();
  const silicone = new THREE.MeshStandardMaterial({ color: 0xff6a1f, roughness: 0.65 });
  const T = 0.014; // thickness

  // Flat body (in the x/y plane, later laid down): torso, neck, arms, legs.
  const body = new THREE.Shape();
  body.moveTo(-0.035, -0.05);
  body.lineTo(-0.03, -0.085); // left leg
  body.lineTo(-0.012, -0.085);
  body.lineTo(-0.008, -0.055);
  body.lineTo(0.008, -0.055);
  body.lineTo(0.012, -0.085); // right leg
  body.lineTo(0.03, -0.085);
  body.lineTo(0.035, -0.05);
  body.lineTo(0.04, 0.015);
  body.lineTo(0.075, 0.005); // right arm
  body.lineTo(0.078, 0.022);
  body.lineTo(0.035, 0.04);
  body.lineTo(0.012, 0.045);
  body.lineTo(0.01, 0.075); // neck
  body.lineTo(-0.01, 0.075);
  body.lineTo(-0.012, 0.045);
  body.lineTo(-0.035, 0.04);
  body.lineTo(-0.078, 0.022); // left arm
  body.lineTo(-0.075, 0.005);
  body.lineTo(-0.04, 0.015);
  body.closePath();
  const torso = mesh(
    new THREE.ExtrudeGeometry(body, { depth: T * 0.7, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 }),
    silicone
  );
  torso.position.z = -T * 0.35;
  g.add(torso);

  // Rings: head (oval), two hands, two feet.
  const ring = (x, y, r, sy = 1) => {
    const m = mesh(new THREE.TorusGeometry(r, 0.011, 10, 32), silicone);
    m.position.set(x, y, 0);
    m.scale.set(1, sy, T / 0.022);
    g.add(m);
  };
  ring(0, 0.12, 0.04, 1.25);
  ring(-0.105, 0.0, 0.03);
  ring(0.105, 0.0, 0.03);
  ring(-0.04, -0.115, 0.03);
  ring(0.04, -0.115, 0.03);

  g.scale.setScalar(1.3); // ≈ 10 cm tall overall
  g.rotation.x = -Math.PI / 2; // lie flat, face up
  g.position.y = (T / 2) * 1.3;

  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

/**
 * Small wrought-iron wall hook: a back plate with two screws and a bent rod
 * curling up at the tip. Back of the plate at z = 0, facing +z, hook pointing up.
 */
function makeWallHook() {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2725, roughness: 0.75, metalness: 0.7 });

  const plate = mesh(new THREE.BoxGeometry(0.09, 0.16, 0.012), iron);
  plate.position.set(0, 0, 0.006);
  g.add(plate);
  for (const y of [-0.055, 0.055]) {
    const screw = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12), iron);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, y, 0.015);
    g.add(screw);
  }

  // Rod: out from the plate, down, then curling up into the hook.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.01, 0.012),
    new THREE.Vector3(0, -0.02, 0.06),
    new THREE.Vector3(0, -0.05, 0.12),
    new THREE.Vector3(0, -0.035, 0.17),
    new THREE.Vector3(0, 0.0, 0.18),
    new THREE.Vector3(0, 0.03, 0.165),
  ]);
  g.add(mesh(new THREE.TubeGeometry(curve, 40, 0.008, 10), iron));
  const tip = mesh(new THREE.SphereGeometry(0.011, 12, 8), iron);
  tip.position.copy(curve.getPoint(1));
  g.add(tip);
  return g;
}

/**
 * Tall wooden bookcase standing on the floor against the wall. Origin at the
 * floor, centre of its back edge; it extends towards +z. Returns the group and
 * the heights (top surfaces) of its shelves, bottom first.
 */
const BOOKCASE = { width: 1.9, depth: 0.8, height: 5.8, plinth: 0.12, board: 0.05, side: 0.06 };

function makeBookcase() {
  const { width, depth, height, plinth, board, side } = BOOKCASE;
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ ...woodMaps({ dark: "#4f3925", light: "#957254", seed: 19 }), bumpScale: 1.2 });
  setRepeat(wood, width / 2.4, depth / 1.2);
  const back = new THREE.MeshStandardMaterial({ ...woodMaps({ dark: "#4a3624", light: "#7d5f46", seed: 20 }), bumpScale: 0.8 });
  setRepeat(back, width / 2.4, height / 1.2);

  for (const x of [-1, 1]) {
    const panel = mesh(new THREE.BoxGeometry(side, height, depth), wood);
    panel.position.set(x * (width - side) / 2, height / 2, depth / 2);
    g.add(panel);
  }
  // The inside would sit in the side panel's shadow and read as black, so the
  // back and the shelves don't receive shadows.
  const backPanel = mesh(new THREE.BoxGeometry(width - side * 2, height, 0.02), back, { receive: false });
  backPanel.position.set(0, height / 2, 0.01);
  g.add(backPanel);
  const kick = mesh(new THREE.BoxGeometry(width - side * 2, plinth, 0.04), wood);
  kick.position.set(0, plinth / 2, depth - 0.03);
  g.add(kick);

  // Bottom, five shelves, top: evenly spaced.
  const shelves = [];
  const count = 7;
  const step = (height - plinth - board) / (count - 1);
  for (let i = 0; i < count; i++) {
    const y = plinth + i * step; // underside of this board
    const shelf = mesh(new THREE.BoxGeometry(width - side * 2, board, depth - 0.02), wood, { receive: false });
    shelf.position.set(0, y + board / 2, (depth - 0.02) / 2 + 0.02);
    g.add(shelf);
    shelves.push(y + board);
  }
  return { group: g, shelves };
}

/**
 * The user's own row of books, from their photo (assets/images/books.jpg,
 * 1640 × 925). Many books lean, so instead of cutting the photo into upright
 * blocks, the whole row is one solid extruded from the outline of the books
 * (traced by hand in photo pixels, left to right; the shelf in the photo is at
 * y = 812). The front face shows the photo exactly; tops and sides read as
 * page edges. Origin: left end of the row, on the shelf, front at z = 0.
 */
const BOOK_OUTLINE = [
  [0, 300], [52, 293], [150, 228], [231, 203], [399, 168], [400, 316], [443, 313],
  [490, 323], [550, 335], [611, 335], [614, 278], [771, 218], [773, 296], [790, 300],
  [800, 376], [807, 263], [862, 240], [868, 305], [960, 310], [961, 297], [1055, 297],
  [1100, 300], [1102, 285], [1220, 272], [1300, 323], [1365, 325], [1370, 295],
  [1450, 300], [1530, 305], [1575, 360], [1640, 380],
];

function makeBooks(rowWidth, depth = 0.28) {
  const [W, H, BASE] = [1640, 925, 812];
  // Shape in photo UV space (u = x / W, v = 1 - y / H), so the extruded front
  // face's UVs line up with the photo on their own.
  const v0 = 1 - BASE / H;
  const shape = new THREE.Shape();
  shape.moveTo(0, v0);
  for (const [x, y] of BOOK_OUTLINE) shape.lineTo(x / W, 1 - y / H);
  shape.lineTo(1, v0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const photo = loadTexture("assets/images/books.jpg");
  const front = new THREE.MeshStandardMaterial({ map: photo, roughness: 0.8 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xe2d8c2, roughness: 0.9 });
  // Extrude groups: 0 = front/back faces (photo), 1 = sides (page edges).
  const row = mesh(geo, [front, pages], { receive: false });
  const sy = (rowWidth * H) / W;
  row.scale.set(rowWidth, sy, 1);
  row.position.set(0, -v0 * sy, -depth);

  const g = new THREE.Group();
  g.add(row);
  return g;
}

/** Terminal screen texture: a Debian-style login and shell prompt. */
function terminalTexture() {
  const W = 1024, H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0d0f';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '26px "DejaVu Sans Mono", Consolas, monospace';
  ctx.textBaseline = 'top';
  const lines = [
    ['#b9bcc2', 'Debian GNU/Linux 12 workbench tty1'],
    ['#b9bcc2', ''],
    ['#b9bcc2', 'workbench login: charly'],
    ['#b9bcc2', 'Password:'],
    ['#b9bcc2', 'Linux workbench 6.1.0-28-amd64 #1 SMP x86_64'],
    ['#b9bcc2', ''],
    ['#8a8e96', 'The programs included with the Debian GNU/Linux system'],
    ['#8a8e96', 'are free software.'],
    ['#b9bcc2', ''],
    [null, '$ uptime'],
    ['#b9bcc2', ' 23:41:07 up 112 days,  4:02,  1 user,  load average: 0.08'],
    [null, '$ ls ~/projects'],
    ['#6cb4ff', 'digital  kalo  knowledge-map  vtikz'],
    [null, '$ '],
  ];
  let y = 28;
  for (const [color, text] of lines) {
    if (color) {
      ctx.fillStyle = color;
      ctx.fillText(text, 28, y);
    } else {
      // Prompt: user@host in green, path in blue, then the command.
      const user = 'charly@workbench', path = ':~';
      ctx.fillStyle = '#7fd36a'; ctx.fillText(user, 28, y);
      let x = 28 + ctx.measureText(user).width;
      ctx.fillStyle = '#6cb4ff'; ctx.fillText(path, x, y);
      x += ctx.measureText(path).width;
      ctx.fillStyle = '#e8e8ea'; ctx.fillText(text, x, y);
      if (text === '$ ') { // blinking-cursor block
        ctx.fillRect(x + ctx.measureText(text).width, y + 2, 15, 26);
      }
    }
    y += 40;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Open laptop (~30 cm wide): base with keyboard deck and trackpad, lid tilted
 * back with a terminal on screen. Front edge towards +z, resting on y = 0.
 */
function makeLaptop() {
  const g = new THREE.Group();
  const W = 0.9, D = 0.62, T = 0.035;
  const shell = new THREE.MeshStandardMaterial({ ...brushedMaps({ color: '#3a3c42', seed: 21 }), metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.7 });

  const base = mesh(new THREE.BoxGeometry(W, T, D), shell);
  base.position.y = T / 2;
  g.add(base);
  const deck = mesh(new THREE.BoxGeometry(W * 0.86, 0.004, D * 0.42), dark, { cast: false });
  deck.position.set(0, T + 0.002, -D * 0.14);
  g.add(deck);
  const pad = mesh(new THREE.BoxGeometry(W * 0.32, 0.002, D * 0.24), new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.35 }), { cast: false });
  pad.position.set(0, T + 0.001, D * 0.27);
  g.add(pad);

  // Lid hinged at the back edge, opened ~97°.
  const hinge = new THREE.Group();
  hinge.position.set(0, T, -D / 2);
  hinge.rotation.x = -0.12; // nearly upright
  g.add(hinge);
  const LH = D * 0.98;
  const lid = mesh(new THREE.BoxGeometry(W, LH, 0.02), shell);
  lid.position.set(0, LH / 2, -0.01);
  hinge.add(lid);
  const bezel = mesh(new THREE.BoxGeometry(W * 0.97, LH * 0.95, 0.002), dark, { cast: false });
  bezel.position.set(0, LH / 2, 0.001);
  hinge.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.9, LH * 0.84),
    new THREE.MeshBasicMaterial({ map: terminalTexture(), toneMapped: false })
  );
  screen.position.set(0, LH / 2 + 0.01, 0.0025);
  hinge.add(screen);
  return g;
}

/**
 * The user's Makita drill: a Polycam scan in metres (assets/models/makita/
 * drill.glb, textures embedded). Laid on its side, resting on y = 0, centred.
 */
function makeDrill() {
  const g = new THREE.Group();
  new GLTFLoader().load("assets/models/makita/drill.glb", ({ scene }) => {
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    scene.scale.setScalar(3); // metres -> screen units (1 unit ≈ 33 cm)
    scene.rotation.x = Math.PI / 2; // on its side: the scan's thin axis (z) becomes vertical
    const holder = new THREE.Group();
    holder.add(scene);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder, true);
    const c = box.getCenter(new THREE.Vector3());
    scene.position.set(-c.x, -box.min.y, -c.z);
    g.add(holder);
  });
  return g;
}

/** Rests a loaded model on y = 0, centred on x/z, inside a fresh holder group. */
function seat(object) {
  const holder = new THREE.Group();
  holder.add(object);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x;
  object.position.z -= c.z;
  object.position.y -= box.min.y;
  return holder;
}

/**
 * The user's scanned climbing holds (assets/models/holds/), textures reduced
 * to 1024 px JPEG for the web. Both lie with their bolted (flat) face down.
 */
function makeJug() {
  const g = new THREE.Group();
  // Simplified from the original scan (~13k vertices). Its two UV tiles
  // (u 0–1 and 1–2) share one side-by-side atlas, hence repeat.x = 0.5.
  const atlas = loadTexture("assets/models/holds/jug.jpg");
  atlas.repeat.set(0.5, 1);
  new GLTFLoader().load("assets/models/holds/jug.glb", ({ scene }) => {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.85 });
      o.castShadow = true;
    });
    scene.scale.setScalar(0.003); // millimetres -> screen units
    scene.rotation.x = -Math.PI / 2; // scan's z (out of the wall) becomes up
    g.add(seat(scene));
  });
  return g;
}

/**
 * Direction a scan's open side faces. Scans of objects lying on a table have
 * no bottom: the rim of that opening is made of edges used by a single
 * triangle. Welds all meshes by position (they're split by material), finds
 * those rim edges, fits a plane through them, and returns its normal pointing
 * away from the body of the model.
 */
function openSideNormal(object) {
  object.updateMatrixWorld(true);
  const points = []; // welded positions
  const ids = new Map();
  const tris = [];
  const v = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(object, true);
  const eps = box.getSize(new THREE.Vector3()).length() * 1e-5;
  const weld = (p) => {
    const key = `${Math.round(p.x / eps)},${Math.round(p.y / eps)},${Math.round(p.z / eps)}`;
    let id = ids.get(key);
    if (id === undefined) { id = points.length; ids.set(key, id); points.push(p.clone()); }
    return id;
  };
  object.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) t.push(weld(v.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(o.matrixWorld)));
      tris.push(t);
    }
  });

  const edges = new Map();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const rim = new Set();
  for (const [key, n] of edges) if (n === 1) for (const id of key.split("_")) rim.add(+id);
  const rimPoints = [...rim].map((id) => points[id]);

  // Plane through the rim: the two main axes by power iteration; normal = their cross.
  const mean = rimPoints.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(rimPoints.length);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of rimPoints) {
    const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += d[r] * d[c];
  }
  const mul = (x) => new THREE.Vector3(
    cov[0] * x.x + cov[1] * x.y + cov[2] * x.z,
    cov[3] * x.x + cov[4] * x.y + cov[5] * x.z,
    cov[6] * x.x + cov[7] * x.y + cov[8] * x.z
  );
  const power = (x, against) => {
    for (let k = 0; k < 50; k++) { x = mul(x); if (against) x.addScaledVector(against, -x.dot(against)); x.normalize(); }
    return x;
  };
  const u = power(new THREE.Vector3(1, 0.2, 0.3));
  const w = power(new THREE.Vector3(0.3, 1, 0.2), u);
  const normal = new THREE.Vector3().crossVectors(u, w).normalize();

  // Point it away from the body: the body's centre is on the other side.
  const centre = points.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(points.length);
  if (normal.dot(centre.sub(mean)) > 0) normal.negate();
  return normal;
}

function makePinch() {
  const g = new THREE.Group();
  new GLTFLoader().load("assets/models/holds/pinch.glb", ({ scene }) => {
    scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // The scan has no real units: scale its longest side to ~15 cm.
    scene.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3());
    scene.scale.setScalar(0.45 / Math.max(size.x, size.y, size.z));
    // The scan has no back (it was scanned sitting on a table), so turn the
    // open side — where the hold bolts to the wall — down onto the shelf.
    scene.quaternion.premultiply(
      new THREE.Quaternion().setFromUnitVectors(openSideNormal(scene), new THREE.Vector3(0, -1, 0))
    );
    g.add(seat(scene));
  });
  return g;
}

/**
 * Loads one of the user's small props (assets/models/props/, reduced for the
 * web) into a group resting on y = 0, centred. Either `scale` (model units ->
 * screen units) or `longest` (screen units for its longest side) sizes it;
 * `rotation` (Euler, applied first) lays it the right way down.
 */
function loadProp(url, { scale, longest, rotation = [0, 0, 0] } = {}) {
  const g = new THREE.Group();
  const onLoad = (scene) => {
    scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.rotation.set(...rotation);
    if (longest) {
      scene.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3());
      scene.scale.setScalar(longest / Math.max(size.x, size.y, size.z));
    } else if (scale) {
      scene.scale.setScalar(scale);
    }
    g.add(seat(scene));
  };
  if (url.endsWith(".fbx")) new FBXLoader().load(url, onLoad);
  else new GLTFLoader().load(url, (gltf) => onLoad(gltf.scene));
  return g;
}

/** Black webbing hang loop on top of the bag (screen units; the scan's own was too ragged). */
const HANG_LOOP = { drop: 0.12, top: 0.03, half: 0.048, sink: 0.12, thick: 0.006, wide: 0.045 };

/**
 * The hang loop, in the bag holder's space: its top is the origin (the hook's
 * catch point) and its feet go into the bag's top, `bagZ` out from there.
 */
function makeHangLoop(bagZ) {
  const { drop, top, half, sink, thick, wide } = HANG_LOOP;
  const pts = [new THREE.Vector3(-half, -drop - sink, 0), new THREE.Vector3(-half * 0.75, -drop * 0.55, 0)];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    pts.push(new THREE.Vector3(Math.cos(a) * top, -top + Math.sin(a) * top, 0));
  }
  pts.push(new THREE.Vector3(half * 0.75, -drop * 0.55, 0), new THREE.Vector3(half, -drop - sink, 0),
    new THREE.Vector3(0, -drop - sink * 1.5, 0)); // closes inside the bag
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, thick, 8, true);
  geo.scale(1, 1, wide / thick); // flat strap: wide across the hook, thin along it
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { // lean the feet out to the bag if it sits off the wall
    pos.setZ(i, pos.getZ(i) + bagZ * THREE.MathUtils.clamp(-pos.getY(i) / drop, 0, 1));
  }
  geo.computeVertexNormals();
  const loop = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.85 }));
  loop.castShadow = true;
  return loop;
}

/**
 * The user's climbing bag (a RealityCapture scan in metres, simplified to
 * ~80k triangles with meshoptimizer, ragged top cut off), set up to hang
 * from a black webbing loop: the group's origin is the top of the loop, so
 * placing the group at a hook's catch point hangs it there. `wallZ` (in the
 * parent's space, given with the catch point) keeps the bag from going into
 * the wall.
 */
function makeHangingBag(catchPoint, wallZ) {
  const g = new THREE.Group();
  g.position.copy(catchPoint);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load("assets/models/props/climbing-bag.glb", ({ scene }) => {
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    scene.scale.setScalar(3); // metres -> screen units
    scene.rotation.y = -Math.PI/2; // thin side against the wall
    const holder = new THREE.Group();
    holder.add(scene);
    holder.updateMatrixWorld(true);

    // Strap top: centroid of the highest ~2% of vertices (in holder space).
    const pts = [];
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
    });
    pts.sort((a, b) => b.y - a.y);
    const top = pts.slice(0, Math.max(10, Math.floor(pts.length * 0.02)));
    const strap = top.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(top.length);
    scene.position.sub(strap);
    scene.position.y -= HANG_LOOP.drop; // the loop goes between the hook and the bag

    // Don't let the back of the bag sink into the wall.
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder, true);
    const back = catchPoint.z + box.min.z;
    const push = Math.max(0, wallZ + 0.01 - back);
    scene.position.z += push;
    holder.add(makeHangLoop(push));
    g.add(holder);
  });
  return g;
}

// ---------- Gravity hammer ----------

// Credits: "Halo weapons" by That one larry, CC BY 4.0
// (https://sketchfab.com/3d-models/halo-weapons-2be4400560854b66bc4f99efa586b68e).
// All model credits: CREDITS.md.
// The file holds an energy sword too; only the hammer is kept.
const HAMMER_URL = 'assets/models/halo/scene.gltf';
const HAMMER_HEIGHT = 3.6; // screen units (≈ 1.2 m)

/** Loads the hammer standing upright: handle along +y, bottom at y = 0, centred on x/z. */
function makeHammer() {
  const g = new THREE.Group();
  new GLTFLoader().load(HAMMER_URL, ({ scene }) => {
    scene.getObjectByName('energy_sword_ARM_3')?.removeFromParent();
    scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });

    // Stand the longest axis up, then normalise size and position.
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const size = box.getSize(new THREE.Vector3());
    if (size.x > size.y && size.x > size.z) scene.rotation.z = Math.PI / 2;
    else if (size.z > size.y) scene.rotation.x = Math.PI / 2;

    const holder = new THREE.Group();
    holder.add(scene);
    holder.updateMatrixWorld(true);
    box.setFromObject(holder, true);
    holder.scale.setScalar(HAMMER_HEIGHT / box.getSize(size).y);
    holder.updateMatrixWorld(true);
    box.setFromObject(holder, true);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -box.min.y, -c.z);
    g.add(holder);
  });
  return g;
}

// ---------- Assembly ----------

/**
 * Builds the room into `rig`. Returns `layout(aspect)` which re-fits the parts
 * that depend on the main screen's aspect and returns the setup's total width.
 */
export function buildWorld(rig) {
  const main = makeMonitor(1);
  rig.add(main);

  const sides = [-1, 1].map((dir) => {
    const pivot = new THREE.Group(); // hinged on the edge nearest the main screen
    pivot.rotation.y = -dir * SIDE_ANGLE;
    const monitor = makeMonitor(SIDE_W);
    monitor.position.set(dir * (SIDE_W / 2 + BEZEL), 0, 0);
    pivot.add(monitor);
    rig.add(pivot);

    const glow = new THREE.PointLight(dir < 0 ? 0x8fa8ff : 0xffd29a, 0.5, 0, 2);
    glow.position.set(dir * (SIDE_W / 2), -0.3, 0.4);
    monitor.add(glow);

    return { dir, pivot, monitor };
  });

  const desk = makeDesk();
  rig.add(desk);

  // XL desk mat (~90 × 40 cm) under the keyboard and mouse.
  const deskMat = makeDeskMat(2.7, 1.2);
  deskMat.position.set(0.5, DESK_TOP, 1.02);
  rig.add(deskMat);

  const keyboard = makeKeyboard();
  keyboard.position.set(0, DESK_TOP + MAT_THICKNESS, 1.0);
  rig.add(keyboard);

  const mouse = makeMouse();
  mouse.position.set(1.2, DESK_TOP + MAT_THICKNESS, 1.03);
  rig.add(mouse);

  // Hoverable props: an outer group placed in the room, and an inner one that
  // main.js lifts along the prop's own up axis on hover.
  // `liftAxis` is in the outer group's space: up for things on a surface,
  // out from the wall for the poster.
  const hoverable = (name, inner, lift, { parent = rig, liftAxis = new THREE.Vector3(0, 1, 0) } = {}) => {
    const outer = new THREE.Group();
    outer.add(inner);
    parent.add(outer);
    return { name, outer, inner, lift, liftAxis };
  };

  const car = hoverable("car", makeCar(), 0.08);
  car.outer.rotation.y = -0.8; // nose towards the viewer, angled right

  // Hammer on the floor, leaning back against the wall left of the window.
  // Poster on the strip of wall left of the window, above the hammer.
  const poster = hoverable("poster", makePoster(1.15), 0.12, { liftAxis: new THREE.Vector3(0, 0, 1) });
  poster.outer.position.set(WINDOW.left - 0.7, 1.15, WALL_Z);

  // Game case on the lower desk, half tucked under the monitor shelf.
  const dvd = hoverable("dvd", makeDvdCase(), 0.06);
  dvd.outer.position.set(-1.12, DESK_TOP, 0.42);
  dvd.outer.rotation.y = 0.18;

  // Finger trainer on the shelf, just left of the right monitor's foot.
  const trainer = hoverable("trainer", makeFingerTrainer(), 0.06, { parent: sides[1].monitor });
  trainer.outer.position.set(-0.45, SHELF_TOP, 0.14); // right-monitor space
  trainer.outer.rotation.y = 0.35;

  // Iron hook on the wall under the window, to the right of the desk.
  // Tall bookcase to the left of the poster, with the user's books on the
  // lowest shelf that can be seen from the room view.
  const bookcase = makeBookcase();
  bookcase.group.position.set(WINDOW.left - 2.35, FLOOR_Y, WALL_Z);
  rig.add(bookcase.group);
  const inner = BOOKCASE.width - BOOKCASE.side * 2;
  const books = makeBooks(inner - 0.04);
  books.position.set(-inner / 2 + 0.02, bookcase.shelves[1], BOOKCASE.depth - 0.04);
  bookcase.group.add(books);

  // Open laptop two shelves above the books, towards the right side (in view).
  const laptop = hoverable("laptop", makeLaptop(), 0.05, { parent: bookcase.group });
  // Forward enough that the opened lid clears the back panel.
  laptop.outer.position.set(inner / 2 - 0.58, bookcase.shelves[3], BOOKCASE.depth / 2 + 0.08);
  laptop.inner.scale.setScalar(0.9);

  // Props on the upper shelves, kept towards the right of the case (the side
  // the room view shows). `onShelf` places an object on a given shelf.
  const onShelf = (shelf, object, x, z, rotY = 0, y = 0) => {
    object.position.set(x, bookcase.shelves[shelf] + y, z);
    object.rotation.y = rotY;
    bookcase.group.add(object);
    return object;
  };

  // Top shelf: the two circuit boards stacked, the controllers to their right.
  onShelf(5, loadProp("assets/models/props/circuit-fax.glb", { longest: 0.52, rotation: [-Math.PI / 2, 0, 0] }), -0.42, 0.34, 0.28);
  // Resting on the fax board's tallest components (~0.077 units at this size).
  onShelf(5, loadProp("assets/models/props/circuit-surface.glb", { longest: 0.36 }), -0.38, 0.36, -0.35, 0.077);
  onShelf(5, loadProp("assets/models/props/controller-wii.glb", { longest: 0.45, rotation: [-Math.PI / 2, 0, 0] }), 0.3, 0.55, 1.15);
  onShelf(5, loadProp("assets/models/props/controller-xbox.glb", { longest: 0.42 }), -0.05, 0.62, 0.35);

  // Shelf below: the tripod standing on its feet (scaled to fit under the top
  // shelf), and the GoPro next to it.
  onShelf(4, loadProp("assets/models/props/tripod.glb", { longest: 0.82 }), 0.55, 0.4, 0.4);
  onShelf(4, loadProp("assets/models/props/gopro.glb", { longest: 0.2 }), 0.18, 0.55, -0.5);

  // Makita drill on its side, with the two climbing holds next to it, on the
  // shelf under the laptop. One hoverable group: all three lift together.
  const kit = new THREE.Group();
  const drillModel = makeDrill();
  drillModel.rotation.y = 0.45;
  const jug = makeJug();
  jug.position.set(-0.6, 0, 0.05);
  jug.rotation.y = -0.3;
  const pinch = makePinch();
  pinch.position.set(-1.0, 0, -0.02);
  pinch.rotation.y = 0.6;
  kit.add(drillModel, jug, pinch);
  const drill = hoverable("drill", kit, 0.06, { parent: bookcase.group });
  drill.outer.position.set(inner / 2 - 0.45, bookcase.shelves[2], BOOKCASE.depth / 2 + 0.05);
  laptop.outer.rotation.y = -0.12; // turned a little towards the room

  const hook = makeWallHook();
  hook.position.set(3.5, -0.95, WALL_Z);
  rig.add(hook);

  // Climbing bag hanging from the hook (strap in the hook's curl).
  const HOOK_CATCH = new THREE.Vector3(0, -0.045, 0.13); // bottom of the curl, hook space
  const bagCatch = hook.position.clone().add(HOOK_CATCH);
  const bag = hoverable("bag", makeHangingBag(new THREE.Vector3(), WALL_Z - bagCatch.z), 0.06);
  bag.outer.position.copy(bagCatch);

  const hammer = hoverable("hammer", makeHammer(), 0.18);
  const lean = 0.14; // radians from vertical
  hammer.outer.position.set(0, FLOOR_Y, WALL_Z + Math.sin(lean) * HAMMER_HEIGHT + 0.08); // x set in layout()
  hammer.outer.rotation.set(-lean, 0.5, 0, 'XYZ');

  rig.add(makeWall());
  const city = makeCity();
  rig.add(city);

  const floor = mesh(new THREE.PlaneGeometry(40, 20), mat.floor, { cast: false });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, WALL_Z + 10);
  rig.add(floor);

  // Lights
  rig.add(new THREE.HemisphereLight(0xb8c4e0, 0x2a2018, 0.7));

  const key = new THREE.DirectionalLight(0xffe2c4, 1.5);
  key.position.set(-2, 3, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  rig.add(key, key.target);

  const daylight = new THREE.DirectionalLight(0xd6e4ff, 0.7); // through the window
  daylight.position.set(0.6, 3, -4);
  daylight.target.position.set(0, DESK_TOP, 0.5);
  rig.add(daylight, daylight.target);

  const glow = new THREE.PointLight(0xf6f5f1, 1.2, 0, 2); // main screen spill
  glow.position.set(0, -0.2, 0.35);
  rig.add(glow);

  function layout(aspect) {
    main.userData.bezel.scale.x = aspect + BEZEL * 2;

    for (const { dir, pivot } of sides) pivot.position.set(dir * (aspect / 2 + BEZEL + GAP), 0, -0.02);

    const sideSpan = GAP + (SIDE_W + BEZEL * 2) * Math.cos(SIDE_ANGLE);
    const totalWidth = aspect + BEZEL * 2 + sideSpan * 2;

    const deskWidth = totalWidth + 0.5;
    const { top, shelf, panels, legs } = desk.userData;
    top.scale.x = deskWidth;
    shelf.scale.x = totalWidth + 0.2;
    // Keep the wood grain at a constant scale (~2.4 × 1.2 units per tile).
    setRepeat(mat.desk, deskWidth / 2.4, 2.3 / 1.2);
    setRepeat(mat.shelf, (totalWidth + 0.2) / 2.4, 1.1 / 1.2);
    for (const p of panels) p.position.x = p.userData.side * ((totalWidth + 0.2) / 2 - 0.025);
    for (const leg of legs) leg.position.x = leg.userData.side * (deskWidth / 2 - 0.12);

    // Car sits on the lower desk, in front of the left monitor.
    car.outer.position.set(-(aspect / 2 + 0.95), DESK_TOP, 1.0);

    // Hammer stands in the gap between the desk's left end and the bookcase:
    // just past the desk (which widens with the viewport), never into the case.
    const HAMMER_HALF = 0.45; // rough half-width of the head as seen from the room
    const bookcaseRight = bookcase.group.position.x + BOOKCASE.width / 2;
    hammer.outer.position.x = Math.max(-deskWidth / 2 - HAMMER_HALF - 0.08, bookcaseRight + HAMMER_HALF);

    return totalWidth;
  }

  return {
    layout,
    // How far the room reaches on each side (x and depth z), for the portrait
    // phone view to turn towards: the bookcase's left side and the bag.
    edges: {
      left: { x: bookcase.group.position.x - BOOKCASE.width / 2 + 0.3, z: WALL_Z + BOOKCASE.depth },
      right: { x: hook.position.x + 0.45, z: WALL_Z + 0.3 },
    },
    tick: (t, dt) => city.userData.update(t, dt),
    key,
    glow,
    // Groups positioned at each screen centre, facing +z. Screens attach here.
    hoverables: [car, hammer, poster, dvd, trainer, laptop, drill, bag],
    anchors: { main, left: sides[0].monitor, right: sides[1].monitor },
  };
}
