import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveGame, verifyProfile } from '../src/solver/game.js';

const labels = (m: number, n: number) => ({ row: Array.from({ length: m }, (_, i) => `R${i + 1}`), column: Array.from({ length: n }, (_, j) => `C${j + 1}`) });
const approx = (actual: number[], expected: number[]) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-8));

test('matching pennies has a unique-value mixed equilibrium', () => {
  const s = solveGame([[1, -1], [-1, 1]], labels(2, 2), { tolerance: 1e-8 });
  assert.equal(s.equilibrium, true);
  approx(s.rowStrategy, [0.5, 0.5]);
  approx(s.columnStrategy, [0.5, 0.5]);
  assert.equal(Math.abs(s.value) < 1e-8, true);
});

test('rock-paper-scissors is uniform and all actions are best responses', () => {
  const matrix = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]];
  const s = solveGame(matrix, labels(3, 3), { tolerance: 1e-8 });
  assert.equal(s.equilibrium, true);
  approx(s.rowStrategy, [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(s.rowBestResponses, [0, 1, 2]);
  assert.deepEqual(s.columnBestResponses, [0, 1, 2]);
});

test('pure saddle point is accepted deterministically', () => {
  const s = solveGame([[1, 2], [1, 3]], labels(2, 2), { tolerance: 1e-8 });
  assert.equal(s.equilibrium, true);
  assert.equal(s.value, 1);
  approx(s.rowStrategy, [0, 1]);
  approx(s.columnStrategy, [1, 0]);
});

test('duplicate rows and all-zero matrices do not claim uniqueness', () => {
  const s = solveGame([[0, 0], [0, 0]], labels(2, 2), { tolerance: 1e-8 });
  assert.equal(s.equilibrium, true);
  assert.match(s.canonicalRule, /deterministic/);
  assert.equal(s.rowBestResponses.length, 2);
});

test('rectangular games solve both orientations', () => {
  const wide = solveGame([[1, 2, 3, 4]], labels(1, 4), { tolerance: 1e-8 });
  const tall = solveGame([[1], [2], [3]], labels(3, 1), { tolerance: 1e-8 });
  assert.equal(wide.value, 1);
  assert.equal(tall.value, 3);
  approx(wide.columnStrategy, [1, 0, 0, 0]);
  approx(tall.rowStrategy, [0, 0, 1]);
});

test('translation, positive scaling and row-column permutation preserve equilibrium', () => {
  const base = [[5, 2], [4, 1]];
  const translated = base.map((r) => r.map((v) => v + 7));
  const scaled = base.map((r) => r.map((v) => v * 3));
  const permuted = [[1, 4], [2, 5]].map((row) => row.reverse()).reverse();
  const a = solveGame(base, labels(2, 2), { tolerance: 1e-8 });
  const b = solveGame(translated, labels(2, 2), { tolerance: 1e-8 });
  const c = solveGame(scaled, labels(2, 2), { tolerance: 1e-8 });
  const d = solveGame(permuted, labels(2, 2), { tolerance: 1e-8 });
  assert.ok(Math.abs((b.value - 7) - a.value) < 1e-8);
  assert.ok(Math.abs(c.value / 3 - a.value) < 1e-8);
  assert.ok(Math.abs(d.value - a.value) < 1e-8);
});

test('strictly dominated action is reported with evidence and mapped back', () => {
  const s = solveGame([[1, 2], [3, 4]], labels(2, 2), { tolerance: 1e-8, eliminateStrictlyDominated: true });
  assert.equal(s.dominanceEvidence.some((e) => e.removedAction === 0 && e.keptAction === 1), true);
  assert.equal(s.rowStrategy.length, 2);
});

test('near-degenerate matrix remains certified within tolerance', () => {
  const s = solveGame([[1, 1 + 1e-9], [1 - 1e-9, 1]], labels(2, 2), { tolerance: 1e-7 });
  assert.equal(s.equilibrium, true);
});

test('external invalid probabilities and off-equilibrium strategies are rejected using all actions', () => {
  const invalid = verifyProfile([[1, -1], [-1, 1]], { rowStrategy: [0.5, 0.6], columnStrategy: [0.5, 0.5] }, 1e-8);
  const off = verifyProfile([[1, -1], [-1, 1]], { rowStrategy: [1, 0], columnStrategy: [1, 0] }, 1e-8);
  assert.equal(invalid.validProbabilities, false);
  assert.equal(off.equilibrium, false);
  assert.equal(off.dualityGap > 0, true);
});

test('exhausted iteration budget preserves bounds and does not certify equilibrium', () => {
  const s = solveGame([[1, -1], [-1, 1]], labels(2, 2), { tolerance: 1e-8, maxIterations: 1 });
  assert.equal(s.equilibrium, false);
  assert.equal(s.stopReason, 'budget_exhausted');
  assert.ok(Number.isFinite(s.lowerBound) && Number.isFinite(s.upperBound));
});
