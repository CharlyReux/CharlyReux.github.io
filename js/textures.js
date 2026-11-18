import * as THREE from 'three';

/*
 * Procedural surface textures for the room, drawn on canvases at startup:
 * worn wood, matte plastic with dust and scuffs, brushed metal, and fine
 * grain for keycaps. Each returns maps ready for MeshStandardMaterial.
 */

function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Smooth 2D value noise, tileable over `period` cells. */
function valueNoise(rand, period) {
  const grid = Array.from({ length: period * period }, rand);
  const at = (x, y) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = fade(x - xi), ty = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, { color = false, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Per-pixel fill: fn(x, y) -> [r, g, b] (0–255) or a grey number. */
function fill(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const v = fn(x, y);
      const [r, g, b] = typeof v === 'number' ? [v, v, v] : v;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const hex = (c) => new THREE.Color(c);
const mixRGB = (a, b, t) => [
  (a.r + (b.r - a.r) * t) * 255,
  (a.g + (b.g - a.g) * t) * 255,
  (a.b + (b.b - a.b) * t) * 255,
];

/**
 * Oiled wood with long grain along u, the odd knot, fine pores, scratches and
 * a smoother, glossier worn zone towards the front edge (v = 1).
 */
export function woodMaps({ dark = '#3d2c20', light = '#7a5d45', seed = 1 } = {}) {
  const rand = seeded(seed);
  const W = 1024, H = 512;
  const n1 = valueNoise(rand, 16), n2 = valueNoise(rand, 64);
  const knots = Array.from({ length: 3 }, () => [rand() * W, rand() * H, 20 + rand() * 30]);
  const cd = hex(dark), cl = hex(light);

  const grainAt = (x, y) => {
    let warp = n1(x / 64, y / 64) * 30 + n2(x / 16, y / 16) * 4;
    for (const [kx, ky, kr] of knots) {
      const dx = (x - kx) / (kr * 3), dy = (y - ky) / kr;
      warp += 40 * Math.exp(-(dx * dx + dy * dy)); // grain bends around knots
    }
    const rings = Math.sin((y + warp) * 0.28) * 0.5 + 0.5;
    return Math.pow(rings, 2.5);
  };

  const [cc, cctx] = canvas(W, H);
  const [rc, rctx] = canvas(W, H);
  const [bc, bctx] = canvas(W, H);
  const grain = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grain[y * W + x] = grainAt(x, y);

  fill(cctx, W, H, (x, y) => {
    const g = grain[y * W + x];
    const pores = n2(x / 3, y / 1.2) * 0.12;
    const tone = n1(x / 200, y / 90) * 0.25; // broad colour variation
    return mixRGB(cd, cl, Math.min(1, Math.max(0, 0.25 + tone + (1 - g) * 0.55 - pores)));
  });
  fill(rctx, W, H, (x, y) => {
    const wear = Math.pow(y / H, 3) * 0.25; // front edge worn smooth by hands
    return (0.68 - wear + grain[y * W + x] * 0.12 + n2(x / 5, y / 5) * 0.08) * 255;
  });
  fill(bctx, W, H, (x, y) => (0.5 + (1 - grain[y * W + x]) * 0.35 - n2(x / 3, y / 1.2) * 0.15) * 255);

  // Scratches and dings: light on colour, rough on roughness, dips in bump.
  for (let i = 0; i < 140; i++) {
    const x = rand() * W, y = rand() * H, len = 10 + rand() * 90, a = (rand() - 0.5) * 0.8;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    for (const [ctx, style] of [[cctx, 'rgba(190,160,130,0.18)'], [rctx, 'rgba(255,255,255,0.25)'], [bctx, 'rgba(0,0,0,0.35)']]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = 0.6 + rand() * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  // Faint rings from mugs.
  for (let i = 0; i < 2; i++) {
    const x = 200 + rand() * 600, y = 300 + rand() * 150, r = 26 + rand() * 6;
    cctx.strokeStyle = 'rgba(40,25,15,0.22)';
    cctx.lineWidth = 2.5;
    cctx.beginPath(); cctx.arc(x, y, r, 0, Math.PI * 2); cctx.stroke();
  }

  return { map: texture(cc, { color: true }), roughnessMap: texture(rc), bumpMap: texture(bc) };
}

/**
 * Matte plastic: baked colour with fine grain, dust specks and light scuffs.
 * Use with material colour white.
 */
export function plasticMaps({ color = '#1b1b20', seed = 2, size = 512, dust = 260 } = {}) {
  const rand = seeded(seed);
  const n = valueNoise(rand, 128);
  const base = hex(color);
  const [cc, cctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const [bc, bctx] = canvas(size, size);

  fill(cctx, size, size, (x, y) => {
    const v = 1 + (n(x / 2, y / 2) - 0.5) * 0.18;
    return [base.r * 255 * v, base.g * 255 * v, base.b * 255 * v];
  });
  fill(rctx, size, size, (x, y) => (0.62 + (n(x / 6, y / 6) - 0.5) * 0.2) * 255);
  fill(bctx, size, size, () => 110 + rand() * 40); // stipple texture

  for (let i = 0; i < dust; i++) {
    const x = rand() * size, y = rand() * size, r = 0.4 + rand() * 1.4;
    cctx.fillStyle = `rgba(200,200,205,${0.1 + rand() * 0.25})`;
    cctx.beginPath(); cctx.arc(x, y, r, 0, Math.PI * 2); cctx.fill();
    rctx.fillStyle = 'rgba(255,255,255,0.4)';
    rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.fill();
  }
  // Scuffs: shinier (smoother) streaks where things rubbed.
  for (let i = 0; i < 25; i++) {
    const x = rand() * size, y = rand() * size, len = 8 + rand() * 40, a = rand() * Math.PI;
    rctx.strokeStyle = 'rgba(0,0,0,0.25)';
    rctx.lineWidth = 1 + rand() * 2;
    rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); rctx.stroke();
  }
  return { map: texture(cc, { color: true }), roughnessMap: texture(rc), bumpMap: texture(bc) };
}

/** Brushed metal: fine streaks along u, a few fingerprints. Use with colour white. */
export function brushedMaps({ color = '#2c2c33', seed = 3 } = {}) {
  const rand = seeded(seed);
  const W = 512, H = 512;
  const streaks = Array.from({ length: H }, () => rand());
  const n = valueNoise(rand, 64);
  const base = hex(color);
  const [cc, cctx] = canvas(W, H);
  const [rc, rctx] = canvas(W, H);

  fill(cctx, W, H, (x, y) => {
    const v = 0.9 + streaks[y] * 0.2 + (n(x / 40, y / 2) - 0.5) * 0.1;
    return [base.r * 255 * v, base.g * 255 * v, base.b * 255 * v];
  });
  fill(rctx, W, H, (x, y) => (0.38 + streaks[y] * 0.15) * 255);
  for (let i = 0; i < 6; i++) {
    const x = rand() * W, y = rand() * H;
    const g = rctx.createRadialGradient(x, y, 0, x, y, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.fillStyle = g;
    rctx.fillRect(x - 30, y - 30, 60, 60);
  }
  return { map: texture(cc, { color: true }), roughnessMap: texture(rc) };
}

/** Fine PBT-like grain for keycaps (bump + roughness). */
export function keycapMaps({ seed = 4 } = {}) {
  const rand = seeded(seed);
  const S = 128;
  const [bc, bctx] = canvas(S, S);
  const [rc, rctx] = canvas(S, S);
  fill(bctx, S, S, () => 100 + rand() * 60);
  fill(rctx, S, S, () => (0.7 + rand() * 0.15) * 255);
  return { bumpMap: texture(bc), roughnessMap: texture(rc) };
}

/**
 * Key legends for a keyboard, drawn on a transparent canvas laid over the
 * keys. `keys` is a list of { x, z, w, label } in keyboard units within a
 * board of size W × D.
 */
export function legendTexture(keys, W, D) {
  const px = 1024 / W;
  const [c, ctx] = canvas(1024, Math.round(D * px));
  ctx.fillStyle = '#d8d8de';
  ctx.textBaseline = 'top';
  for (const k of keys) {
    if (!k.label) continue;
    const single = k.label.length === 1;
    ctx.font = `${single ? 600 : 500} ${Math.round(px * (single ? 0.022 : 0.013))}px system-ui, sans-serif`;
    const left = (k.x - k.w / 2 + W / 2) * px;
    const top = (k.z - 0.035 + D / 2) * px;
    ctx.fillText(k.label, left + px * 0.012, top + px * 0.01);
  }
  const tex = texture(c, { color: true, repeat: false });
  return tex;
}
