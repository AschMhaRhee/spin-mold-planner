/* MoldMate engine: STL analysis, auto layout, gates, vents, diagnosis rules.
   Units: millimetres. World frame: mold centre at (0,0), y down (canvas-like). */
const Engine = (() => {
  'use strict';
  const IN = 25.4;

  // ---------------- STL ----------------
  function parseSTL(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) {
        const t = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12;
          for (let k = 0; k < 9; k++) t[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        }
        return t;
      }
    }
    const txt = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    const a = []; let m;
    while ((m = re.exec(txt))) a.push(+m[1], +m[2], +m[3]);
    if (a.length < 9) throw new Error('This file does not look like an STL.');
    return new Float32Array(a);
  }

  // ---------------- Part analysis ----------------
  // opts: {flat:'auto'|'x'|'y'|'z', scale:1, flip:false}
  function analyze(tris, name, opts = {}) {
    const scale = opts.scale || 1;
    const n = tris.length / 9;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = tris[i + k] * scale; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
    }
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    let ax = opts.flat && opts.flat !== 'auto' ? 'xyz'.indexOf(opts.flat) : ext.indexOf(Math.min(...ext));
    const C = ax, ab = [0, 1, 2].filter(k => k !== C), A = ab[0], B = ab[1];
    // in-plane (A,B), thickness C. View from +C looking down; screen y = -B.
    let vol = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const x1 = tris[o] * scale, y1 = tris[o + 1] * scale, z1 = tris[o + 2] * scale;
      const x2 = tris[o + 3] * scale, y2 = tris[o + 4] * scale, z2 = tris[o + 5] * scale;
      const x3 = tris[o + 6] * scale, y3 = tris[o + 7] * scale, z3 = tris[o + 8] * scale;
      vol += (x1 * (y2 * z3 - y3 * z2) - y1 * (x2 * z3 - x3 * z2) + z1 * (x2 * y3 - x3 * y2)) / 6;
    }
    vol = Math.abs(vol);
    const wA = ext[A], wB = ext[B], depth = ext[C];
    const res = Math.max(0.08, Math.max(wA, wB) / 280);
    const W = Math.ceil(wA / res) + 3, H = Math.ceil(wB / res) + 3;
    const top = new Float32Array(W * H).fill(-1e9), bot = new Float32Array(W * H).fill(1e9);
    const flip = !!opts.flip;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const px = [], py = [], pz = [];
      for (let k = 0; k < 3; k++) {
        const ca = tris[o + k * 3 + A] * scale - mn[A];
        const cb = tris[o + k * 3 + B] * scale - mn[B];
        let cz = tris[o + k * 3 + C] * scale - mn[C];
        if (flip) cz = depth - cz;
        px.push(ca / res + 1); py.push((wB - cb) / res + 1); pz.push(cz);
      }
      const d = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
      if (Math.abs(d) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(W - 1, Math.ceil(Math.max(...px)));
      const y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(H - 1, Math.ceil(Math.max(...py)));
      for (let yy = y0; yy <= y1; yy++) {
        const Y = yy + 0.5;
        for (let xx = x0; xx <= x1; xx++) {
          const X = xx + 0.5;
          const l0 = ((py[1] - py[2]) * (X - px[2]) + (px[2] - px[1]) * (Y - py[2])) / d;
          const l1 = ((py[2] - py[0]) * (X - px[2]) + (px[0] - px[2]) * (Y - py[2])) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const z = l0 * pz[0] + l1 * pz[1] + l2 * pz[2];
          const id = yy * W + xx;
          if (z > top[id]) top[id] = z;
          if (z < bot[id]) bot[id] = z;
        }
      }
    }
    const mask = new Uint8Array(W * H), th = new Float32Array(W * H), hTop = new Float32Array(W * H);
    let maxT = 0, area = 0, cx = 0, cy = 0, mass = 0;
    for (let i = 0; i < W * H; i++) if (top[i] > -1e8) {
      const t = Math.max(top[i] - bot[i], res * 0.25);
      mask[i] = 1; th[i] = t; hTop[i] = top[i]; area++;
      if (t > maxT) maxT = t;
      const x = (i % W) * res, y = Math.floor(i / W) * res;
      cx += x * t; cy += y * t; mass += t;
    }
    if (!area) throw new Error('Could not find any geometry in ' + name);
    cx /= mass; cy /= mass;
    // blurred maps
    const blurAll = boxBlur(th, W, H, Math.max(1, Math.round(1.2 / res)));
    const blurWide = boxBlur(th, W, H, Math.max(1, Math.round(Math.min(3, 0.08 * Math.max(wA, wB)) / res)));
    const heavyR = Math.max(1, Math.round(Math.max(1.5, 0.12 * Math.max(wA, wB)) / res));
    const blurHeavy = boxBlur(th, W, H, heavyR);
    let hx = 0, hy = 0, hb = -1;
    for (let i = 0; i < W * H; i++) if (mask[i] && blurHeavy[i] > hb) { hb = blurHeavy[i]; hx = (i % W) * res; hy = Math.floor(i / W) * res; }
    // boundary + samples
    const bnd = [], cand = [];
    const step = Math.max(1, Math.round(0.5 / res));
    let bcount = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) {
        bcount++;
        const p = [x * res, y * res];
        if (bcount % step === 0) {
          bnd.push(p);
          if (th[i] >= 0.95 * maxT && blurAll[i] >= 0.4 * maxT) cand.push({ x: p[0], y: p[1], s: blurAll[i] / maxT, w: blurWide[i] / maxT, t: th[i] });
        }
      }
    }
    const inner = [];
    const istep = Math.max(1, Math.round(1.5 / res));
    for (let y = 0; y < H; y += istep) for (let x = 0; x < W; x += istep) if (mask[y * W + x]) inner.push([x * res, y * res]);
    let cands = cand;
    if (!cands.length) { // fallback: thickest boundary points
      const all = [];
      for (const p of bnd) { const i = idx(p[0], p[1]); all.push({ x: p[0], y: p[1], s: blurAll[i] / maxT, w: blurWide[i] / maxT, t: th[i] }); }
      all.sort((a, b) => b.s - a.s); cands = all.slice(0, Math.max(10, all.length >> 3));
    }
    function idx(x, y) { const ix = Math.round(x / res), iy = Math.round(y / res); return iy * W + ix; }
    const part = {
      name, W, H, res, mask, th, hTop, maxT, depth, dims: [wA, wB, depth], vol, areaMM2: area * res * res,
      cx, cy, hx, hy, bnd, inner, cands, blurAll,
      at(x, y) { const ix = Math.floor(x / res + 0.5), iy = Math.floor(y / res + 0.5); if (ix < 0 || iy < 0 || ix >= W || iy >= H) return 0; return mask[iy * W + ix]; },
      thAt(x, y) { const ix = Math.floor(x / res + 0.5), iy = Math.floor(y / res + 0.5); if (ix < 0 || iy < 0 || ix >= W || iy >= H) return 0; return th[iy * W + ix]; },
      opts: { ...opts }
    };
    part.len = Math.max(wA, wB);
    return part;
  }

  function boxBlur(src, W, H, r) {
    // mean over (2r+1)^2 window (zeros outside), separable
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), k = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      let s = 0; const o = y * W;
      for (let x = -r; x <= r; x++) if (x >= 0 && x < W) s += src[o + x];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = s;
        const a = x - r, b = x + r + 1;
        if (a >= 0) s -= src[o + a];
        if (b < W) s += src[o + b];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) if (y >= 0 && y < H) s += tmp[y * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = s / (k * k);
        const a = y - r, b = y + r + 1;
        if (a >= 0) s -= tmp[a * W + x];
        if (b < H) s += tmp[b * W + x];
      }
    }
    return out;
  }

  // ---------------- Transforms ----------------
  // instance pose: theta (rotation of part), px,py (world position of part local origin)
  function pose(theta, ox, oy) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return { c, s, ox, oy, theta };
  }
  const toW = (P, x, y) => [P.c * x - P.s * y + P.ox, P.s * x + P.c * y + P.oy];
  const toL = (P, X, Y) => { const dx = X - P.ox, dy = Y - P.oy; return [P.c * dx + P.s * dy, -P.s * dx + P.c * dy]; };

  // ---------------- Metals ----------------
  const METALS = {
    pewter: { name: 'Pewter (lead-free Britannia)', density: 7.3, solidusF: 471, liquidusF: 563, pourF: '650–675', gateFactor: 1.0,
      note: 'Long pasty range (~90°F) — tolerates smaller gates. Pour values from a 92/7.75/0.25 Britannia alloy sheet; check yours.' },
    zinc: { name: 'Zinc spin-cast alloy', density: 6.7, solidusF: 720, liquidusF: 734, pourF: '850–950', gateFactor: 1.3,
      note: 'Short pasty range — freezes fast, so gates usually need to be larger than for pewter. Needs rubber rated for zinc temperatures.' },
    zamak: { name: 'Zamak 3 (ZnAl4)', density: 6.6, solidusF: 716, liquidusF: 734, pourF: '≈800–850 (estimate)', gateFactor: 1.35,
      note: 'Die-cast alloy; tends to freeze too quickly in spin casting — many casters prefer spin-cast zinc alloys. Very short pasty range: larger gates. Pour range is an estimate; confirm with supplier.' },
    lead: { name: 'Lead (pure)', density: 11.34, solidusF: 621, liquidusF: 621, pourF: '≈700–750 (estimate)', gateFactor: 1.25,
      note: 'No pasty range (freezes at one temperature): larger gates. Keep lead molds, pots and tools separate from lead-free pewter to avoid contaminating jewelry. Pour range is an estimate.' }
  };

  // ---------------- Gate choice ----------------
  // For an instance placed in world, choose the ingate: a thick, wide boundary point,
  // as close to the mold centre as possible, near the heavy section, with a clear path to the basin.
  function chooseEntry(part, P, avoid) {
    let best = null;
    const [hwx, hwy] = toW(P, part.hx, part.hy);
    let rMin = 1e9;
    for (const b of part.bnd) { const w = toW(P, b[0], b[1]); const r = Math.hypot(w[0], w[1]); if (r < rMin) rMin = r; }
    for (const c of part.cands) {
      const w = toW(P, c.x, c.y);
      const r = Math.hypot(w[0], w[1]);
      if (!clearRay(part, P, w, avoid)) continue;
      const dH = Math.hypot(w[0] - hwx, w[1] - hwy);
      const score = 0.6 * (r - rMin) + 1.0 * dH - 6 * c.s - 14 * c.w;
      if (!best || score < best.score) best = { x: c.x, y: c.y, wx: w[0], wy: w[1], r, score, s: c.s, t: c.t };
    }
    return best;
  }
  function clearRay(part, P, w, avoid) {
    const r = Math.hypot(w[0], w[1]);
    const ux = -w[0] / r, uy = -w[1] / r, tx = -uy, ty = ux;
    const reach = avoid ? r : Math.min(r, part.len + 2);
    for (let s = 0.45; s < reach; s += 0.35) {
      for (const off of [-1.6, -0.8, 0, 0.8, 1.6]) {
        if (s < 0.45 + Math.abs(off) * 0.9) continue;
        const X = w[0] + ux * s + tx * off, Y = w[1] + uy * s + ty * off;
        const l = toL(P, X, Y);
        if (part.at(l[0], l[1])) return false;
        if (avoid && s > 1 && avoid(X, Y)) return false;
      }
    }
    return true;
  }

  // Best orientation for a part on a radial axis pointing at angle phi=0 (+x). Returns theta.
  function bestTheta(part, band) { return bestThetaInfo(part, band).th; }
  function bestThetaInfo(part, band) {
    let best = null, WdMax = 0;
    for (let d = 0; d < 360; d += 7.5) {
      const th = d * Math.PI / 180;
      const P0 = pose(th, 0, 0);
      let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
      for (const b of part.bnd) { const w = toW(P0, b[0], b[1]); uMin = Math.min(uMin, w[0]); uMax = Math.max(uMax, w[0]); vMin = Math.min(vMin, w[1]); vMax = Math.max(vMax, w[1]); }
      // put inner edge at radius 60 on +x axis, centred
      const P = pose(th, 60 - uMin, -(vMin + vMax) / 2);
      const e = chooseEntry(part, P, null);
      if (!e) continue;
      const L = uMax - uMin, Wd = vMax - vMin;
      if (Wd > WdMax) WdMax = Wd;
      // radial angular cost: width matters more; fitting length is a must
      let score = 0.5 * (e.r - 60) + 1.0 * Wd + 0.1 * L - 4 * e.s;
      if (L > band) score += 300 + (L - band) * 20;
      if (!best || score < best.score) best = { th, score, L, Wd, gap: e.r - 60, fits: L <= band };
    }
    return best ? { ...best, WdMax, band } : { th: 0, WdMax, band, fits: false, L: part.len, Wd: part.len, gap: 0 };
  }

  // ---------------- Layout ----------------
  // params: {moldDia(in), basinR, innerR, rimMargin, spacing, spokeW, gateLen, metal}
  function layout(items, prm) {
    const R = prm.moldDia * IN / 2;
    const g = 0.5, N = Math.ceil(2 * R / g) + 2, half = N / 2;
    const occ = new Uint8Array(N * N);
    const gi = (X, Y) => { const ix = Math.floor(X / g + half), iy = Math.floor(Y / g + half); return (ix < 0 || iy < 0 || ix >= N || iy >= N) ? -1 : iy * N + ix; };
    const band = R - prm.rimMargin - prm.innerR;
    // expand quantities
    let list = [];
    items.forEach((it, k) => { for (let q = 0; q < it.qty; q++) list.push({ part: it.part, key: k, copy: q }); });
    const metal = prm.metalObj;
    list.forEach(o => { o.mass = o.part.vol / 1000 * metal.density; });
    list.sort((a, b) => b.mass - a.mass || a.key - b.key);
    const thetaCache = new Map();
    const prep = list.map(o => {
      if (!thetaCache.has(o.key)) thetaCache.set(o.key, bestThetaInfo(o.part, band));
      const info = thetaCache.get(o.key), th = info.th;
      const P0 = pose(th, 0, 0);
      let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
      const bw = o.part.bnd.map(b => toW(P0, b[0], b[1]));
      for (const w of bw) { uMin = Math.min(uMin, w[0]); uMax = Math.max(uMax, w[0]); vMin = Math.min(vMin, w[1]); vMax = Math.max(vMax, w[1]); }
      const Pt = pose(th, 60 - uMin, 0);
      const et = chooseEntry(o.part, Pt, null) || { wx: 60, wy: (vMin + vMax) / 2 };
      return { o, th, info, uMin, uMax, vE: et.wy, eU: et.wx - 60, bw, iw: o.part.inner.map(b => toW(P0, b[0], b[1])), cw: toW(P0, o.part.cx, o.part.cy) };
    });
    function attempt(slotted) {
      occ.fill(0);
      const placed = [], failed = [];
      let comX = 0, comY = 0;
      const n = prep.length, dphi = n > 24 ? 2 : 1;
      prep.forEach((q, idx) => {
        const o = q.o;
        let angles = [];
        if (slotted) {
          // pairs opposite each other: slot order 0, n/2, 1, n/2+1, ...
          const half = Math.ceil(n / 2), k = idx >> 1, slot = (idx % 2 === 0) ? k : k + half;
          const base = 270 + slot * 360 / n, win = 0.5 * 360 / n;
          for (let d = 0; d <= win; d += dphi) { angles.push(base + d); if (d) angles.push(base - d); }
        } else {
          const st = placed.length === 0 ? 270 : 0;
          for (let k = 0; k < 360; k += dphi) angles.push(st + k);
        }
        let bestC = null;
        for (const deg of angles) {
          const phi = (((deg % 360) + 360) % 360) * Math.PI / 180;
          const d = [Math.cos(phi), Math.sin(phi)], t = [-Math.sin(phi), Math.cos(phi)];
          let found = null;
          for (let rho = prm.innerR; rho + (q.uMax - q.uMin) <= R - prm.rimMargin; rho += 0.75) {
            const ox = (rho - q.uMin), oy = -q.vE;
            const tr = (w) => [(ox + w[0]) * d[0] + (oy + w[1]) * t[0], (ox + w[0]) * d[1] + (oy + w[1]) * t[1]];
            let ok = true;
            for (const w of q.bw) { const p = tr(w); const i = gi(p[0], p[1]); if (i < 0 || occ[i] || Math.hypot(p[0], p[1]) > R - prm.rimMargin) { ok = false; break; } }
            if (ok) for (const w of q.iw) { const p = tr(w); const i = gi(p[0], p[1]); if (i < 0 || occ[i]) { ok = false; break; } }
            if (!ok) continue;
            const re = rho + q.eU;
            for (let s = prm.basinR; s < re - 0.5 && ok; s += 1) for (const off of [-prm.spokeW / 2, 0, prm.spokeW / 2]) {
              const i = gi(d[0] * s + t[0] * off, d[1] * s + t[1] * off); if (i >= 0 && occ[i] === 1) { ok = false; break; }
            }
            if (ok) { found = { rho, phi, d, t, tr, re }; break; }
          }
          if (!found) continue;
          if (slotted) { bestC = { ...found, c: found.tr(q.cw) }; break; } // first = closest to slot angle
          const c = found.tr(q.cw);
          const bal = Math.hypot(comX + o.mass * c[0], comY + o.mass * c[1]);
          if (!bestC || found.rho < bestC.rho - 0.7 || (Math.abs(found.rho - bestC.rho) <= 0.7 && bal < bestC.bal)) bestC = { ...found, bal, c };
        }
        if (!bestC) { failed.push(o); return; }
        const { d, t, rho, phi } = bestC;
        const ox = (rho - q.uMin) * d[0] - q.vE * t[0], oy = (rho - q.uMin) * d[1] - q.vE * t[1];
        const inst = { part: o.part, key: o.key, copy: o.copy, mass: o.mass, P: pose(q.th + phi, ox, oy),
          why: { order: idx, n, slotted, partner: slotted && (idx ^ 1) < n ? (idx ^ 1) : -1, rho, pushed: rho > prm.innerR + 0.6, info: q.info } };
        placed.push(inst);
        comX += o.mass * bestC.c[0]; comY += o.mass * bestC.c[1];
        stampPart(inst, occ, gi, g, prm.spacing, 1);
        for (let s = prm.basinR; s < bestC.re; s += g) for (let off = -prm.spokeW / 2 - prm.spacing / 2; off <= prm.spokeW / 2 + prm.spacing / 2; off += g) {
          const i = gi(d[0] * s + t[0] * off, d[1] * s + t[1] * off); if (i >= 0 && !occ[i]) occ[i] = 2;
        }
      });
      return { placed, failed, comX, comY };
    }
    let res = attempt(true);
    if (res.failed.length) { const r2 = attempt(false); if (r2.failed.length <= res.failed.length) res = r2; }
    const { placed, failed, comX, comY } = res;
    const L = { R, prm, placed, failed, comX, comY };
    finish(L);
    return L;
  }

  function stampPart(inst, occ, gi, g, dil, val) {
    const p = inst.part, P = inst.P;
    const r = Math.ceil(dil / g);
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      if (!p.mask[y * p.W + x]) continue;
      const w = toW(P, x * p.res, y * p.res); const i = gi(w[0], w[1]); if (i >= 0) occ[i] = val;
    }
    for (const b of p.bnd) {
      const w = toW(P, b[0], b[1]);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = gi(w[0] + dx * g, w[1] + dy * g); if (i >= 0) occ[i] = val;
      }
    }
  }

  // ---------------- Gates, runners, vents for a finished layout ----------------
  function finish(L) {
    const { R, prm, placed } = L;
    const metal = prm.metalObj;
    const g = 0.5, N = Math.ceil(2 * R / g) + 2, half = N / 2;
    const gi = (X, Y) => { const ix = Math.floor(X / g + half), iy = Math.floor(Y / g + half); return (ix < 0 || iy < 0 || ix >= N || iy >= N) ? -1 : iy * N + ix; };
    // raw cavity map (instance id+1)
    const cav = new Int16Array(N * N);
    placed.forEach((inst, k) => stampPart(inst, cav, gi, g, 0.6, k + 1));
    const others = (k) => (X, Y) => { const i = gi(X, Y); return i >= 0 && cav[i] && cav[i] !== k + 1; };
    const block = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) if (cav[i]) block[i] = 1;
    // basin
    const br = prm.basinR + 1.5;
    for (let y = -br; y <= br; y += g) for (let x = -br; x <= br; x += g) if (x * x + y * y <= br * br) { const i = gi(x, y); if (i >= 0) block[i] = 1; }
    const warnings = [];
    let runnerVol = 0;
    placed.forEach((inst, k) => {
      const p = inst.part;
      inst.label = k + 1;
      let e = chooseEntry(p, inst.P, others(k));
      if (!e) { e = chooseEntry(p, inst.P, null); if (e) warnings.push(`#${k + 1} ${p.name}: the straight spoke to its gate crosses another cavity — move it or use a side gate.`); }
      if (!e) { warnings.push(`#${k + 1} ${p.name}: no clear gate path found.`); inst.gate = null; return; }
      const r = e.r, ux = e.wx / r, uy = e.wy / r;
      // local width of thick section at the entry, measured 0.8mm inside, perpendicular to spoke
      let wcount = 0;
      for (let o = -12; o <= 12; o += 0.2) {
        const X = e.wx + ux * 0.8 - uy * o, Y = e.wy + uy * 0.8 + ux * o;
        const l = toL(inst.P, X, Y); if (p.at(l[0], l[1])) wcount++;
      }
      const localW = wcount * 0.2;
      const slotW = clamp(0.35 * localW * metal.gateFactor, 1.5, Math.min(6, localW * 0.8));
      const slotD = clamp(0.7 * e.t * Math.min(1.2, metal.gateFactor), 0.6, e.t);
      const gStart = r - prm.gateLen;
      let inn = null;
      for (const b of p.bnd) { const w = toW(inst.P, b[0], b[1]), rr = Math.hypot(w[0], w[1]); if (!inn || rr < inn.r) inn = { r: rr, w, l: b }; }
      const ii = Math.round(inn.l[1] / p.res) * p.W + Math.round(inn.l[0] / p.res);
      inn.t = p.th[ii] || 0; inn.s = (p.blurAll[ii] || 0) / p.maxT; inn.d = Math.hypot(inn.w[0] - e.wx, inn.w[1] - e.wy);
      inst.gate = { wx: e.wx, wy: e.wy, r, ux, uy, slotW, slotD, localW, t: e.t, thick: e.t / p.maxT, gStart, lx: e.x, ly: e.y, inner: inn, clear: !!chooseEntry(p, inst.P, others(k)) };
      runnerVol += Math.max(0, gStart - prm.basinR) * prm.spokeW * prm.spokeW * 0.6;
      // block runner+gate area for vent routing
      for (let s = prm.basinR; s <= r; s += g) {
        const wdt = s < gStart ? prm.spokeW : prm.spokeW + (slotW - prm.spokeW) * (s - gStart) / prm.gateLen;
        for (let o = -wdt / 2 - 0.5; o <= wdt / 2 + 0.5; o += g) { const i = gi(ux * s - uy * o, uy * s + ux * o); if (i >= 0) block[i] = 1; }
      }
    });
    // vents
    placed.forEach((inst, k) => { inst.vents = inst.gate ? findVents(inst, inst.gate) : []; });
    placed.forEach((inst) => inst.vents.forEach(v => routeVent(v, R, block, gi, g, N, half)));
    L.warnings = warnings;
    L.runnerVol = runnerVol;
    L.cavityVol = placed.reduce((a, b) => a + b.part.vol, 0);
    L.cavityMass = placed.reduce((a, b) => a + b.mass, 0);
    const basinVol = Math.PI * prm.basinR * prm.basinR * 6;
    L.pourMass = (L.cavityVol + runnerVol + basinVol) / 1000 * metal.density * 1.25;
    let cx = 0, cy = 0;
    placed.forEach(i => { const c = toW(i.P, i.part.cx, i.part.cy); cx += i.mass * c[0]; cy += i.mass * c[1]; });
    L.imbalance = L.cavityMass ? Math.hypot(cx, cy) / L.cavityMass : 0; // mm offset of COM
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // vents in world coords for one placed instance
  function findVents(inst, gate) {
    const p = inst.part, P = inst.P, vents = [];
    const gW = [gate.wx, gate.wy];
    const bw = p.bnd.map(b => { const w = toW(P, b[0], b[1]); return { w, r: Math.hypot(w[0], w[1]), l: b }; });
    // 1) gate vents: either side of the ingate, 45° off the spoke
    const tx = -gate.uy, ty = gate.ux;
    for (const side of [-1, 1]) {
      let best = null;
      for (const b of bw) {
        const dx = b.w[0] - gW[0], dy = b.w[1] - gW[1];
        const along = dx * tx + dy * ty, dist = Math.hypot(dx, dy);
        if (along * side < gate.slotW / 2 + 1.2 || dist > gate.slotW / 2 + 4) continue;
        const sc = b.r + 0.3 * dist;
        if (!best || sc < best.sc) best = { ...b, sc };
      }
      if (best) {
        const dir = norm([-gate.ux + side * tx, -gate.uy + side * ty]);
        vents.push({ kind: 'gate', x: best.w[0], y: best.w[1], dir, why: 'Gate vent (45° beside the ingate)' });
      }
    }
    const near = (x, y, d) => vents.some(v => Math.hypot(v.x - x, v.y - y) < d) || Math.hypot(x - gW[0], y - gW[1]) < gate.slotW / 2 + 2;
    // 2) main vent: line from basin centre through cavity centre, wall nearest basin
    const C = toW(P, p.cx, p.cy);
    const rc = Math.hypot(C[0], C[1]);
    let last = null;
    for (let s = 0; s < rc; s += 0.2) {
      const X = C[0] - C[0] / rc * s, Y = C[1] - C[1] / rc * s; const l = toL(P, X, Y);
      if (p.at(l[0], l[1])) last = [X, Y];
    }
    if (last && !near(last[0], last[1], 3)) vents.push({ kind: 'main', x: last[0], y: last[1], dir: norm([-C[0], -C[1]]), why: 'Main vent: wall nearest the basin on the centre line (fills last)' });
    // 3) tips & pockets that point toward the centre or sideways: local radius minima
    const rad = clamp(0.1 * p.len, 1.5, 4);
    const tips = [];
    for (const b of bw) {
      let mn = 1e9, cnt = 0;
      for (const q of bw) {
        const dd = Math.hypot(q.w[0] - b.w[0], q.w[1] - b.w[1]);
        if (dd < 0.6 * rad || dd > rad) continue;
        cnt++; if (q.r < mn) mn = q.r;
      }
      if (cnt < 2) continue;
      const prom = mn - b.r;
      if (prom > 0.3 * rad) tips.push({ ...b, prom });
    }
    tips.sort((a, b) => a.r - b.r);
    const rMin = Math.min(...bw.map(b => b.r));
    let added = 0;
    for (const t of tips) {
      if (near(t.w[0], t.w[1], 3)) continue;
      // skip tips in the outer third — they fill first
      if (t.r > rMin + 0.7 * p.len) continue;
      vents.push({ kind: 'tip', x: t.w[0], y: t.w[1], dir: outward(p, P, t.w), why: 'Appendage / point facing the centre — traps air' });
      if (++added >= 6) break;
    }
    return vents;
  }
  function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
  function outward(p, P, w) {
    // direction from local material mass toward the boundary point
    let sx = 0, sy = 0;
    for (let a = 0; a < 16; a++) {
      const an = a * Math.PI / 8; const X = w[0] + Math.cos(an) * 1.2, Y = w[1] + Math.sin(an) * 1.2;
      const l = toL(P, X, Y); if (!p.at(l[0], l[1])) { sx += Math.cos(an); sy += Math.sin(an); }
    }
    return norm([sx, sy]);
  }

  // vent channel: pie wedge at wall, small jog toward basin, then route to perimeter (A*)
  function routeVent(v, R, block, gi, g, N, half) {
    const free = (X, Y) => { const i = gi(X, Y); return i >= 0 && !block[i]; };
    let S = null, J = null, start = null;
    outer: for (const dist of [3, 4, 5]) for (const rot of [0, 0.4, -0.4, 0.8, -0.8]) {
      const c = Math.cos(rot), s = Math.sin(rot), dx = v.dir[0] * c - v.dir[1] * s, dy = v.dir[0] * s + v.dir[1] * c;
      const s0 = [v.x + dx * dist, v.y + dy * dist];
      // the wedge itself must not cross another cavity/runner
      let ok = true; for (let t = 1.2; t <= dist; t += 0.4) if (!free(v.x + dx * t, v.y + dy * t)) { ok = false; break; }
      if (!ok || !free(s0[0], s0[1])) continue;
      const rs = Math.hypot(s0[0], s0[1]);
      const j0 = [s0[0] - s0[0] / rs * 1.2, s0[1] - s0[1] / rs * 1.2];
      S = s0; if (rot) v.dir = [dx, dy];
      if (free(j0[0], j0[1])) { J = j0; start = j0; } else start = s0;
      break outer;
    }
    v.path = null; v.drilled = false;
    if (!start) { v.drilled = true; v.drillWhy = 'no room to start a channel here — the gate, spoke or a neighbouring cavity is in the way'; return; }
    const sx = Math.floor(start[0] / g + half), sy = Math.floor(start[1] / g + half);
    const goalR = R - 1.0;
    const open = new MinHeap(), gScore = new Map(), came = new Map();
    const key = (x, y) => y * N + x;
    const h = (x, y) => Math.max(0, goalR - Math.hypot((x - half) * g, (y - half) * g)) / g;
    gScore.set(key(sx, sy), 0); open.push(h(sx, sy), sx, sy);
    let end = null, it = 0;
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (open.size && it++ < 25000) {
      const [, x, y] = open.pop();
      const r = Math.hypot((x - half) * g, (y - half) * g);
      if (r >= goalR) { end = [x, y]; break; }
      const gk = gScore.get(key(x, y));
      for (const [dx, dy, c] of nb) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const k = key(X, Y);
        if (block[k] && r < goalR - 0.5) continue;
        const ng = gk + c;
        if (ng < (gScore.get(k) ?? 1e18)) { gScore.set(k, ng); came.set(k, key(x, y)); open.push(ng + h(X, Y) * 1.05, X, Y); }
      }
    }
    if (!end) { v.drilled = true; v.drillWhy = 'no clear path along the parting line to the rim'; return; }
    const pts = []; let k = key(end[0], end[1]);
    while (k !== undefined) { pts.push([(k % N - half) * g + g / 2, (Math.floor(k / N) - half) * g + g / 2]); k = came.get(k); }
    pts.reverse();
    // simplify by line of sight
    const simp = [pts[0]];
    let i0 = 0;
    while (i0 < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i0 + 1; j--) if (los(pts[i0], pts[j])) break;
      simp.push(pts[j]); i0 = j;
    }
    const path = [[v.x, v.y], S];
    if (J && start === J) path.push(J);
    v.path = path.concat(simp.slice(1));
    v.pathLen = v.path.reduce((a, p, i) => i ? a + Math.hypot(p[0] - v.path[i - 1][0], p[1] - v.path[i - 1][1]) : 0, 0);
    if (v.pathLen > 0.55 * R) v.long = true;
    function los(a, b) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / (g * 0.5));
      for (let s = 1; s < n; s++) { const X = a[0] + (b[0] - a[0]) * s / n, Y = a[1] + (b[1] - a[1]) * s / n; const i = gi(X, Y); if (i < 0) return false; if (block[i] && Math.hypot(X, Y) < goalR - 0.5) return false; }
      return true;
    }
  }

  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(p, x, y) { const a = this.a; a.push([p, x, y]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
    pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  }

  // re-run gates/vents after manual edits; also overlap checks
  function refresh(L) {
    const { R, prm, placed } = L;
    const warn = [];
    placed.forEach((inst, k) => {
      inst.bad = false;
      for (const b of inst.part.bnd) {
        const w = toW(inst.P, b[0], b[1]); const r = Math.hypot(w[0], w[1]);
        if (r > R - prm.rimMargin) { inst.bad = true; warn.push(`#${k + 1} is inside the ${(prm.rimMargin / IN).toFixed(2)}" rim margin.`); break; }
        if (r < prm.innerR - 0.01) { inst.bad = true; warn.push(`#${k + 1} is closer to the centre than the inner limit.`); break; }
      }
    });
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
      const A = placed[a], B = placed[b];
      let hit = false;
      for (const q of B.part.bnd) {
        const w = toW(B.P, q[0], q[1]);
        for (let ang = 0; ang < 8 && !hit; ang++) {
          const X = w[0] + Math.cos(ang * Math.PI / 4) * prm.spacing * 0.95, Y = w[1] + Math.sin(ang * Math.PI / 4) * prm.spacing * 0.95;
          const l = toL(A.P, X, Y); if (A.part.at(l[0], l[1])) hit = true;
        }
        const l = toL(A.P, w[0], w[1]); if (A.part.at(l[0], l[1])) hit = true;
        if (hit) break;
      }
      if (hit) { A.bad = B.bad = true; warn.push(`#${a + 1} and #${b + 1} are closer than ${prm.spacing} mm.`); }
    }
    finish(L);
    L.warnings = warn.concat(L.warnings);
  }

  // ---------------- Diagnosis ----------------
  // diag: {part, theta (rad, rotation so that "toward centre" is up = -y), gate:[x,y] local or null,
  //        unfilled: Uint8Array over part grid, symptoms:Set}
  function frameFor(p, theta, D) {
    const P0 = pose(theta, 0, 0);
    let yMin = 1e9, xMin = 1e9, xMax = -1e9;
    for (const b of p.bnd) { const w = toW(P0, b[0], b[1]); yMin = Math.min(yMin, w[1]); xMin = Math.min(xMin, w[0]); xMax = Math.max(xMax, w[0]); }
    return pose(theta, -(xMin + xMax) / 2, -(yMin - D));
  }
  function diagnose(d, metal) {
    const p = d.part;
    const out = { steps: [], notes: [], vents: [], regate: null, facts: [] };
    // Frame: centre is "up" in the diagram after rotating the part by theta.
    // Model as a virtual mold: centre at distance D above the part.
    const P0 = pose(d.theta, 0, 0);
    let yMin = 1e9, yMax = -1e9, xMin = 1e9, xMax = -1e9;
    for (const b of p.bnd) { const w = toW(P0, b[0], b[1]); yMin = Math.min(yMin, w[1]); yMax = Math.max(yMax, w[1]); xMin = Math.min(xMin, w[0]); xMax = Math.max(xMax, w[0]); }
    const D = d.innerR || 45;
    // centre at (xc, yMin - D) -> translate so centre at origin
    const xc = (xMin + xMax) / 2;
    const P = pose(d.theta, -xc, -(yMin - D));
    // in this world, centre is origin, part lies at +y ("down"). Radius = distance from origin.
    const W = p.W, H = p.H;
    let un = 0, tot = 0, unMinR = 1e9, unMaxR = -1e9, unInnerPt = null, unWallPts = [];
    let rMin = 1e9, rMax = -1e9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!p.mask[i]) continue; tot++;
      const w = toW(P, x * p.res, y * p.res); const r = Math.hypot(w[0], w[1]);
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (d.unfilled && d.unfilled[i]) {
        un++;
        if (r < unMinR) { unMinR = r; unInnerPt = [x * p.res, y * p.res]; }
        if (r > unMaxR) unMaxR = r;
        const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !p.mask[i - 1] || !p.mask[i + 1] || !p.mask[i - W] || !p.mask[i + W];
        if (edge && ((x + y) % 2 === 0)) unWallPts.push({ l: [x * p.res, y * p.res], w, r });
      }
    }
    const frac = tot ? un / tot : 0;
    const L = rMax - rMin;
    out.frame = { P, D };
    const sym = d.symptoms || new Set();
    // gate analysis
    let gateInfo = null;
    if (d.gate) {
      const gx = d.gate[0], gy = d.gate[1];
      const i = Math.round(gy / p.res) * W + Math.round(gx / p.res);
      const t = p.thAt(gx, gy) || 0, s = p.blurAll[i] / p.maxT || 0;
      const gw = toW(P, gx, gy), gr = Math.hypot(gw[0], gw[1]);
      gateInfo = { t, s, rel: (gr - rMin) / (L || 1) };
      out.facts.push(`Gate enters where the part is ${t.toFixed(2)} mm thick (thickest section is ${p.maxT.toFixed(2)} mm).`);
      if (t < 0.85 * p.maxT || s < 0.38) {
        out.thinGate = true;
        out.notes.push({ lvl: 'bad', text: `The gate feeds through a thin or narrow feature (${Math.round(100 * t / p.maxT)}% of max thickness${s < 0.38 ? ', and narrow' : ''}). Thin sections freeze first and seal the heavier part off from the metal supply — this is the most likely root cause.` });
      }
      if (gateInfo.rel > 0.35) out.notes.push({ lvl: 'warn', text: 'The gate is well out from the part\'s inner end. Everything between the gate and the centre fills last and needs venting.' });
    }
    if (un === 0 && !sym.size) { out.notes.push({ lvl: 'info', text: 'Paint the unfilled area on the part (or tick a symptom) to get a diagnosis.' }); }
    // Unfilled region classification
    if (un > 0) {
      out.facts.push(`Unfilled: ${(frac * 100).toFixed(0)}% of the part area.`);
      const innerEnd = (unMinR - rMin) / (L || 1) < 0.15;
      const outerOnly = (unMinR - rMin) / (L || 1) > 0.6;
      let touchesGate = false;
      if (d.gate) for (const q of unWallPts) if (Math.hypot(q.l[0] - d.gate[0], q.l[1] - d.gate[1]) < 3) { touchesGate = true; break; }
      // interior pocket? region not touching wall
      const pocket = unWallPts.length === 0;
      if (pocket) {
        out.cause = 'Trapped air pocket in the middle of the cavity';
        out.notes.push({ lvl: 'bad', text: 'The short fill is surrounded by filled metal: metal ran around it and trapped air. Its innermost point needs a drilled cavity vent (needle through to the mold back, then a channel to the rim).' });
        out.vents.push({ kind: 'drilled', l: unInnerPt, why: 'Drilled cavity vent at the innermost point of the pocket' });
      } else if (outerOnly) {
        out.cause = 'Metal is not reaching the outer end';
        out.notes.push({ lvl: 'warn', text: 'Cavities normally fill from the outer end inward, so a short fill only at the outer end usually means the metal stopped early: too little metal, too cold (metal or mold), gate freezing, or spin speed too low. Venting is less likely to be the fix here.' });
      } else {
        out.cause = innerEnd ? 'Last-to-fill (inner) end did not fill' : 'Air trapped part-way along the cavity';
        out.notes.push({ lvl: 'bad', text: 'The cavity fills from its outer end inward, so the area toward the centre fills last. The air there needs a way out. The innermost points of the unfilled area are where the vents go.' });
      }
      if (!pocket) {
        // vent sites: wall points of unfilled region near its inner side; plus local radius minima
        unWallPts.sort((a, b) => a.r - b.r);
        const picks = [];
        const tipRad = clamp(0.1 * p.len, 1.5, 4);
        for (const q of unWallPts) {
          if (picks.length >= 4) break;
          if (picks.some(z => Math.hypot(z.l[0] - q.l[0], z.l[1] - q.l[1]) < 3.5)) continue;
          if (d.gate && Math.hypot(q.l[0] - d.gate[0], q.l[1] - d.gate[1]) < 2) continue;
          // accept the innermost, and other local minima
          let isMin = picks.length === 0;
          if (!isMin) {
            let mn = 1e9;
            for (const z of unWallPts) { const dd = Math.hypot(z.l[0] - q.l[0], z.l[1] - q.l[1]); if (dd > 0.6 * tipRad && dd < tipRad) mn = Math.min(mn, z.r); }
            isMin = mn - q.r > 0.25 * tipRad;
          }
          if (isMin) picks.push(q);
        }
        picks.forEach((q, k) => out.vents.push({ kind: k === 0 ? 'main' : 'tip', l: q.l, why: k === 0 ? 'Innermost wall point of the unfilled area' : 'Point of the unfilled area facing the centre' }));
      }
      if (touchesGate && d.gate) {
        out.notes.push({ lvl: 'warn', text: 'The unfilled area touches the gate. Add a gate vent on each side of the ingate at 45°. If it persists, the gate is freezing before the cavity fills (top-gate or enlarge it, or pour hotter).' });
        out.vents.push({ kind: 'gate', l: d.gate, gateVents: true, why: 'Gate vents, 45° either side of the ingate' });
      }
    }
    // symptom rules (Oster's fix order: venting first, then top gate, then enlarge gate; never add gates)
    const S = (k) => sym.has(k);
    if (S('porosity')) out.notes.push({ lvl: 'warn', text: 'Porosity / blowholes / shrink near the ingate: the feeder is not keeping up. Pour considerably more metal than the cavities need, and check that the gate is not freezing first (gate too small or metal too cool for this alloy\'s pasty range).' });
    if (S('coldshut')) out.notes.push({ lvl: 'warn', text: 'Cold shuts (seams where two streams met but did not fuse): usually from more than one gate into the cavity, or metal too cool. Use one gate per cavity, into the thickest section.' });
    if (S('repeat')) out.notes.push({ lvl: 'info', text: 'Same flaw in the same spot every spin: reverse the machine\'s spin direction for a few passes. If the flaw moves, the venting is at fault.' });
    if (S('warmup')) out.notes.push({ lvl: 'info', text: 'Fills only after several warm-up spins: normal for a cold mold, but if it needs many, vents are too small. Note it for the area that still fails when warm.' });
    if (S('flash')) out.notes.push({ lvl: 'info', text: 'Flash at the parting line or vents: vents cut too deep/wide, too little clamp pressure, or metal too hot. Vents should be hairline at the cavity wall and as shallow as possible.' });
    if (S('alloy')) out.notes.push({ lvl: 'info', text: 'New alloy or rubber: venting needs can change with either. Trial cast several times before copying an old venting layout.' });
    // ordered fix steps for the existing mold
    const steps = [];
    if (out.vents.length) steps.push({ t: 'Vent first', d: 'Cut the vents marked on the drawing: a small pie wedge whose tip just touches the cavity wall (hairline opening), then a shallow channel that jogs slightly toward the centre, turns sharply, and zig-zags out to the rim. Zig-zag channels clog less than straight ones. If gates or cavities are in the way, needle-drill through to the back and channel to the rim there.' });
    if (un > 0 || out.thinGate) steps.push({ t: 'Then top-gate', d: 'If it still short-fills after a few warm spins, cut a matching gate into the top half over the existing one to increase the gate cross-section.' });
    if (un > 0 || out.thinGate) steps.push({ t: 'Then enlarge the gate', d: 'Widen/deepen the ingate a little at a time and trial cast between cuts. Rubber cannot be put back, so go in small steps. Don\'t add a second gate — two streams meeting cause cold shuts.' });
    if (out.thinGate) {
      steps.push({ t: 'Last resort: re-gate into the thickest section', d: 'If the above does not fix it, a new gate into the heavy section (shown in green) is the real fix. The old gate will act as a second gate, so plug it with RTV if you can or make it part of the next mold.' });
      // compute ideal entry for current orientation
      const e = chooseEntry(p, P, null);
      if (e) out.regate = { l: [e.x, e.y], t: e.t };
      else {
        // no straight spoke reaches a thick section from the centre: suggest a side gate
        let b = null;
        const [hx, hy] = toW(P, p.hx, p.hy);
        for (const c of p.cands) { const w = toW(P, c.x, c.y); const sc = Math.hypot(w[0], w[1]) + 0.6 * Math.hypot(w[0] - hx, w[1] - hy) - 14 * c.w; if (!b || sc < b.sc) b = { l: [c.x, c.y], t: c.t, sc }; }
        if (b) { out.regate = { l: b.l, t: b.t, side: true }; }
      }
      if (out.regate && out.regate.side) steps[steps.length - 1].d += ' In this orientation a straight spoke cannot reach it, so bring the runner alongside the part and turn it into the edge (a side gate). Side gates also help the cavity vent.';
    }
    out.steps = steps;
    // next mold: best orientation suggestion
    const band = 60;
    const bt = bestTheta(p, band);
    out.nextTheta = bt;
    return out;
  }

  // ---------------- Explanations ----------------
  const VENT_WHY = {
    gate: 'Gate vent: one on each side of the ingate at 45°, the standard pair for a direct gate.',
    main: 'Main vent: where the line from the mold centre through the cavity meets its inner wall. That is the last spot to fill.',
    tip: 'Point vent: this feature points toward the centre. Metal fills from the outside in, so air is pushed into it and trapped.'
  };
  const VENT_SHORT = { gate: 'gate vent', main: 'main vent', tip: 'point vent' };
  function explain(inst, L) {
    const p = inst.part, g = inst.gate, w = inst.why || {}, info = w.info || {}, prm = L.prm, metal = prm.metalObj;
    const f1 = (x) => x.toFixed(1), inch = (mm) => (mm / IN).toFixed(2) + '"';
    const out = { orient: [], place: [], gate: [], vents: [] };
    // orientation
    if (info.fits === false) out.orient.push(`Too long to point straight out (${f1(info.L)} mm, with only ${f1(info.band)} mm of room between the centre limit and the rim), so it's laid at an angle.`);
    else if (info.Wd != null) {
      out.orient.push(`Long axis points out from the centre. Turned this way it takes up ${f1(info.Wd)} mm of the ring instead of as much as ${f1(info.WdMax)} mm, so more cavities fit.`);
      if (g && g.inner && g.inner.d > 3) out.orient.push(`The end facing the centre fills last. Of all the orientations tried, this one puts a thick, wide edge closest to the centre for the gate.`);
    }
    // placement
    if (w.order != null) {
      out.place.push(w.order === 0 ? 'Placed first: it is the heaviest, and heavier parts go as close to the centre as possible.' : `Placed ${w.order + 1}${['st', 'nd', 'rd'][w.order] || 'th'} of ${w.n}. Parts are placed heaviest first, so the heavy ones end up closest to the centre.`);
      if (w.partner >= 0) {
        const pi = L.placed.findIndex(q => q.why && q.why.order === w.partner);
        if (pi >= 0) out.place.push(`Sits opposite #${pi + 1}${L.placed[pi].part === p ? ' (same part)' : ''} so their weight cancels and the mold spins balanced.`);
      } else if (!w.slotted) out.place.push('Spot picked to keep the centre of mass as close to the middle as possible.');
      out.place.push(w.pushed ? `Inner end is ${inch(w.rho)} from the centre. Neighbours or their spokes pushed it out past the ${inch(prm.innerR)} limit.` : `Inner end is at the ${inch(prm.innerR)} "closest to centre" limit.`);
    }
    if (inst.bad) out.place.push('Moved by hand and now too close to a neighbour, the rim, or the centre.');
    // gate
    if (g) {
      out.gate.push(`Enters the ${g.thick > 0.97 ? 'thickest' : 'heaviest'} section (${g.t.toFixed(2)} of ${p.maxT.toFixed(2)} mm thick, ${f1(g.localW)} mm wide). That section shrinks most and freezes last, so it has to stay connected to the metal supply.`);
      const inn = g.inner;
      if (inn && inn.d > 3) {
        const thin = inn.t < 0.9 * p.maxT || inn.s < 0.4;
        out.gate.push(thin ? `The part's innermost point is a thin or narrow feature (${inn.t.toFixed(2)} mm). Gating there would freeze off first and starve the rest, so that point gets a vent instead.` : `Not at the very innermost point, because the gate needs a thick, wide edge with a straight path from the centre.`);
      }
      out.gate.push(`Slot ${f1(g.slotW)} × ${f1(g.slotD)} mm (${inch(g.slotW)} × ${inch(g.slotD)}) is a starting size: about a third of the section width, scaled by ${metal.name.split('(')[0].trim()}'s gate factor (${metal.gateFactor}). Cut it small and enlarge after trial spins.`);
      if (!g.clear) out.gate.push('The straight spoke to this gate crosses another cavity. Move one of them or use a side gate.');
    }
    // vents
    (inst.vents || []).forEach((v, k) => {
      let t = VENT_WHY[v.kind] || v.why;
      if (v.drilled || !v.path) t += ` Drill through to the back of the mold half and channel to the rim there: ${v.drillWhy || 'no clear path'}.`;
      else t += ' Channel jogs slightly toward the centre, turns, then zig-zags out to the rim (straight channels clog).';
      out.vents.push({ tag: 'V' + (k + 1), kind: v.kind, short: VENT_SHORT[v.kind] + (v.drilled || !v.path ? ' · drill' : ''), text: t });
    });
    return out;
  }
  function explainLayout(L) {
    const prm = L.prm, inch = (mm) => (mm / IN).toFixed(2) + '"';
    const a = [];
    a.push('Cavities fill from the outer end inward, so the side of each cavity nearest the centre fills last. Gates and vents are planned around that.');
    a.push(L.placed.some(i => i.why && i.why.slotted) ? 'Evenly spaced around the mold, with matching parts paired directly opposite each other for balance (like a layout template).' : 'Even spacing didn\'t fit, so each part was packed in the closest free spot that kept the mold balanced.');
    a.push(`Heaviest parts are placed first so they sit closest to the centre. Clearances: ${inch(prm.innerR)} from centre, ${inch(prm.rimMargin)} from the rim, ${inch(prm.spacing)} between cavities.`);
    a.push(`Each cavity has one gate on a straight spoke from the basin. One gate per cavity avoids cold shuts.`);
    a.push(`Centre of mass is ${L.imbalance.toFixed(1)} mm from the middle (0 = perfectly balanced).`);
    return a;
  }

  return { explain, explainLayout, frameFor, parseSTL, analyze, layout, refresh, finish, diagnose, METALS, toW, toL, pose, chooseEntry, bestTheta, IN };
})();
if (typeof module !== 'undefined') module.exports = Engine;
