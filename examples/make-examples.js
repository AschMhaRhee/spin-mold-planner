#!/usr/bin/env node
/*
 * Generates the generic example parts used by the "Load example parts" button.
 * They are deliberately plain so they can be shared freely (MIT, like the rest
 * of the project), but each one exercises a rule the planner cares about:
 *
 *   medallion.stl     A round medallion with a thin bail (hanging loop).
 *                     The bail is thinner and narrow, so the planner must NOT
 *                     gate through it.
 *   sword-shield.stl  A shield with a sword running through it. The blade tip
 *                     and pommel are thinner than the shield, so the gate
 *                     belongs on the shield, and the points get vents.
 *
 * Usage: node examples/make-examples.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CELL = 0.2; // mm

// Build a closed binary STL from a height function h(x, y) -> mm (0 = empty).
function heightmapSTL(w, h, fn) {
  const W = Math.ceil(w / CELL), H = Math.ceil(h / CELL);
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) z[j * W + i] = Math.max(0, fn((i + 0.5) * CELL, (j + 0.5) * CELL));
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 0 : z[j * W + i];
  const tris = [];
  const quad = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };
  // top and bottom faces, merged into runs of equal height along each row
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      const v = at(i, j); let k = i + 1;
      while (k < W && at(k, j) === v) k++;
      if (v > 0) {
        const x0 = i * CELL, x1 = k * CELL, y0 = j * CELL, y1 = (j + 1) * CELL;
        quad([x0, y0, v], [x1, y0, v], [x1, y1, v], [x0, y1, v]);   // top, normal +z
        quad([x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);   // bottom, normal -z
      }
      i = k;
    }
  }
  // vertical walls wherever neighbouring heights differ
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
    // wall on the edge between (i-1,j) and (i,j): plane x = i*CELL
    if (j < H) {
      const a = at(i - 1, j), b = at(i, j);
      if (a !== b) {
        const x = i * CELL, y0 = j * CELL, y1 = (j + 1) * CELL, lo = Math.min(a, b), hi = Math.max(a, b);
        if (a > b) quad([x, y0, lo], [x, y1, lo], [x, y1, hi], [x, y0, hi]); // faces +x
        else quad([x, y0, lo], [x, y0, hi], [x, y1, hi], [x, y1, lo]);       // faces -x
      }
    }
    // wall on the edge between (i,j-1) and (i,j): plane y = j*CELL
    if (i < W) {
      const a = at(i, j - 1), b = at(i, j);
      if (a !== b) {
        const y = j * CELL, x0 = i * CELL, x1 = (i + 1) * CELL, lo = Math.min(a, b), hi = Math.max(a, b);
        if (a > b) quad([x0, y, lo], [x0, y, hi], [x1, y, hi], [x1, y, lo]); // faces +y
        else quad([x0, y, lo], [x1, y, lo], [x1, y, hi], [x0, y, hi]);       // faces -y
      }
    }
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('Spin Mold Planner example part, units mm', 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, n) => {
    const o = 84 + n * 50;
    const [a, b, c] = t;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    [nx / l, ny / l, nz / l].forEach((v, k) => buf.writeFloatLE(v, o + k * 4));
    [a, b, c].forEach((p, k) => p.forEach((v, m) => buf.writeFloatLE(v, o + 12 + k * 12 + m * 4)));
  });
  return buf;
}

// ---- helpers for 2D shapes (y grows upward in model space) ----
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Medallion: 26 mm disc, 2.2 mm thick, recessed star and ring; 1.4 mm bail on top.
function medallion() {
  const R = 13, cx = 13, cy = 13, W = 26, H = 26 + 7;
  const star = [];
  for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 3.6 : 8; star.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return heightmapSTL(W, H, (x, y) => {
    if (inCircle(x, y, cx, cy, R)) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > 10.2 && d < 11.2) return 1.8;          // recessed ring
      if (inPoly(x, y, star)) return 1.8;           // recessed star
      return 2.2;
    }
    const by = cy + R + 3.2;                          // bail centre
    const d = Math.hypot(x - cx, y - by);
    if (d <= 3.6 && d >= 2.0) return 1.4;             // thin hanging loop
    if (inRect(x, y, cx - 1.2, cy + R - 1, cx + 1.2, by - 2)) return 1.4; // neck
    return 0;
  });
}

// Sword & shield: shield 2.25 mm, sword 1.8–2.0 mm, blade tip below the shield point.
function swordShield() {
  const W = 22, H = 52, cx = 11;
  const shield = [[1, 34], [21, 34], [21, 24], [17, 14], [cx, 8], [5, 14], [1, 24]];
  return heightmapSTL(W, H, (x, y) => {
    if (inPoly(x, y, shield)) {
      if (inRect(x, y, cx - 1, 16, cx + 1, 30) || inRect(x, y, cx - 5, 25, cx + 5, 27)) return 1.9; // recessed cross
      return 2.25;
    }
    // blade: tapers to a point at y = 0, visible below the shield
    if (y >= 0 && y < 34) { const half = Math.min(1.5, 0.15 + y * 0.12); if (Math.abs(x - cx) <= half) return 1.8; }
    if (inRect(x, y, cx - 7, 34, cx + 7, 36.5)) return 2.0;   // crossguard
    if (inRect(x, y, cx - 1.3, 36.5, cx + 1.3, 46)) return 1.9; // grip
    if (inCircle(x, y, cx, 48.5, 2.8)) return 1.9;             // pommel
    return 0;
  });
}

const out = __dirname;
fs.writeFileSync(path.join(out, 'medallion.stl'), medallion());
fs.writeFileSync(path.join(out, 'sword-shield.stl'), swordShield());
console.log('Wrote examples/medallion.stl and examples/sword-shield.stl');
