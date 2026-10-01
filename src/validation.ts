export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function requireString(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError('INVALID_FIELD', 400, `${field} is required`);
  const text = value.trim();
  if (text.length > max) throw new ApiError('INVALID_FIELD', 400, `${field} is too long`);
  return text;
}

export function validateMatrix(values: unknown): number[][] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 6) throw new ApiError('INVALID_MATRIX_SIZE', 400, 'matrix must have 1 to 6 rows');
  const cols = (values[0] as unknown[]).length;
  if (!Array.isArray(values[0]) || cols < 1 || cols > 6) throw new ApiError('INVALID_MATRIX_SIZE', 400, 'matrix must have 1 to 6 columns');
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== cols) throw new ApiError('INVALID_MATRIX_SHAPE', 400, 'all rows must have equal length');
    for (const value of row) if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError('INVALID_PAYOFF', 400, 'payoffs must be finite numbers');
  }
  return values as number[][];
}

export function validateLabels(labels: unknown, expected: number, field: string): string[] {
  if (labels === undefined) return Array.from({ length: expected }, (_, i) => `${field}${i + 1}`);
  if (!Array.isArray(labels) || labels.length !== expected) throw new ApiError('INVALID_LABELS', 400, `${field} labels must contain ${expected} entries`);
  return labels.map((label, i) => requireString(label, `${field}[${i}]`, 80));
}

export function validateTolerance(value: unknown): number {
  const tolerance = value === undefined ? 1e-8 : Number(value);
  if (!Number.isFinite(tolerance) || tolerance < 1e-12 || tolerance > 0.1) throw new ApiError('INVALID_TOLERANCE', 400, 'tolerance must be between 1e-12 and 0.1');
  return tolerance;
}

export function validateMaxIterations(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const iterations = Number(value);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) throw new ApiError('INVALID_ITERATION_BUDGET', 400, 'maxIterations must be an integer from 1 to 100000');
  return iterations;
}

export function parsePagination(url: URL): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) throw new ApiError('INVALID_PAGINATION', 400, 'invalid pagination');
  return { limit, offset };
}
