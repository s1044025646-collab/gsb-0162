import type { DominanceEvidence, Matrix, SolveParams, SolveResult, StrategyValidation } from "./types.js";
import { lexCompare, mapStrategyBack, roundStored } from "./util.js";

export function validateMatrix(matrix: unknown): asserts matrix is Matrix {
  if (!Array.isArray(matrix) || matrix.length < 1 || matrix.length > 6) {
    throw httpError(400, "INVALID_MATRIX", "Matrix must have between 1 and 6 rows");
  }
  const columns = matrix[0].length;
  if (!Array.isArray(matrix[0]) || columns < 1 || columns > 6) {
    throw httpError(400, "INVALID_MATRIX", "Matrix must have between 1 and 6 columns");
  }
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== columns || !row.every((v) => Number.isFinite(v))) {
      throw httpError(400, "INVALID_MATRIX", "Every matrix cell must be a finite number with consistent width");
    }
  }
}

export function httpError(status: number, code: string, message: string): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

interface Vertex {
  probabilities: number[];
  value: number;
}

export function solveGame(matrix: Matrix, supplied: Partial<SolveParams> = {}): SolveResult {
  validateMatrix(matrix);
  const tolerance = supplied.tolerance ?? 1e-9;
  const budget = supplied.budget ?? 2000;
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw httpError(400, "INVALID_TOLERANCE", "tolerance must be positive");
  if (!Number.isInteger(budget) || budget < 1) throw httpError(400, "INVALID_BUDGET", "budget must be a positive integer");

  const originalRows = matrix.length;
  const originalColumns = matrix[0].length;
  const reduction = supplied.reduceStrictDom ? reduceStrictDominance(matrix) : {
    used: false,
    matrix,
    rowMap: matrix.map((_, i) => i),
    columnMap: matrix[0].map((_, j) => j),
    evidence: [] as DominanceEvidence[]
  };

  let candidatesExamined = 0;
  let exhausted = false;
  const consume = () => {
    if (candidatesExamined >= budget) {
      exhausted = true;
      return false;
    }
    candidatesExamined += 1;
    return true;
  };

  const rowOutput = findRowVertices(reduction.matrix, tolerance, consume);
  const columnOutput = findColumnVertices(reduction.matrix, tolerance, consume);
  const reducedRow = rowOutput.vertices.length ? canonicalBest(rowOutput.vertices, "max", tolerance) : null;
  const reducedColumn = columnOutput.vertices.length ? canonicalBest(columnOutput.vertices, "min", tolerance) : null;
  const rowStrategy = reducedRow ? mapStrategyBack(reducedRow.probabilities, reduction.rowMap, originalRows) : Array(originalRows).fill(0);
  const columnStrategy = reducedColumn ? mapStrategyBack(reducedColumn.probabilities, reduction.columnMap, originalColumns) : Array(originalColumns).fill(0);
  const lowerBound = reducedRow ? reducedRow.value : null;
  const upperBound = reducedColumn ? reducedColumn.value : null;
  const dualityGap = lowerBound !== null && upperBound !== null ? upperBound - lowerBound : null;
  const stopReason = exhausted ? "budget_exhausted" : lowerBound !== null && upperBound !== null ? "optimal" : "infeasible_numerical";
  const equilibrium = dualityGap !== null && dualityGap <= tolerance;
  const value = equilibrium && lowerBound !== null && upperBound !== null ? (lowerBound + upperBound) / 2 : null;
  const bestResponses = reducedRow && reducedColumn ? describeBestResponses(matrix, rowStrategy, columnStrategy) : null;

  return {
    status: equilibrium ? "equilibrium" : "unproven",
    stopReason,
    algorithm: "deterministic-active-constraint-vertex-enumeration",
    tolerance,
    budget,
    candidatesExamined,
    value: value === null ? null : roundStored(value),
    rowStrategy: rowStrategy.map((v) => roundStored(v)),
    columnStrategy: columnStrategy.map((v) => roundStored(v)),
    rowSupport: support(rowStrategy, tolerance),
    columnSupport: support(columnStrategy, tolerance),
    bestResponses,
    lowerBound: lowerBound === null ? null : roundStored(lowerBound),
    upperBound: upperBound === null ? null : roundStored(upperBound),
    dualityGap: dualityGap === null ? null : roundStored(dualityGap),
    optimalVertexCount: rowOutput.optimalCount + columnOutput.optimalCount,
    uniqueAtVertices: rowOutput.optimalCount === 1 && columnOutput.optimalCount === 1,
    reduction: {
      used: reduction.used,
      originalRows,
      originalColumns,
      reducedRows: reduction.matrix.length,
      reducedColumns: reduction.matrix[0].length,
      rowMap: reduction.rowMap,
      columnMap: reduction.columnMap,
      evidence: reduction.evidence
    }
  };
}

function findRowVertices(matrix: Matrix, tolerance: number, consume: () => boolean) {
  const rows = matrix.length;
  const columns = matrix[0].length;
  const vertices: Vertex[] = [];
  for (const active of combinations(rows + columns, rows)) {
    if (!consume()) break;
    const equations: number[][] = [];
    active.forEach((constraintIndex) => {
      if (constraintIndex < columns) {
        equations.push([...matrix.map((row) => row[constraintIndex]), -1, 0]);
      } else {
        const row = Array(rows + 1).fill(0);
        row[constraintIndex - columns] = 1;
        row[rows] = 0;
        equations.push([...row, 0]);
      }
    });
    equations.push([...Array(rows).fill(1), 0, 1]);
    const solution = solveSquare(equations, tolerance);
    if (!solution) continue;
    const probabilities = solution.slice(0, rows).map(clean);
    const value = clean(solution[rows]);
    if (probabilities.some((p) => p < -tolerance) || Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > tolerance) continue;
    const feasible = matrix[0].every((_, column) => dot(matrix.map((row) => row[column]), probabilities) + tolerance >= value);
    if (feasible) vertices.push({ probabilities, value });
  }
  return finishVertices(vertices, "max", tolerance);
}

function findColumnVertices(matrix: Matrix, tolerance: number, consume: () => boolean) {
  const rows = matrix.length;
  const columns = matrix[0].length;
  const vertices: Vertex[] = [];
  for (const active of combinations(rows + columns, columns)) {
    if (!consume()) break;
    const equations: number[][] = [];
    active.forEach((constraintIndex) => {
      if (constraintIndex < rows) {
        equations.push([...matrix[constraintIndex], -1, 0]);
      } else {
        const row = Array(columns + 1).fill(0);
        row[constraintIndex - rows] = 1;
        equations.push([...row, 0]);
      }
    });
    equations.push([...Array(columns).fill(1), 0, 1]);
    const solution = solveSquare(equations, tolerance);
    if (!solution) continue;
    const probabilities = solution.slice(0, columns).map(clean);
    const value = clean(solution[columns]);
    if (probabilities.some((p) => p < -tolerance) || Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > tolerance) continue;
    const feasible = matrix.every((row) => dot(row, probabilities) <= value + tolerance);
    if (feasible) vertices.push({ probabilities, value });
  }
  return finishVertices(vertices, "min", tolerance);
}

function finishVertices(vertices: Vertex[], direction: "max" | "min", tolerance: number) {
  const bestValue = vertices.length
    ? direction === "max"
      ? Math.max(...vertices.map((v) => v.value))
      : Math.min(...vertices.map((v) => v.value))
    : null;
  const optimal = bestValue === null ? [] : vertices.filter((v) => Math.abs(v.value - bestValue) <= tolerance);
  const distinct: Vertex[] = [];
  for (const vertex of optimal) {
    if (!distinct.some((other) => vectorDistance(vertex.probabilities, other.probabilities) <= tolerance)) distinct.push(vertex);
  }
  return { vertices, optimalCount: distinct.length };
}

function canonicalBest(vertices: Vertex[], direction: "max" | "min", tolerance: number): Vertex {
  const bestValue = direction === "max" ? Math.max(...vertices.map((v) => v.value)) : Math.min(...vertices.map((v) => v.value));
  return vertices
    .filter((v) => Math.abs(v.value - bestValue) <= tolerance)
    .sort((a, b) => lexCompare(a.probabilities, b.probabilities))[0];
}

export function validateStrategies(matrix: Matrix, rowInput: number[], columnInput: number[], tolerance = 1e-9): StrategyValidation {
  validateMatrix(matrix);
  const invalidProbability = (values: unknown, size: number, name: string) => {
    if (!Array.isArray(values) || values.length !== size || !values.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return { errorCode: `INVALID_${name}_STRATEGY`, message: `${name} strategy must contain ${size} finite probabilities` };
    }
    if (values.some((v) => v < -tolerance)) return { errorCode: `INVALID_${name}_STRATEGY`, message: `${name} strategy has negative probability` };
    if (Math.abs(values.reduce((a: number, b: number) => a + b, 0) - 1) > tolerance) {
      return { errorCode: `INVALID_${name}_STRATEGY`, message: `${name} probabilities must sum to one` };
    }
    return null;
  };
  const rowError = invalidProbability(rowInput, matrix.length, "ROW");
  if (rowError) return failedValidation(rowError.errorCode, rowError.message);
  const columnError = invalidProbability(columnInput, matrix[0].length, "COLUMN");
  if (columnError) return failedValidation(columnError.errorCode, columnError.message);

  const rowStrategy = rowInput.map((v) => Math.max(0, clean(v)));
  const columnStrategy = columnInput.map((v) => Math.max(0, clean(v)));
  const expectedPayoffsByColumn = matrix[0].map((_, column) => dot(matrix.map((row) => row[column]), rowStrategy));
  const expectedPayoffsByRow = matrix.map((row) => dot(row, columnStrategy));
  const lower = Math.min(...expectedPayoffsByColumn);
  const upper = Math.max(...expectedPayoffsByRow);
  return {
    valid: true,
    rowStrategy: rowStrategy.map((value) => roundStored(value)),
    columnStrategy: columnStrategy.map((value) => roundStored(value)),
    expectedPayoffsByColumn: expectedPayoffsByColumn.map((value) => roundStored(value)),
    expectedPayoffsByRow: expectedPayoffsByRow.map((value) => roundStored(value)),
    guaranteedLowerBound: roundStored(lower),
    guaranteedUpperBound: roundStored(upper),
    rowBestResponses: bestIndexes(expectedPayoffsByColumn, "max", tolerance),
    columnBestResponses: bestIndexes(expectedPayoffsByRow, "min", tolerance),
    gap: roundStored(upper - lower),
    isEquilibrium: upper - lower <= tolerance
  };
}

function failedValidation(errorCode: string, message: string): StrategyValidation {
  return {
    valid: false,
    errorCode,
    message,
    expectedPayoffsByColumn: [],
    expectedPayoffsByRow: [],
    guaranteedLowerBound: NaN,
    guaranteedUpperBound: NaN,
    rowBestResponses: [],
    columnBestResponses: [],
    gap: NaN,
    isEquilibrium: false
  };
}

function describeBestResponses(matrix: Matrix, rowStrategy: number[], columnStrategy: number[]) {
  const rowPayoffs = matrix[0].map((_, column) => dot(matrix.map((row) => row[column]), rowStrategy));
  const columnPayoffs = matrix.map((row) => dot(row, columnStrategy));
  return {
    rowPlayer: bestIndexes(rowPayoffs, "max"),
    columnPlayer: bestIndexes(columnPayoffs, "min"),
    rowPayoffs: rowPayoffs.map((value) => roundStored(value)),
    columnPayoffs: columnPayoffs.map((value) => roundStored(value))
  };
}

function reduceStrictDominance(matrix: Matrix) {
  let keptRows = matrix.map((_, i) => i);
  let keptColumns = matrix[0].map((_, j) => j);
  const evidence: DominanceEvidence[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < keptRows.length; i++) {
      const dominator = keptRows.findIndex((kept, k) => k !== i && keptColumns.every((column) => matrix[kept][column] > matrix[keptRows[i]][column]));
      if (dominator >= 0) {
        evidence.push({
          role: "row",
          removedIndex: keptRows[i],
          keptIndex: keptRows[dominator],
          payoffDifferences: keptColumns.map((column) => matrix[keptRows[dominator]][column] - matrix[keptRows[i]][column])
        });
        keptRows.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (let j = 0; j < keptColumns.length; j++) {
      const dominator = keptColumns.findIndex((kept, k) => k !== j && keptRows.every((row) => matrix[row][kept] < matrix[row][keptColumns[j]]));
      if (dominator >= 0) {
        evidence.push({
          role: "column",
          removedIndex: keptColumns[j],
          keptIndex: keptColumns[dominator],
          payoffDifferences: keptRows.map((row) => matrix[row][keptColumns[j]] - matrix[row][keptColumns[dominator]])
        });
        keptColumns.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return {
    used: evidence.length > 0,
    matrix: keptRows.map((row) => keptColumns.map((column) => matrix[row][column])),
    rowMap: keptRows,
    columnMap: keptColumns,
    evidence
  };
}

function* combinations(total: number, choose: number): Generator<number[]> {
  const current = Array.from({ length: choose }, (_, i) => i);
  outer: while (true) {
    yield [...current];
    let index = choose - 1;
    while (index >= 0 && current[index] === total - choose + index) index--;
    if (index < 0) break outer;
    current[index]++;
    for (let next = index + 1; next < choose; next++) current[next] = current[next - 1] + 1;
  }
}

function solveSquare(equations: number[][], tolerance: number): number[] | null {
  const n = equations.length;
  const matrix = equations.map((row) => row.slice());
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) <= tolerance) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      for (let k = col; k <= n; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  return matrix.map((row, i) => row[n] / row[i]);
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const clean = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value);
const support = (values: number[], tolerance: number) => values.map((v, i) => ({ v, i })).filter((x) => x.v > tolerance).map((x) => x.i);
const vectorDistance = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
function bestIndexes(values: number[], direction: "max" | "min", tolerance = 1e-9) {
  const target = direction === "max" ? Math.max(...values) : Math.min(...values);
  return values.map((v, i) => ({ v, i })).filter((x) => Math.abs(x.v - target) <= tolerance).map((x) => x.i);
}
