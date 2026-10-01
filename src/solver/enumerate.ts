import { combinations, solveLp, solveSquare } from './lp.js';

export interface EquilibriumCandidate {
  p: number[];
  q: number[];
  value: number;
}

export interface EnumerationResult {
  candidate: EquilibriumCandidate | null;
  iterations: number;
  stopReason: 'optimal' | 'budget_exhausted';
}

export function enumerateEquilibria(matrix: number[][], eps = 1e-9, maxIterations = Number.MAX_SAFE_INTEGER): EnumerationResult {
  const m = matrix.length;
  const n = matrix[0].length;
  const candidates: EquilibriumCandidate[] = [];
  let iterations = 0;
  for (let rowSupportSize = 1; rowSupportSize <= m; rowSupportSize++) {
    for (const rowSupport of combinations(m, rowSupportSize)) {
      for (let columnSupportSize = 1; columnSupportSize <= n; columnSupportSize++) {
        for (const columnSupport of combinations(n, columnSupportSize)) {
          iterations++;
          if (iterations > maxIterations) {
            candidates.sort((a, b) => JSON.stringify([a.p, a.q]).localeCompare(JSON.stringify([b.p, b.q])));
            return { candidate: candidates[0] ?? null, iterations, stopReason: 'budget_exhausted' };
          }
          const candidate = solveSupport(matrix, rowSupport, columnSupport, eps);
          if (candidate) candidates.push(candidate);
        }
      }
    }
  }
  candidates.sort((a, b) => JSON.stringify([a.p, a.q]).localeCompare(JSON.stringify([b.p, b.q])));
  return { candidate: candidates[0] ?? null, iterations, stopReason: 'optimal' };
}

function solveSupport(matrix: number[][], rows: number[], columns: number[], eps: number): EquilibriumCandidate | null {
  let qSolution: number[] | null = solveProbabilitySystem(matrix, rows, columns, 'column', eps);
  let pSolution: number[] | null = solveProbabilitySystem(matrix, rows, columns, 'row', eps);
  if (!qSolution || !pSolution) return null;
  const q = Array(matrix[0].length).fill(0);
  const p = Array(matrix.length).fill(0);
  columns.forEach((j, index) => { q[j] = qSolution[index]; });
  rows.forEach((i, index) => { p[i] = pSolution[index]; });
  const valueFromQ = qSolution[qSolution.length - 1];
  const valueFromP = pSolution[pSolution.length - 1];
  if (Math.abs(valueFromQ - valueFromP) > 1e-7) return null;
  if (p.some((x) => x < -eps) || q.some((x) => x < -eps)) return null;
  if (Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-7 || Math.abs(q.reduce((a, b) => a + b, 0) - 1) > 1e-7) return null;
  const rowPayoffs = matrix.map((row) => row.reduce((sum, value, j) => sum + value * q[j], 0));
  const columnPayoffs = matrix[0].map((_, j) => matrix.reduce((sum, row, i) => sum + p[i] * row[j], 0));
  if (rowPayoffs.some((payoff) => payoff > valueFromQ + 1e-7)) return null;
  if (columnPayoffs.some((payoff) => payoff < valueFromP - 1e-7)) return null;
  if (rows.some((i) => Math.abs(rowPayoffs[i] - valueFromQ) > 1e-7)) return null;
  if (columns.some((j) => Math.abs(columnPayoffs[j] - valueFromP) > 1e-7)) return null;
  return { p, q, value: (valueFromP + valueFromQ) / 2 };
}

function solveProbabilitySystem(matrix: number[][], rows: number[], columns: number[], player: 'row' | 'column', eps: number): number[] | null {
  const support = player === 'row' ? rows : columns;
  const otherSupport = player === 'row' ? columns : rows;
  const size = support.length;
  if (rows.length === columns.length) {
    const system = player === 'column'
      ? { a: [...rows.map((i) => [...columns.map((j) => matrix[i][j]), -1])], b: rows.map(() => 0) }
      : { a: [...columns.map((j) => [...rows.map((i) => matrix[i][j]), -1])], b: columns.map(() => 0) };
    system.a.push([...support.map(() => 1), 0]);
    system.b.push(1);
    return solveSquare(system.a, system.b);
  }
  const vars = size + 1;
  const objective = [1, ...Array(size).fill(0)];
  const equalities = [[0, ...Array(size).fill(1), 1]];
  const allOpponents = player === 'row' ? matrix[0].map((_, j) => j) : matrix.map((_, i) => i);
  const activeInequalities = allOpponents.map((other) => {
    const coefficients = support.map((index) => player === 'column' ? matrix[other][index] : matrix[index][other]);
    const signed = player === 'row' ? coefficients.map((v) => -v) : coefficients;
    return [player === 'row' ? 1 : -1, ...signed, 0];
  });
  const nonNegativity = Array.from({ length: vars }, (_, j) => {
    const row = Array(vars + 1).fill(0);
    row[j] = -1;
    return row;
  });
  const result = solveLp({
    direction: player === 'column' ? 'min' : 'max',
    objective,
    equalities,
    inequalities: [...activeInequalities, ...nonNegativity],
  }, eps);
  return result.status === 'optimal' ? result.x : null;
}

function buildColumnSystem(matrix: number[][], rows: number[], columns: number[]) {
  const size = columns.length + 1;
  if (rows.length + 1 !== size) return null;
  return {
    a: [
      ...rows.map((i) => [...columns.map((j) => matrix[i][j]), -1]),
      [...columns.map(() => 1), 0],
    ],
    b: [...rows.map(() => 0), 1],
  };
}

function buildRowSystem(matrix: number[][], rows: number[], columns: number[]) {
  const size = rows.length + 1;
  if (columns.length + 1 !== size) return null;
  return {
    a: [
      ...columns.map((j) => [...rows.map((i) => matrix[i][j]), -1]),
      [...rows.map(() => 1), 0],
    ],
    b: [...columns.map(() => 0), 1],
  };
}
