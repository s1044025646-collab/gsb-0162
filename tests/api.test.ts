import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { Server } from 'node:http';
import { openDatabase } from '../src/db/client.js';
import { Repository } from '../src/repository.js';
import { createApi, listenLocal } from '../src/api/server.js';

const directory = mkdtempSync(join(tmpdir(), 'zsg-'));
const dbPath = join(directory, 'test.sqlite');
const db = openDatabase(dbPath);
const server = createApi(new Repository(db), () => '2026-01-01T00:00:00.000Z');
let port = 0;

await listenLocal(server, 0).then((p) => { port = p; });
after(() => { server.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'content-type': 'application/json' }, ...init });
  return { status: response.status, body: await response.json() };
}

test('API validates payloads with explicit error codes', async () => {
  const response = await call('/api/matrices', { method: 'POST', body: JSON.stringify({ values: [[1]] }) });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_FIELD');
});

test('API creates versions, solves idempotently, verifies and paginates', async () => {
  const created = await call('/api/matrices', { method: 'POST', body: JSON.stringify({ name: `m-${Date.now()}`, values: [[1, -1], [-1, 1]] }) });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const solveBody = { idempotencyKey: 'fixed-key', tolerance: 1e-8 };
  const first = await call(`/api/matrices/${id}/solve`, { method: 'POST', body: JSON.stringify(solveBody) });
  const second = await call(`/api/matrices/${id}/solve`, { method: 'POST', body: JSON.stringify(solveBody) });
  assert.equal(first.status, 201);
  assert.equal(second.body.fingerprint, first.body.fingerprint);
  assert.equal(first.body.solution.equilibrium, true);
  const verify = await call(`/api/matrices/${id}/verify`, { method: 'POST', body: JSON.stringify({ version: 1, rowStrategy: [0.5, 0.5], columnStrategy: [0.5, 0.5] }) });
  assert.equal(verify.body.equilibrium, true);
  const page = await call(`/api/matrices/${id}/runs?limit=1&offset=0`);
  assert.equal(page.body.items.length, 1);
});

test('revision creates a new version and old certificate remains reproducible', async () => {
  const created = await call('/api/matrices', { method: 'POST', body: JSON.stringify({ name: `rev-${Date.now()}`, values: [[1, 2]] }) });
  const id = created.body.id;
  const revised = await call(`/api/matrices/${id}/revisions`, { method: 'POST', body: JSON.stringify({ name: created.body.name, values: [[3, 4]], reason: 'raise rewards' }) });
  assert.equal(revised.body.version, 2);
  const old = await call(`/api/matrices/${id}/versions/1`);
  assert.deepEqual(old.body.values, [[1, 2]]);
});

test('invalid certificate signature is rejected', async () => {
  const response = await call('/api/certificates/verify', { method: 'POST', body: JSON.stringify({ payload: { x: 1 }, fingerprint: 'a'.repeat(64), signature: 'b' }) });
  assert.equal(response.status, 409);
  assert.equal(response.body.valid, false);
});

test('transaction rollback does not persist partial revision', () => {
  const repository = new Repository(db);
  const matrix = repository.createMatrix({ name: `rollback-${Date.now()}`, payoffUnit: 'u', values: [[1]], rowLabels: ['R'], columnLabels: ['C'], now: 't' });
  assert.throws(() => repository.reviseMatrix(matrix.id, { name: matrix.name, payoffUnit: 'u', values: [[1, 2]], rowLabels: ['R'], columnLabels: ['C', 'X'], reason: 'bad', now: 't' }));
  const reread = repository.getMatrix(matrix.id)!;
  assert.equal(reread.current_version, 1);
});

test('SQLite state survives reopening', async () => {
  const list = await call('/api/matrices?limit=100&offset=0');
  const reopened = openDatabase(dbPath);
  const repository = new Repository(reopened);
  assert.equal(repository.listMatrices(100, 0).length, list.body.items.length);
  reopened.close();
});
