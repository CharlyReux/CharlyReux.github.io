import * as THREE from 'three';

/*
 * Flying traffic for the city canyon: small hover-cars with head/tail lights,
 * running in lanes along the main street, plus a few crossing left↔right in
 * the gap right outside the window. Positions are in rig-local screen units.
 */

/** Soft round glow used for vehicle lights. */
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One vehicle: a low wedge body with a canopy, facing +z in its own space. */
function makeVehicle(M, glow) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2 * M, 0.9 * M, 4.8 * M), hull);
  g.add(body);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(1.6 * M, 0.6 * M, 2 * M),
    new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.15, metalness: 0.8 })
  );
  canopy.position.set(0, 0.7 * M, -0.3 * M);
  g.add(canopy);

  const light = (color, x, z, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    s.position.set(x * M, 0, z * M);
    s.scale.setScalar(size * M);
    g.add(s);
  };
  for (const x of [-0.75, 0.75]) {
    light(0xfff1dc, x, 2.5, 2.6); // headlights
    light(0xff3020, x, -2.5, 1.6); // tail lights
  }
  return g;
}

/**
 * Builds the traffic. `lanes` describes the canyon: { mainHalf, zFar,
 * crossNear, crossFar, xSpan } in screen units. Returns { group, update }.
 */
export function makeTraffic(M, rand, lanes) {
  const group = new THREE.Group();
  const glow = glowTexture();
  const cars = [];
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const crossLane = () => lanes.crossFar + (0.3 + rand() * 0.5) * (lanes.crossNear - lanes.crossFar);

  // Every car follows a route whose two ends are out of sight (lost in the fog
  // far down the main street, or far along the cross street behind the corner
  // towers), so looping back to the start is never visible.
  const route = (segments) => {
    const path = new THREE.CurvePath();
    for (const s of segments) path.add(s);
    return path;
  };

  // Main street ⇄ cross street: run the canyon, then bank into the cross
  // street right outside the window (or come out of it, for outbound cars).
  for (let i = 0; i < 22; i++) {
    const towardViewer = rand() < 0.5;
    const lane = (towardViewer ? 1 : -1) * (3 + rand() * (lanes.mainHalf / M - 5)) * M;
    const y = (-140 + rand() * 210) * M;
    const z = crossLane();
    const r = (12 + rand() * 8) * M; // turn radius
    const side = rand() < 0.5 ? 1 : -1; // turn left or right

    const far = v(lane, y, lanes.zFar);
    const turnIn = v(lane, y, z - r);
    const corner = v(lane, y, z);
    const turnOut = v(lane + side * r, y, z);
    const away = v(side * lanes.xSpan, y, z);

    const path = towardViewer
      ? route([
        new THREE.LineCurve3(far, turnIn),
        new THREE.QuadraticBezierCurve3(turnIn, corner, turnOut),
        new THREE.LineCurve3(turnOut, away),
      ])
      : route([
        new THREE.LineCurve3(away, turnOut),
        new THREE.QuadraticBezierCurve3(turnOut, corner, turnIn),
        new THREE.LineCurve3(turnIn, far),
      ]);
    cars.push({ path, speed: (25 + rand() * 45) * M });
  }

  // Straight across, in the gap before the corner towers.
  for (let i = 0; i < 4; i++) {
    const z = crossLane();
    const y = (-70 + rand() * 90) * M;
    const [a, b] = rand() < 0.5 ? [-1, 1] : [1, -1];
    const path = route([new THREE.LineCurve3(v(a * lanes.xSpan, y, z), v(b * lanes.xSpan, y, z))]);
    cars.push({ path, speed: (18 + rand() * 20) * M });
  }

  for (const car of cars) {
    car.mesh = makeVehicle(M, glow);
    car.length = car.path.getLength();
    car.u = rand();
    car.phase = rand() * Math.PI * 2;
    group.add(car.mesh);
  }

  const tangent = new THREE.Vector3();

  function update(t, dt) {
    for (const car of cars) {
      car.u = (car.u + (car.speed * dt) / car.length) % 1;
      car.path.getPointAt(car.u, car.mesh.position);
      car.mesh.position.y += Math.sin(t * 0.6 + car.phase) * 0.8 * M; // gentle bob
      car.path.getTangentAt(car.u, tangent);
      car.mesh.rotation.y = Math.atan2(tangent.x, tangent.z); // vehicles face +z
    }
  }

  return { group, update };
}
