#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Store } from "./db.js";
import { validateStrategies } from "./solver.js";

const [command, ...args] = process.argv.slice(2);
const store = new Store(process.env.GAME_DB_PATH ?? "data/game.sqlite");

function parseJson(value: string) {
  if (!value.trim().startsWith("{")) return JSON.parse(readFileSync(value, "utf8"));
  return JSON.parse(value);
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

try {
  if (command === "create") {
    const payload = parseJson(args[0] ?? "");
    const before = store.listGames(100, 0).length;
    const game = store.createGame(payload);
    print({ before: { games: before }, after: game, actions: store.getActions(game.id), initialVersion: store.listVersions(game.id)[0] });
  } else if (command === "revise") {
    const [gameId, matrixPath, revisionNote = "manual revision"] = args;
    const before = store.listVersions(gameId);
    const version = store.reviseMatrix(gameId, parseJson(matrixPath), revisionNote);
    print({ before: { versionCount: before.length, latestVersion: before.at(-1)?.version, latestHash: before.at(-1)?.matrixHash }, after: version });
  } else if (command === "solve") {
    const [versionId, tolerance = "1e-9", budget = "2000", reduce = "false", requestId] = args;
    const before = store.getVersion(versionId);
    const solved = store.solve(versionId, { tolerance: Number(tolerance), budget: Number(budget), reduceStrictDom: reduce === "true", requestId });
    print({ before: { version: before?.version, matrixHash: before?.matrixHash }, after: solved, certificate: store.exportCertificate(solved.id) });
  } else if (command === "support") {
    const [solveId] = args;
    const solved = store.getSolve(solveId);
    if (!solved) throw new Error("solve not found");
    print({
      solveId,
      rowSupport: solved.result.rowSupport,
      columnSupport: solved.result.columnSupport,
      bestResponses: solved.result.bestResponses,
      reduction: solved.result.reduction
    });
  } else if (command === "validate") {
    const payload = parseJson(args[0] ?? "");
    print({ before: payload, after: validateStrategies(payload.matrix, payload.rowStrategy, payload.columnStrategy, payload.tolerance ?? 1e-9) });
  } else if (command === "compare") {
    const [gameId, matrixPath, revisionNote = "comparison revision"] = args;
    const before = store.listVersions(gameId).at(-1)!;
    const after = store.reviseMatrix(gameId, parseJson(matrixPath), revisionNote);
    const beforeSolve = store.solve(before.id, { tolerance: 1e-9, budget: 2000 });
    const afterSolve = store.solve(after.id, { tolerance: 1e-9, budget: 2000 });
    print({
      before: { version: before.version, value: beforeSolve.result.value, hash: before.matrixHash },
      after: { version: after.version, value: afterSolve.result.value, hash: after.matrixHash },
      valueDelta: (afterSolve.result.value ?? NaN) - (beforeSolve.result.value ?? NaN)
    });
  } else if (command === "certificate") {
    print(store.exportCertificate(args[0]));
  } else {
    console.log("Commands: create <json|file>, revise <gameId> <matrixJson|file> [note], solve <versionId> [tolerance] [budget] [reduceStrictDom] [requestId], support <solveId>, validate <json|file>, compare <gameId> <matrixJson|file> [note], certificate <solveId>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message }, null, 2));
  process.exitCode = 1;
} finally {
  store.close();
}
