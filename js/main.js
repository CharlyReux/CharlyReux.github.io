import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { buildWorld, SIDE_W } from './world.js';
import { CITY_FOG } from './city.js';
import { initPapers } from './papers.js';

/*
 * Each monitor screen is a real DOM page rendered with CSS3DRenderer on top of
 * the WebGL room. At rest the camera sits exactly where the main screen fills
 * the viewport 1:1, so it looks like a normal page.
 *
 * Views:  main ──"More about me"──▶ room ──click a screen──▶ main | left | right
 *         room ◀── Esc / Back / click outside ── left | right;  room ──Esc──▶ main
 *
 * Units: everything lives in `rig`, built in "screen units" (screen height = 1)
 * and scaled by the viewport height in px, so CSS elements end up at scale 1
 * in world space (crisp text) while geometry stays easy to reason about.
 */

const FOV = 40;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const FIT_DIST = 0.5 / TAN; // distance at which a 1-unit-tall screen fills the view
const DURATION = 1.6; // seconds per camera move
const SIDE_MARGIN = 1.06; // a sliver of bezel stays visible when zoomed on a side screen

// ---------- Renderers ----------

// Log depth: the scene spans a 1-unit screen up close to a city ~2000 units away.
const gl = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // capped: full 2x/3x costs a lot of GPU
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.PCFSoftShadowMap;
gl.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('world').appendChild(gl.domElement);

// Transparent renderer that draws only the hovered prop, sharp, above the
// blurred main canvas (see "Hover focus" below).
const focusGl = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
focusGl.setPixelRatio(gl.getPixelRatio());
focusGl.outputColorSpace = THREE.SRGBColorSpace;
focusGl.setClearColor(0x000000, 0);
focusGl.domElement.id = 'focus';
document.getElementById('world').after(focusGl.domElement);

const css = new CSS3DRenderer();
css.domElement.classList.add('css3d');
document.body.appendChild(css.domElement);

// ---------- Scene ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(CITY_FOG.color);
// Exponential fog: negligible inside the room, swallows the city with distance.
scene.fog = new THREE.FogExp2(CITY_FOG.color, 0);

const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10);
const rig = new THREE.Group();
scene.add(rig);

const world = buildWorld(rig);

// Mount each page on its monitor. The CSS layer is drawn above all WebGL, so
// screens must never sit behind WebGL geometry from the camera's viewpoint.
const screens = {};
for (const el of document.querySelectorAll('[data-screen]')) {
  const name = el.dataset.screen;
  const object = new CSS3DObject(el);
  object.position.z = name === 'main' ? 0 : 0.001;
  world.anchors[name].add(object);

  // Glass in front of the page: a faint glare and darker edges. Its own CSS3D
  // object (not inside the scrolling page), and it ignores the pointer.
  const glassEl = document.createElement("div");
  glassEl.className = "glass";
  const glass = new CSS3DObject(glassEl);
  glassEl.style.pointerEvents = "none";
  glass.position.z = object.position.z + 0.0005;
  world.anchors[name].add(glass);

  screens[name] = { el, object, glassEl, glass, anchor: world.anchors[name] };
}

// ---------- Layout ----------

const poses = {
  main: { pos: new THREE.Vector3(0, 0, FIT_DIST), target: new THREE.Vector3() },
  room: { pos: new THREE.Vector3(), target: new THREE.Vector3(0, 0.05, 0) },
  left: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
  right: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
};

const _q = new THREE.Quaternion();
const _normal = new THREE.Vector3();

/** Pose looking straight at a side screen, fitted to the viewport. */
function sidePose(name, aspect) {
  const { anchor } = screens[name];
  const pose = poses[name];
  const h = rig.scale.x;
  anchor.getWorldPosition(pose.target).divideScalar(h);
  anchor.getWorldQuaternion(_q);
  _normal.set(0, 0, 1).applyQuaternion(_q);
  const dist = Math.max(FIT_DIST, SIDE_W / 2 / (TAN * aspect)) * SIDE_MARGIN;
  pose.pos.copy(pose.target).addScaledVector(_normal, dist);
}

// Portrait phones: how far the view turns (aim shift at the target, per side) at full tilt.
const roomTurn = { left: 0, right: 0 };

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;

  gl.setSize(w, h);
  focusGl.setSize(w, h);
  css.setSize(w, h);
  rig.scale.setScalar(h);

  // Main page = viewport size; side pages = 16:10 at the same pixel density.
  // Each object is scaled by 1/h so that (inside the h-scaled rig) it's 1:1.
  for (const [name, { el, object, glassEl, glass }] of Object.entries(screens)) {
    const width = `${name === 'main' ? w : Math.round(SIDE_W * h)}px`;
    el.style.width = glassEl.style.width = width;
    el.style.height = glassEl.style.height = `${h}px`;
    object.scale.setScalar(1 / h);
    glass.scale.setScalar(1 / h);
  }

  const totalWidth = world.layout(aspect);
  rig.updateMatrixWorld(true);

  // Step back far enough to see all three screens (within reason on portrait).
  const needed = (totalWidth / 2 + 2) / (TAN * aspect);
  poses.room.pos.set(0.45, 0.55, THREE.MathUtils.clamp(needed, FIT_DIST * 3, FIT_DIST * 6));
  // Portrait phones can't fit the room: turning the phone left/right turns the
  // view just far enough to bring that side's edge (bookcase, bag) into view.
  const { pos: rp, target: rt } = poses.room;
  const halfFov = Math.atan(TAN * aspect);
  for (const side of ['left', 'right']) {
    const e = world.edges[side];
    const toEdge = Math.atan(Math.abs(e.x - rp.x) / (rp.z - e.z));
    const turn = aspect < 1 ? Math.max(0, toEdge - halfFov * 0.85) : 0;
    roomTurn[side] = Math.tan(turn) * (rp.z - rt.z);
  }
  sidePose('left', aspect);
  sidePose('right', aspect);

  camera.aspect = aspect;
  camera.near = 0.01 * h;
  camera.far = 10000 * h;
  scene.fog.density = CITY_FOG.density / h; // fog works in world px
  camera.updateProjectionMatrix();

  // Shadow camera bounds are in world units (not affected by rig scale). They
  // must cover the whole room (bookcase to hook), or shadows end in a hard edge.
  const s = world.key.shadow.camera;
  const half = Math.max(6.5, totalWidth * 1.4) * h;
  s.left = -half; s.right = half; s.top = half; s.bottom = -half;
  s.near = 0.1 * h; s.far = 18 * h;
  s.updateProjectionMatrix();
  world.glow.distance = 3 * h;
}
window.addEventListener('resize', layout);
layout();
initPapers(); // after layout, so preview boxes have their size

// ---------- Views & transitions ----------

let view = 'main'; // where the camera is, or is heading
let moving = false;
let progress = 1;
const from = { pos: poses.main.pos.clone(), target: poses.main.target.clone() };
const current = { pos: poses.main.pos.clone(), target: poses.main.target.clone() };
let fromView = 'main';

function updateScreenStates() {
  for (const [name, { el, glassEl }] of Object.entries(screens)) {
    const away = moving || name !== view;
    el.classList.toggle('is-away', away);
    glassEl.classList.toggle('is-away', away);
  }
}

// ---------- Addresses ----------
//
// Each view has its own address after the "#" (e.g. /#projects), so links can
// be shared, open straight on that screen, and back/forward move between views.
// Hash addresses need no server setup on GitHub Pages.

const ROUTES = { main: "", room: "room", left: "projects", right: "research" };
const TITLES = { main: "Charly Reux", room: "Charly Reux", left: "Projects · Charly Reux", right: "Research · Charly Reux" };
const viewFromHash = () => Object.keys(ROUTES).find((v) => ROUTES[v] === location.hash.slice(1)) || "main";
let pendingView = null; // a back/forward that arrived while the camera was moving

function updateAddress(next, push) {
  document.title = TITLES[next];
  const url = ROUTES[next] ? `#${ROUTES[next]}` : location.pathname + location.search;
  if (push) history.pushState({ view: next }, "", url);
  else history.replaceState({ view: next }, "", url);
}

function goTo(next, { push = true } = {}) {
  if (next === view) return;
  if (moving) { if (!push) pendingView = next; return; }
  from.pos.copy(current.pos);
  from.target.copy(current.target);
  fromView = view;
  view = next;
  moving = true;
  progress = 0;
  updateScreenStates();
  updateAddress(next, push);
}

/** Show a view immediately, without the camera move (opening a shared link). */
function jumpTo(next) {
  view = fromView = next;
  moving = false;
  progress = 1;
  updateScreenStates();
  updateAddress(next, false);
}

window.addEventListener("popstate", () => goTo(viewFromHash(), { push: false }));

for (const [name, { el }] of Object.entries(screens)) {
  el.addEventListener('click', (e) => {
    if (moving) return;
    if (view === 'room') goTo(name);
    else if (view === name && name === 'main' && e.target.closest('#more')) goTo('room');
    else if (view === name && e.target.closest('[data-back]')) goTo('room');
  });
}

// Clicking the room itself (not a screen) while zoomed on a side screen backs out.
gl.domElement.addEventListener('click', () => {
  if (view === 'left' || view === 'right') goTo('room');
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (view === 'room') goTo('main');
  else if (view !== 'main') goTo('room');
});

// ---------- Camera ----------

const mouse = new THREE.Vector2();
const parallax = new THREE.Vector2();
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return; // phones use the tilt below instead
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
});

// Phones: tilting the phone moves the view like the mouse does. The rest
// orientation slowly follows how the phone is held, so only tilts count.
// Tilts are measured from the full 3D orientation (not the raw beta/gamma
// angles, which flip and jump when the phone is held upright).
const TILT_RANGE = 18; // degrees of tilt for the full parallax
const PAN_RANGE = 10; // portrait: degrees of left/right tilt to pan all the way to a side
const TILT_FOLLOW = 0.002; // per reading (~60/s): rest orientation catches up in ~10 s
const DEG = THREE.MathUtils.DEG2RAD;
const tiltEuler = new THREE.Euler();
const tiltNow = new THREE.Quaternion();
const tiltRel = new THREE.Quaternion();
let tiltRest = null;
let parallaxGain = 1; // the phone camera sits much further back, so tilt moves it more
function onTilt(e) {
  if (e.beta === null || e.gamma === null) return;
  // Device -> earth rotation (W3C: Rz(alpha) Rx(beta) Ry(gamma)).
  tiltNow.setFromEuler(tiltEuler.set(e.beta * DEG, e.gamma * DEG, (e.alpha || 0) * DEG, 'ZXY'));
  if (!tiltRest) { tiltRest = tiltNow.clone(); parallaxGain = 4; }
  tiltRest.slerp(tiltNow, TILT_FOLLOW);
  // Rotation since rest, in the phone's own axes (x right, y up the screen, z out of it), in degrees.
  tiltRel.copy(tiltRest).invert().multiply(tiltNow);
  const k = (tiltRel.w < 0 ? -2 : 2) / DEG;
  const rx = tiltRel.x * k, ry = tiltRel.y * k, rz = tiltRel.z * k;
  // Screen axes: turning or rolling the phone right = right, top edge towards the user = up.
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  let h = ry, v = rx;
  if (angle === 90) [h, v] = [rx, -ry];
  else if (angle === -90 || angle === 270) [h, v] = [-rx, ry];
  h -= rz; // steering-wheel roll counts as left/right too
  const portrait = window.innerHeight > window.innerWidth;
  if (portrait) h = -ry - rz; // portrait looks around: turn (or roll) the phone left to look left
  const clamp = (t, range) => THREE.MathUtils.clamp(t / range, -1, 1);
  mouse.set(clamp(h, portrait ? PAN_RANGE : TILT_RANGE), clamp(v, TILT_RANGE));
}
if (window.matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window) {
  window.addEventListener('deviceorientation', onTilt);
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS only sends tilt events once asked, and only from a tap.
    const ask = () => {
      DeviceOrientationEvent.requestPermission()
        .then((state) => { if (state === 'granted') window.removeEventListener('click', ask); })
        .catch(() => {});
    };
    window.addEventListener('click', ask);
  }
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

function updateCamera(dt) {
  if (moving) {
    progress = Math.min(1, progress + dt / DURATION);
    if (progress === 1) {
      moving = false;
      updateScreenStates();
      if (pendingView && pendingView !== view) goTo(pendingView, { push: false });
      pendingView = null;
    }
  }

  const k = ease(progress);
  const to = poses[view];
  current.pos.lerpVectors(from.pos, to.pos, k);
  current.target.lerpVectors(from.target, to.target, k);
  if (!moving) {
    current.pos.copy(to.pos); // follow resizes exactly
    current.target.copy(to.target);
  }

  // Subtle mouse parallax, only in the room view (fades in/out with the move).
  const weight = (view === 'room' ? k : 0) + (fromView === 'room' && view !== 'room' ? 1 - k : 0);
  parallax.lerp(mouse, Math.min(1, dt * 4));
  camPos.copy(current.pos);
  const look = parallaxGain > 1 && roomTurn.left + roomTurn.right > 0; // portrait phone: left/right also turns the view
  const slide = parallax.x * 0.3 * (look ? 1 : parallaxGain) * weight; // portrait: gentle, like desktop
  camPos.x += slide;
  camPos.y -= parallax.y * 0.15 * parallaxGain * weight;
  const turn = parallax.x < 0 ? roomTurn.left : roomTurn.right;
  const pan = look ? slide + parallax.x * turn * weight : 0; // aim towards the side that's cut off

  // Screen units -> world px.
  const h = rig.scale.x;
  camera.position.copy(camPos).multiplyScalar(h);
  camTarget.copy(current.target);
  camTarget.x += pan;
  camera.lookAt(camTarget.multiplyScalar(h));
}

// ---------- Hover focus ----------
//
// In the room view, hovering a prop (car, hammer) lifts it, shows its label,
// and blurs everything else. The blur is a CSS filter on the main canvas and
// the CSS3D screens; the hovered prop is put on FOCUS_LAYER and re-drawn sharp
// by `focusGl` on top.

const FOCUS_LAYER = 1;
scene.traverse((o) => { if (o.isLight) o.layers.enable(FOCUS_LAYER); });

const labels = {};
for (const el of document.querySelectorAll('[data-label]')) labels[el.dataset.label] = el;

const props = world.hoverables.map((p) => ({ ...p, t: 0, box: new THREE.Box3() }));
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;
let hovered = null;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  usingTouch = false;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerActive = true;
});
document.documentElement.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') pointerActive = false;
});

// Touch: tapping a prop shows it (lift, label, blur) until the next tap
// elsewhere. That dismissing tap does nothing else, so it can't open a screen.
let usingTouch = false;
let tapped = null;
let swallowClick = false;
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  usingTouch = true;
  if (view !== 'room' || moving) { tapped = null; return; }
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerActive = true;
  const hit = pickProp(null);
  swallowClick = !!(hit || tapped);
  tapped = hit && hit !== tapped ? hit : null;
}, true);
window.addEventListener('click', (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

function setHovered(prop) {
  if (prop === hovered) return;
  if (hovered) {
    hovered.inner.traverse((o) => o.layers.disable(FOCUS_LAYER));
    labels[hovered.name]?.classList.remove('is-visible');
  }
  hovered = prop;
  if (hovered) {
    hovered.inner.traverse((o) => o.layers.enable(FOCUS_LAYER));
    labels[hovered.name]?.classList.add('is-visible');
  } else {
    focusGl.clear();
  }
  document.body.classList.toggle('is-focusing', !!hovered);
  document.body.classList.toggle('is-hovering', !!hovered);
}

/** The prop under the pointer; `sticky` stays picked anywhere within its bounds. */
function pickProp(sticky = hovered) {
  if (view !== 'room' || moving || !pointerActive) return null;
  raycaster.setFromCamera(pointer, camera);
  let best = null;
  let bestDist = Infinity;
  for (const p of props) {
    p.box.setFromObject(p.outer);
    if (p.box.isEmpty()) continue; // model still loading
    const boxHit = raycaster.ray.intersectBox(p.box, new THREE.Vector3());
    if (!boxHit) continue;
    // Keep the current prop while the pointer stays within its bounds, so the
    // lift doesn't make it flicker; otherwise require a hit on the mesh itself.
    const dist = p === sticky
      ? boxHit.distanceTo(raycaster.ray.origin)
      : raycaster.intersectObject(p.outer, true)[0]?.distance;
    if (dist !== undefined && dist < bestDist) { best = p; bestDist = dist; }
  }
  return best;
}

const _corner = new THREE.Vector3();

/** Places the hovered prop's label beside its on-screen bounds. */
function placeLabel(prop) {
  const el = labels[prop.name];
  if (!el) return;
  const { min, max } = prop.box;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
    const sx = (_corner.x + 1) / 2 * window.innerWidth;
    const sy = (1 - _corner.y) / 2 * window.innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const { offsetWidth: w, offsetHeight: h } = el;
  const gap = 16;
  let x = x1 + gap;
  if (x + w > window.innerWidth - gap) x = x0 - gap - w; // flip to the left side
  const y = THREE.MathUtils.clamp(y0 + (y1 - y0) * 0.3 - h / 2, gap, window.innerHeight - h - gap);
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

const liftEase = (t) => 1 - Math.pow(1 - t, 3);

function updateHover(dt) {
  if (usingTouch) {
    if (view !== 'room' || moving) tapped = null;
    setHovered(tapped);
  } else {
    setHovered(pickProp());
  }
  for (const p of props) {
    p.t += ((p === hovered ? 1 : 0) - p.t) * Math.min(1, dt * 8);
    p.inner.position.copy(p.liftAxis).multiplyScalar(p.lift * liftEase(p.t));
  }
  if (hovered) placeLabel(hovered);
}

function renderFocus() {
  if (!hovered) return;
  const background = scene.background;
  scene.background = null;
  camera.layers.set(FOCUS_LAYER);
  focusGl.render(scene, camera);
  camera.layers.set(0);
  scene.background = background;
}

// ---------- Loop ----------

jumpTo(viewFromHash()); // open on the view the address asks for
const clock = new THREE.Clock();
gl.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateCamera(dt);
  updateHover(dt);
  world.tick(clock.elapsedTime, dt);
  gl.render(scene, camera);
  renderFocus();
  css.render(scene, camera);
  // First frame is on screen: reveal the side screens (see style.css).
  if (!document.body.classList.contains('is-ready')) document.body.classList.add('is-ready');
});

// Debug hook: jump straight to a view from the console, e.g. __site.jump('left').
window.__site = {
  scene, // for inspecting from the console

  goTo,
  jump: jumpTo,
};
