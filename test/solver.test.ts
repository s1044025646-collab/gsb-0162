import assert from "node:assert/strict";
import test from "node:test";
import { solveGame, validateStrategies } from "../src/solver.js";

const approx = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("matching pennies has uniform mixed equilibrium and value zero", () => {
  const matrix = [[1, -1], [-1, 1]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 100 });
  assert.equal(result.status, "equilibrium");
  assert.deepEqual(result.rowStrategy, [0.5, 0.5]);
  assert.deepEqual(result.columnStrategy, [0.5, 0.5]);
  approx(result.value!, 0);
  assert.deepEqual(result.bestResponses?.rowPlayer, [0, 1]);
  assert.deepEqual(result.bestResponses?.columnPlayer, [0, 1]);
});

test("rock paper scissors has uniform equilibrium and negative values supported", () => {
  const matrix = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 2000 });
  assert.equal(result.status, "equilibrium");
  assert.deepEqual(result.rowStrategy, [1 / 3, 1 / 3, 1 / 3].map((x) => Math.round(x * 1e12) / 1e12));
  approx(result.value!, 0);
  assert.equal(result.dualityGap! <= 1e-9, true);
});

test("pure saddle point is detected without claiming it is the only mixed face", () => {
  const matrix = [[3, 4], [2, 1]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 2000 });
  assert.equal(result.status, "equilibrium");
  approx(result.value!, 3);
  assert.deepEqual(result.rowStrategy, [1, 0]);
  assert.deepEqual(result.columnStrategy, [1, 0]);
});

test("all-zero rectangular matrix has deterministic canonical equilibrium", () => {
  const matrix = [[0, 0, 0], [0, 0, 0]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 2000 });
  assert.equal(result.status, "equilibrium");
  approx(result.value!, 0);
  assert.equal(result.uniqueAtVertices, false);
  assert.deepEqual(result.rowStrategy, [0, 1]);
  assert.deepEqual(result.columnStrategy, [0, 0, 1]);
});

test("duplicate actions produce multiple equilibria and full best response check", () => {
  const matrix = [[1, 1], [1, 1], [0, 0]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 2000 });
  assert.equal(result.status, "equilibrium");
  approx(result.value!, 1);
  assert.equal(result.uniqueAtVertices, false);
  assert.deepEqual(result.bestResponses?.rowPlayer, [0, 1]);
  assert.deepEqual(result.bestResponses?.columnPlayer, [2]);
});

test("strict dominance reduction maps evidence and support back to original indexes", () => {
  const matrix = [[-10, -10], [1, -1], [-1, 1]];
  const result = solveGame(matrix, { tolerance: 1e-9, budget: 2000, reduceStrictDom: true });
  assert.equal(result.reduction.used, true);
  assert.equal(result.reduction.evidence[0].role, "row");
  assert.equal(result.reduction.evidence[0].removedIndex, 0);
  assert.deepEqual(result.rowSupport, [1, 2]);
  assert.equal(result.rowStrategy[0], 0);
  assert.equal(result.status, "equilibrium");
});

test("near-degenerate game remains unproven under a deliberately small budget but keeps bounds", () => {
  const matrix = [[1, 0.999999], [0.999999, 1]];
  const result = solveGame(matrix, { tolerance: 1e-10, budget: 1 });
  assert.equal(result.status, "unproven");
  assert.equal(result.stopReason, "budget_exhausted");
  assert.ok(result.lowerBound !== null || result.upperBound !== null);
});

test("translation and positive scaling preserve strategies and move value correctly", () => {
  const matrix = [[1, -1], [-1, 1]];
  const base = solveGame(matrix, { tolerance: 1e-9, budget: 100 });
  const translated = solveGame(matrix.map((row) => row.map((x) => x + 4)), { tolerance: 1e-9, budget: 100 });
  const scaled = solveGame(matrix.map((row) => row.map((x) => x * 2.5)), { tolerance: 1e-9, budget: 100 });
  assert.deepEqual(translated.rowStrategy, base.rowStrategy);
  approx(translated.value!, base.value! + 4);
  assert.deepEqual(scaled.columnStrategy, base.columnStrategy);
  approx(scaled.value!, base.value! * 2.5);
});

test("row and column permutation reorders strategies but keeps value", () => {
  const matrix = [[2, -1, -3], [-2, 1, 2], [1, 0, -1]];
  const base = solveGame(matrix, { tolerance: 1e-9, budget: 2000 });
  const rowOrder = [2, 0, 1];
  const columnOrder = [1, 0, 2];
  const permuted = rowOrder.map((r) => columnOrder.map((c) => matrix[r][c]));
  const result = solveGame(permuted, { tolerance: 1e-9, budget: 2000 });
  approx(result.value!, base.value!, 1e-8);
  rowOrder.forEach((oldRow, newRow) => approx(result.rowStrategy[newRow], base.rowStrategy[oldRow], 1e-8));
  columnOrder.forEach((oldColumn, newColumn) => approx(result.columnStrategy[newColumn], base.columnStrategy[oldColumn], 1e-8));
});

test("external validation rejects bad probabilities and detects off-support best response", () => {
  const matrix = [[1, -1], [-1, 1]];
  assert.equal(validateStrategies(matrix, [0.4, 0.6], [0.5, 0.5]).isEquilibrium, false);
  assert.equal(validateStrategies(matrix, [-0.1, 1.1], [0.5, 0.5]).valid, false);
  assert.equal(validateStrategies(matrix, [0.5, 0.5], [0.5, 0.5]).isEquilibrium, true);
  const checked = validateStrategies(matrix, [0.5, 0.5], [0.5, 0.5]);
  assert.deepEqual(checked.rowBestResponses, [0, 1]);
  assert.deepEqual(checked.columnBestResponses, [0, 1]);
});
