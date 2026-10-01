import { enumerateEquilibria } from './enumerate.js';

export interface SolveOptions {
  tolerance: number;
  maxIterations?: number;
  eliminateStrictlyDominated?: boolean;
  seed?: string;
}

export interface ActionLabels {
  row: string[];
  column: string[];
}

export interface DominanceEvidence {
  player: 'row' | 'column';
  removedAction: number;
  keptAction: number;
  payoffDifferences: number[];
  minimumGap: number;
  iteration: number;
}

export interface GameSolution {
  rowStrategy: number[];
  columnStrategy: number[];
  value: number;
  rowBestResponses: number[];
  columnBestResponses: number[];
  rowGuaranteedPayoff: number;
  columnGuaranteedPayoff: number;
  lowerBound: number;
  upperBound: number;
  dualityGap: number;
  equilibrium: boolean;
  stopReason: 'optimal' | 'budget_exhausted' | 'infeasible' | 'numerical_failure';
  algorithm: string;
  tolerance: number;
  canonicalRule: string;
  dominanceEvidence: DominanceEvidence[];
  rowSupport: number[];
  columnSupport: number[];
  iterations?: number;
}

export interface StrategyProfile {
  rowStrategy: number[];
  columnStrategy: number[];
}

export interface VerificationResult extends StrategyProfile {
  value: number;
  rowPayoffs: number[];
  columnPayoffs: number[];
  rowBestResponses: number[];
  columnBestResponses: number[];
  lowerBound: number;
  upperBound: number;
  dualityGap: number;
  validProbabilities: boolean;
  equilibrium: boolean;
  tolerance: number;
  errors: string[];
}

export function rowPayoffs(matrix: number[][], q: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, j) => sum + value * q[j], 0));
}

export function columnPayoffs(matrix: number[][], p: number[]): number[] {
  return matrix[0].map((_, j) => matrix.reduce((sum, row, i) => sum + p[i] * row[j], 0));
}

function best(values: number[], tolerance: number, minimize = false): number[] {
  let target = minimize ? Math.min(...values) : Math.max(...values);
  return values.map((value, index) => ({ value, index })).filter((x) => Math.abs(x.value - target) <= tolerance).map((x) => x.index);
}

export function support(strategy: number[], tolerance: number): number[] {
  return strategy.map((p, i) => ({ p, i })).filter((x) => x.p > tolerance).map((x) => x.i);
}

export function validateProbabilities(strategy: number[], length: number, tolerance: number): string[] {
  const errors: string[] = [];
  if (!Array.isArray(strategy) || strategy.length !== length) errors.push(`expected ${length} probabilities`);
  else {
    if (strategy.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < -tolerance)) errors.push('probabilities must be finite and non-negative');
    if (Math.abs(strategy.reduce((a, b) => a + b, 0) - 1) > tolerance) errors.push('probabilities must sum to one');
  }
  return errors;
}

export function verifyProfile(matrix: number[][], profile: StrategyProfile, tolerance: number): VerificationResult {
  const errors = [
    ...validateProbabilities(profile.rowStrategy, matrix.length, tolerance),
    ...validateProbabilities(profile.columnStrategy, matrix[0].length, tolerance),
  ];
  const p = clean(profile.rowStrategy);
  const q = clean(profile.columnStrategy);
  const rows = rowPayoffs(matrix, q);
  const columns = columnPayoffs(matrix, p);
  const lower = Math.max(...rows);
  const upper = Math.min(...columns);
  const value = p.reduce((sum, _, i) => sum + p[i] * rows[i], 0);
  const rowBR = best(rows, tolerance);
  const columnBR = best(columns, tolerance, true);
  const gap = Math.max(0, lower - upper);
  const validProbabilities = errors.length === 0;
  const equilibrium = validProbabilities && gap <= tolerance &&
    rows.every((v) => v <= value + tolerance) && columns.every((v) => v >= value - tolerance);
  if (!validProbabilities) errors.push('strategy profile is not a probability pair');
  return {
    rowStrategy: p,
    columnStrategy: q,
    value,
    rowPayoffs: rows,
    columnPayoffs: columns,
    rowBestResponses: rowBR,
    columnBestResponses: columnBR,
    lowerBound: lower,
    upperBound: upper,
    dualityGap: gap,
    validProbabilities,
    equilibrium,
    tolerance,
    errors,
  };
}

function clean(strategy: number[]): number[] {
  const cleaned = strategy.map((p) => (Math.abs(p) < 1e-7 ? 0 : p));
  const sum = cleaned.reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) && sum > 0 ? cleaned.map((p) => p / sum) : cleaned;
}

export function findPureStrictDominance(matrix: number[][]): DominanceEvidence[] {
  const aliveRows = new Set(matrix.map((_, i) => i));
  const aliveColumns = new Set(matrix[0].map((_, j) => j));
  const evidence: DominanceEvidence[] = [];
  let changed = true;
  let iteration = 0;
  while (changed) {
    changed = false;
    iteration++;
    for (const i of [...aliveRows]) {
      for (const k of aliveRows) {
        if (i === k) continue;
        const differences = [...aliveColumns].map((j) => matrix[k][j] - matrix[i][j]);
        const gap = Math.min(...differences);
        if (gap > 1e-9) {
          evidence.push({ player: 'row', removedAction: i, keptAction: k, payoffDifferences: differences, minimumGap: gap, iteration });
          aliveRows.delete(i);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
    if (changed) continue;
    for (const j of [...aliveColumns]) {
      for (const k of aliveColumns) {
        if (j === k) continue;
        const differences = [...aliveRows].map((i) => matrix[i][j] - matrix[i][k]);
        const gap = Math.min(...differences);
        if (gap > 1e-9) {
          evidence.push({ player: 'column', removedAction: j, keptAction: k, payoffDifferences: differences, minimumGap: gap, iteration });
          aliveColumns.delete(j);
          changed = true;
          break;
        }
      }
    }
  }
  return evidence;
}

export function solveGame(matrix: number[][], labels: ActionLabels, options: SolveOptions): GameSolution {
  const tolerance = options.tolerance;
  const dominanceEvidence = findPureStrictDominance(matrix);
  let activeMatrix = matrix;
  let rowMap = matrix.map((_, i) => i);
  let columnMap = matrix[0].map((_, j) => j);
  if (options.eliminateStrictlyDominated) {
    const removedRows = new Set(dominanceEvidence.filter((e) => e.player === 'row').map((e) => e.removedAction));
    const removedColumns = new Set(dominanceEvidence.filter((e) => e.player === 'column').map((e) => e.removedAction));
    rowMap = rowMap.filter((i) => !removedRows.has(i));
    columnMap = columnMap.filter((j) => !removedColumns.has(j));
    activeMatrix = rowMap.map((i) => columnMap.map((j) => matrix[i][j]));
  }
  const solved = solveActiveGame(activeMatrix, tolerance, options.maxIterations ?? Number.MAX_SAFE_INTEGER);
  if (solved.stopReason !== 'optimal') {
    const uniformRows = Array(matrix.length).fill(1 / matrix.length);
    const uniformColumns = Array(matrix[0].length).fill(1 / matrix[0].length);
    const verification = verifyProfile(matrix, { rowStrategy: uniformRows, columnStrategy: uniformColumns }, tolerance);
    return {
      ...baseCertificate(matrix, uniformRows, uniformColumns, tolerance, dominanceEvidence, labels),
      stopReason: solved.stopReason,
      lowerBound: verification.lowerBound,
      upperBound: verification.upperBound,
      dualityGap: verification.dualityGap,
      equilibrium: false,
    };
  }
  const p = Array(matrix.length).fill(0);
  const q = Array(matrix[0].length).fill(0);
  solved.p.forEach((value, i) => { p[rowMap[i]] = value; });
  solved.q.forEach((value, j) => { q[columnMap[j]] = value; });
  return { ...baseCertificate(matrix, p, q, tolerance, dominanceEvidence, labels), stopReason: solved.stopReason, iterations: solved.iterations };
}

function baseCertificate(matrix: number[][], p: number[], q: number[], tolerance: number, dominanceEvidence: DominanceEvidence[], labels: ActionLabels): GameSolution {
  const verification = verifyProfile(matrix, { rowStrategy: p, columnStrategy: q }, tolerance);
  return {
    rowStrategy: verification.rowStrategy,
    columnStrategy: verification.columnStrategy,
    value: verification.equilibrium ? verification.lowerBound : verification.value,
    rowBestResponses: verification.rowBestResponses,
    columnBestResponses: verification.columnBestResponses,
    rowGuaranteedPayoff: verification.lowerBound,
    columnGuaranteedPayoff: verification.upperBound,
    lowerBound: verification.lowerBound,
    upperBound: verification.upperBound,
    dualityGap: verification.dualityGap,
    equilibrium: verification.equilibrium,
    stopReason: 'optimal',
    algorithm: 'two-phase revised simplex LP; lexicographic tie-breaking over probabilities',
    tolerance,
    canonicalRule: 'deterministic sequential lexicographic probability optimization; labels only affect display, not selection',
    dominanceEvidence,
    rowSupport: support(verification.rowStrategy, tolerance),
    columnSupport: support(verification.columnStrategy, tolerance),
    iterations: undefined as number | undefined,
  } as GameSolution;
}

function solveActiveGame(matrix: number[][], tolerance: number, maxIterations: number): { p: number[]; q: number[]; stopReason: GameSolution['stopReason']; iterations?: number } {
  const result = enumerateEquilibria(matrix, Math.min(tolerance, 1e-9), maxIterations);
  if (!result.candidate) return { p: [], q: [], stopReason: result.stopReason === 'budget_exhausted' ? 'budget_exhausted' : 'numerical_failure' };
  return { p: clean(result.candidate.p), q: clean(result.candidate.q), stopReason: result.stopReason, iterations: result.iterations };
}
