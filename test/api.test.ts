import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { rmSync } from "node:fs";
import { createApiServer } from "../src/server.js";
import { Store } from "../src/db.js";

const dbPath = "data/test-api.sqlite";
process.env.GAME_DB_PATH = dbPath;
rmSync(dbPath, { force: true });
const server = createApiServer();
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(() => {
  server.close();
});

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init.body ? init.body : undefined
  });
  return { status: response.status, body: await response.json() };
}

test("API validates matrices with explicit error code", async () => {
  const response = await api("/games", {
    method: "POST",
    body: JSON.stringify({
      name: "bad",
      payoffUnit: "utils",
      rowActions: ["a"],
      columnActions: ["a", "b"],
      matrix: [[1]]
    })
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_ACTIONS");
});

test("creates, solves, paginates, idempotently repeats and persists across restart", async () => {
  const unique = `RPS-${Date.now()}-${Math.random()}`;
  const created = await api("/games", {
    method: "POST",
    body: JSON.stringify({
      name: unique,
      payoffUnit: "utils",
      rowActions: ["rock", "paper", "scissors"],
      columnActions: ["rock", "paper", "scissors"],
      matrix: [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]
    })
  });
  assert.equal(created.status, 201);
  const gameId = created.body.id;
  const game = await api(`/games/${gameId}`);
  const version = game.body.versions[0];

  const solveOne = await api(`/matrix-versions/${version.id}/solve`, {
    method: "POST",
    body: JSON.stringify({ requestId: "repeat-rps", tolerance: 1e-9, budget: 2000 })
  });
  assert.equal(solveOne.status, 200);
  assert.equal(solveOne.body.result.status, "equilibrium");
  assert.equal(solveOne.body.certificate.signature.length, 64);

  const solveTwo = await api(`/matrix-versions/${version.id}/solve`, {
    method: "POST",
    body: JSON.stringify({ requestId: "repeat-rps", tolerance: 1e-9, budget: 2000 })
  });
  assert.equal(solveTwo.body.id, solveOne.body.id);

  const page = await api("/solves?limit=1&offset=0");
  assert.equal(page.body.limit, 1);
  assert.equal(Array.isArray(page.body.items), true);

  const tampered = structuredClone(solveOne.body.certificate);
  tampered.status = "unproven";
  const rejected = await api("/certificates/verify", { method: "POST", body: JSON.stringify({ certificate: tampered }) });
  assert.equal(rejected.body.validSignature, false);
  assert.equal(rejected.body.valid, false);

  const valid = await api("/certificates/verify", { method: "POST", body: JSON.stringify({ certificate: solveOne.body.certificate }) });
  assert.equal(valid.body.valid, true);

  const beforeRevisions = game.body.versions.length;
  const badRevision = await api(`/games/${gameId}/versions`, { method: "POST", body: JSON.stringify({ matrix: [[1]], revisionNote: "bad" }) });
  assert.equal(badRevision.status, 400);
  const unchanged = await api(`/games/${gameId}`);
  assert.equal(unchanged.body.versions.length, beforeRevisions);

  const revision = await api(`/games/${gameId}/versions`, {
    method: "POST",
    body: JSON.stringify({ matrix: [[2, 0, 4], [3, 1, 0], [0, 2, 1]], revisionNote: "payoff revision" })
  });
  assert.equal(revision.status, 201);
  const oldSolve = await api(`/solves/${solveOne.body.id}`);
  assert.equal(oldSolve.body.matrixVersionId, version.id);

  server.close();
  await new Promise((resolve) => server.once("close", resolve));
  const reopenedStore = new Store(dbPath);
  const persisted = reopenedStore.getSolve(solveOne.body.id);
  assert.ok(persisted);
  assert.equal(persisted!.result.status, "equilibrium");
  reopenedStore.close();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
