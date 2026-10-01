import { createHash, createHmac } from 'node:crypto';

export const CERTIFICATE_SECRET = process.env.ZSG_CERTIFICATE_SECRET ?? 'local-development-zero-sum-secret';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

export function fingerprint(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function signFingerprint(value: string): string {
  return createHmac('sha256', CERTIFICATE_SECRET).update(value).digest('hex');
}

export function issueCertificate(payload: unknown): { fingerprint: string; signature: string } {
  const fp = fingerprint(payload);
  return { fingerprint: fp, signature: signFingerprint(fp) };
}

export function verifyCertificate(payload: unknown, expectedFingerprint: string, signature: string): boolean {
  return fingerprint(payload) === expectedFingerprint && signFingerprint(expectedFingerprint) === signature;
}
