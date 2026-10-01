export interface LpSolution {
  status: 'optimal' | 'infeasible' | 'failed';
  x: number[];
  objective: number;
}

export interface LpProblem {
  direction: 'max' | 'min';
  objective: number[];
  equalities: number[][];
  inequalities: number[][];
  tieObjective?: number[];
}

const EPS = 1e-9;

export function combinations(size: number, choose: number): number[][] {
  if (choose <= 0) return [[]];
  const result: number[][] = [];
  const current: number[] = [];
  function visit(start: number) {
    if (current.length === choose) { result.push(current.slice()); return; }
    for (let i = start; i < size; i++) { current.push(i); visit(i + 1); current.pop(); }
  }
  visit(0);
  return result;
}

export function solveSquare(a: number[][], b: number[]): number[] | null {
  const n = a.length;
  const matrix = a.map((row) => row.slice());
  const rhs = b.slice();
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivotRow][col])) pivotRow = row;
    if (Math.abs(matrix[pivotRow][col]) < EPS) return null;
    [matrix[pivotRow], matrix[col]] = [matrix[col], matrix[pivotRow]];
    [rhs[pivotRow], rhs[col]] = [rhs[col], rhs[pivotRow]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      for (let j = col; j < n; j++) matrix[row][j] -= factor * matrix[col][j];
      rhs[row] -= factor * rhs[col];
    }
  }
  return rhs.map((value, i) => value / matrix[i][i]);
}

function feasible(x: number[], inequalities: number[][], eps: number): boolean {
  if (x.some((v) => !Number.isFinite(v) || v < -eps)) return false;
  return inequalities.every((row) => {
    const bound = row[row.length - 1];
    const value = row.slice(0, -1).reduce((sum, coefficient, j) => sum + coefficient * (x[j] ?? 0), 0);
    return value <= bound + eps;
  });
}

export function solveLp(problem: LpProblem, eps = EPS): LpSolution {
  const n = problem.objective.length;
  const candidates: number[][] = [];
  const base = problem.equalities.length;
  if (base > n) return { status: 'infeasible', x: [], objective: NaN };
  const maxExtra = Math.min(n - base, problem.inequalities.length);
  for (let extra = 0; extra <= maxExtra; extra++) {
    for (const chosen of combinations(problem.inequalities.length, extra)) {
      const system = problem.equalities.concat(chosen.map((i) => problem.inequalities[i]));
      if (system.length !== n) continue;
      const x = solveSquare(system.map((row) => row.slice(0, -1)), system.map((row) => row[row.length - 1]));
      if (x && feasible(x, problem.inequalities, eps)) candidates.push(x);
    }
  }
  if (candidates.length === 0) return { status: 'infeasible', x: [], objective: NaN };
  const scored = candidates.map((x) => ({
    x,
    value: problem.objective.reduce((sum, c, j) => sum + c * x[j], 0),
    tie: problem.tieObjective?.reduce((sum, c, j) => sum + c * x[j], 0) ?? 0,
  }));
  scored.sort((a, b) => (problem.direction === 'max' ? b.value - a.value : a.value - b.value) ||
    a.tie - b.tie ||
    JSON.stringify(a.x).localeCompare(JSON.stringify(b.x)));
  return { status: 'optimal', x: scored[0].x, objective: scored[0].value };
}
