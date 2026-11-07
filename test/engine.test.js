// Run with: npm test   (uses Node's built-in test runner, no dependencies)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

const load = (name) => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'examples', name));
  return E.parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const medallion = E.analyze(load('medallion.stl'), 'Medallion');
const sword = E.analyze(load('sword-shield.stl'), 'Sword');
const PRM = { moldDia: 9, basinR: 19, innerR: 44.5, rimMargin: 15.9, spacing: 4.8, spokeW: 5, gateLen: 4, metalObj: E.METALS.pewter };

test('reads STL size, thickness and volume', () => {
  assert.ok(Math.abs(medallion.dims[0] - 26) < 0.5, 'medallion is 26 mm wide');
  assert.ok(Math.abs(medallion.maxT - 2.2) < 0.05, 'medallion is 2.2 mm thick');
  assert.ok(medallion.vol > 900 && medallion.vol < 1300, 'medallion volume is plausible');
  assert.ok(Math.abs(sword.maxT - 2.25) < 0.05);
});

test('fills a 9" mold and balances it', () => {
  const L = E.layout([{ part: medallion, qty: 6 }, { part: sword, qty: 4 }], PRM);
  assert.equal(L.failed.length, 0);
  assert.equal(L.placed.length, 10);
  assert.ok(L.imbalance < 1, 'centre of mass within 1 mm of the middle');
});

test('keeps clearances from the centre and the rim', () => {
  const L = E.layout([{ part: medallion, qty: 6 }, { part: sword, qty: 4 }], PRM);
  for (const inst of L.placed) for (const b of inst.part.bnd) {
    const w = E.toW(inst.P, b[0], b[1]), r = Math.hypot(w[0], w[1]);
    assert.ok(r >= PRM.innerR - 0.5, 'not closer to the centre than allowed');
    assert.ok(r <= L.R - PRM.rimMargin + 0.5, 'not inside the rim margin');
  }
});

test('never gates through a thin feature', () => {
  const L = E.layout([{ part: medallion, qty: 2 }, { part: sword, qty: 2 }], PRM);
  for (const inst of L.placed) {
    assert.ok(inst.gate, 'every cavity has a gate');
    assert.ok(inst.gate.t >= 0.95 * inst.part.maxT, `${inst.part.name}: gate is on the thickest section`);
  }
});

test('vents the gate and the points facing the centre', () => {
  const L = E.layout([{ part: sword, qty: 2 }], PRM);
  const inst = L.placed[0];
  const kinds = inst.vents.map(v => v.kind);
  assert.ok(kinds.includes('gate'), 'has gate vents');
  // the blade tip is thinner than the shield and points at the centre, so it gets a vent
  assert.ok(inst.gate.inner.t < 0.9 * sword.maxT);
  assert.ok(kinds.includes('tip') || kinds.includes('main'), 'the inner point is vented');
});

test('explains every decision', () => {
  const L = E.layout([{ part: sword, qty: 2 }], PRM);
  const ex = E.explain(L.placed[0], L);
  assert.ok(ex.gate.length && ex.orient.length && ex.place.length);
  assert.equal(ex.vents.length, L.placed[0].vents.length);
  assert.ok(E.explainLayout(L).length >= 3);
});

test('diagnoses a gate on a thin blade tip', () => {
  const P = E.frameFor(sword, 0, 44.5);
  // innermost boundary point = blade tip (with rotation 0 the tip faces the centre? find it)
  let tip = null, rMin = 1e9;
  for (const b of sword.bnd) { const w = E.toW(P, b[0], b[1]), r = Math.hypot(w[0], w[1]); if (r < rMin) { rMin = r; tip = b; } }
  const out = E.diagnose({ part: sword, theta: 0, innerR: 44.5, gate: tip, unfilled: null, symptoms: new Set() }, E.METALS.pewter);
  const t = sword.thAt(tip[0], tip[1]);
  if (t < 0.85 * sword.maxT) {
    assert.ok(out.thinGate, 'flags the thin gate');
    assert.ok(out.regate, 'suggests a better gate');
  }
});

test('larger gates for fast-freezing alloys', () => {
  const a = E.layout([{ part: medallion, qty: 2 }], PRM);
  const b = E.layout([{ part: medallion, qty: 2 }], { ...PRM, metalObj: E.METALS.zamak });
  assert.ok(b.placed[0].gate.slotW >= a.placed[0].gate.slotW);
});
