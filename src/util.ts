import crypto from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)])
    );
  }
  return value;
}

export function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function lexCompare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    const diff = left - right;
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function roundStored(value: number, digits = 12): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function mapStrategyBack(strategy: number[], keptIndexes: number[], size: number): number[] {
  const result = Array.from({ length: size }, () => 0);
  strategy.forEach((probability, index) => {
    result[keptIndexes[index]] = probability;
  });
  return result;
}
