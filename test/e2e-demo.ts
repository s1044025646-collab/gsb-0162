import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Store } from "../src/db.js";
import { validateStrategies } from "../src/solver.js";

const dbPath = "data/demo.sqlite";
rmSync(dbPath, { force: true });

const store = new Store(dbPath);
const rps = store.createGame({
  name: "deterministic-rock-paper-scissors-demo",
  payoffUnit: "utility point",
  rowActions: ["rock", "paper", "scissors"],
  columnActions: ["rock", "paper", "scissors"],
  matrix: [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]
});
const versionOne = store.listVersions(rps.id)[0];
const solved = store.solve(versionOne.id, { tolerance: 1e-9, budget: 2000, requestId: "demo-rps-v1" });
const certificate = store.exportCertificate(solved.id);
const repeated = store.solve(versionOne.id, { tolerance: 1e-9, budget: 2000, requestId: "demo-rps-v1" });
assert.equal(repeated.id, solved.id);
assert.equal(store.verifyCertificate(certificate).valid, true);

const revised = store.reviseMatrix(rps.id, [[1, 0, 2], [2, 1, 0], [0, 2, 1]], "demo deterministic payoff revision");
const solvedRevised = store.solve(revised.id, { tolerance: 1e-9, budget: 2000, requestId: "demo-rps-v2" });
const external = validateStrategies(versionOne.matrix, [1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3], 1e-9);
assert.equal(external.isEquilibrium, true);

console.log(JSON.stringify({
  game: rps,
  v1: { version: 1, value: solved.result.value, rowStrategy: solved.result.rowStrategy, columnStrategy: solved.result.columnStrategy },
  certificate: { id: certificate.certificateId, status: certificate.status, signature: certificate.signature },
  v2: { version: 2, value: solvedRevised.result.value, status: solvedRevised.result.status },
  externalStrategy: external
}, null, 2));
store.close();
