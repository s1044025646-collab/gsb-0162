import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson, sha256 } from "./util.js";
import { solveGame, validateMatrix } from "./solver.js";
import type { Matrix, SolveParams, SolveResult } from "./types.js";

export interface GameInput {
  name: string;
  rowActions: string[];
  columnActions: string[];
  matrix: Matrix;
  payoffUnit: string;
}

export interface Certificate {
  certificateId: string;
  matrixVersionId: string;
  matrixHash: string;
  issuedAt: string;
  algorithm: string;
  tolerance: number;
  budget: number;
  stopReason: string;
  status: string;
  result: SolveResult;
  signature: string;
}

const CERTIFICATE_SECRET = "local-zero-sum-matrix-game-v1";

export class Store {
  readonly db: DatabaseSync;

  constructor(path = "data/game.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency_keys(
        request_id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS games(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payoff_unit TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('row','column')),
        action_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        UNIQUE(game_id, role, action_index)
      );
      CREATE TABLE IF NOT EXISTS matrix_versions(
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        matrix_json TEXT NOT NULL,
        matrix_hash TEXT NOT NULL,
        revision_note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(game_id, version)
      );
      CREATE TABLE IF NOT EXISTS solves(
        id TEXT PRIMARY KEY,
        matrix_version_id TEXT NOT NULL REFERENCES matrix_versions(id) ON DELETE CASCADE,
        request_id TEXT UNIQUE,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS certificates(
        id TEXT PRIMARY KEY,
        solve_id TEXT NOT NULL UNIQUE REFERENCES solves(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
  }

  createGame(input: GameInput, now: () => Date = () => new Date()) {
    validateGameInput(input);
    const id = deterministicId("game", { name: input.name, matrix: input.matrix });
    const timestamp = now().toISOString();
    const existing = this.getGame(id);
    if (existing) return { ...existing, reused: true };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO games(id,name,payoff_unit,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(id, input.name, input.payoffUnit, timestamp, timestamp);
      this.insertActions(id, input.rowActions, input.columnActions);
      this.insertVersion(id, 1, input.matrix, "initial", timestamp);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ...this.getGame(id)!, reused: false };
  }

  reviseMatrix(gameId: string, matrix: Matrix, revisionNote: string, now: () => Date = () => new Date()) {
    validateMatrix(matrix);
    const game = this.getGame(gameId);
    if (!game) throw Object.assign(new Error("game not found"), { status: 404, code: "GAME_NOT_FOUND" });
    const current = this.listVersions(gameId).at(-1)!;
    if (current.matrix.length !== matrix.length || current.matrix[0].length !== matrix[0].length) {
      throw Object.assign(new Error("revision must preserve action dimensions"), { status: 400, code: "DIMENSION_MISMATCH" });
    }
    const nextVersion = current.version + 1;
    const timestamp = now().toISOString();
    this.insertVersion(gameId, nextVersion, matrix, revisionNote, timestamp);
    this.db.prepare("UPDATE games SET updated_at=? WHERE id=?").run(timestamp, gameId);
    return this.getVersionByNumber(gameId, nextVersion)!;
  }

  solve(matrixVersionId: string, params: SolveParams, now: () => Date = () => new Date()) {
    const version = this.getVersion(matrixVersionId);
    if (!version) throw Object.assign(new Error("matrix version not found"), { status: 404, code: "VERSION_NOT_FOUND" });
    if (params.requestId) {
      const prior = this.db.prepare("SELECT response_json FROM idempotency_keys WHERE request_id=?").get(params.requestId) as { response_json: string } | undefined;
      if (prior) return JSON.parse(prior.response_json);
    }
    const existing = params.requestId
      ? this.db.prepare("SELECT * FROM solves WHERE request_id=?").get(params.requestId) as { id: string } | undefined
      : undefined;
    if (existing) return this.getSolve(existing.id)!;

    const result = solveGame(version.matrix, params);
    const solveId = deterministicId("solve", { version: matrixVersionId, params, result });
    const timestamp = now().toISOString();
    const response = { id: solveId, matrixVersionId, params, result, createdAt: timestamp };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO solves(id,matrix_version_id,request_id,params_json,result_json,status,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(solveId, matrixVersionId, params.requestId ?? null, JSON.stringify(params), JSON.stringify(result), result.status, timestamp);
      const certificate = this.buildCertificate(solveId, version.matrixHash, result, timestamp);
      this.db.prepare("INSERT INTO certificates(id,solve_id,payload_json,signature,created_at) VALUES(?,?,?,?,?)")
        .run(certificate.certificateId, solveId, JSON.stringify(certificate), certificate.signature, timestamp);
      if (params.requestId) {
        this.db.prepare("INSERT INTO idempotency_keys(request_id,resource_type,resource_id,response_json,created_at) VALUES(?,?,?,?,?)")
          .run(params.requestId, "solve", solveId, JSON.stringify(response), timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return response;
  }

  exportCertificate(solveId: string): Certificate {
    const row = this.db.prepare("SELECT payload_json FROM certificates WHERE solve_id=?").get(solveId) as { payload_json: string } | undefined;
    if (!row) throw Object.assign(new Error("certificate not found"), { status: 404, code: "CERTIFICATE_NOT_FOUND" });
    return JSON.parse(row.payload_json);
  }

  verifyCertificate(certificate: Certificate) {
    const { signature, ...payload } = certificate;
    const expected = signPayload(payload);
    const validSignature = signature === expected;
    const version = this.getVersion(certificate.matrixVersionId);
    const validMatrix = Boolean(version && sha256(version.matrix) === certificate.matrixHash);
    return { valid: validSignature && validMatrix, validSignature, validMatrix, certificateId: certificate.certificateId };
  }

  listGames(limit: number, offset: number) {
    return (this.db.prepare("SELECT * FROM games ORDER BY created_at,id LIMIT ? OFFSET ?").all(limit, offset) as any[])
      .map((row) => ({ id: row.id, name: row.name, payoffUnit: row.payoff_unit, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  getGame(id: string) {
    const row = this.db.prepare("SELECT * FROM games WHERE id=?").get(id) as any;
    return row ? { id: row.id, name: row.name, payoffUnit: row.payoff_unit, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  listVersions(gameId: string) {
    const rows = this.db.prepare("SELECT * FROM matrix_versions WHERE game_id=? ORDER BY version").all(gameId) as any[];
    return rows.map((row) => ({ id: row.id, gameId, version: row.version, matrix: JSON.parse(row.matrix_json), matrixHash: row.matrix_hash, revisionNote: row.revision_note, createdAt: row.created_at }));
  }

  getVersion(id: string) {
    const row = this.db.prepare("SELECT * FROM matrix_versions WHERE id=?").get(id) as any;
    return row ? { id: row.id, gameId: row.game_id, version: row.version, matrix: JSON.parse(row.matrix_json), matrixHash: row.matrix_hash, revisionNote: row.revision_note, createdAt: row.created_at } : null;
  }

  getVersionByNumber(gameId: string, version: number) {
    return this.listVersions(gameId).find((item) => item.version === version) ?? null;
  }

  getActions(gameId: string) {
    const rows = this.db.prepare("SELECT role,action_index,label FROM actions WHERE game_id=? ORDER BY role,action_index").all(gameId) as any[];
    return {
      row: rows.filter((r) => r.role === "row").map((r) => r.label),
      column: rows.filter((r) => r.role === "column").map((r) => r.label)
    };
  }

  getSolve(id: string) {
    const row = this.db.prepare("SELECT * FROM solves WHERE id=?").get(id) as any;
    return row ? { id, matrixVersionId: row.matrix_version_id, params: JSON.parse(row.params_json), result: JSON.parse(row.result_json), createdAt: row.created_at } : null;
  }

  listSolves(limit: number, offset: number) {
    const rows = this.db.prepare("SELECT id FROM solves ORDER BY created_at,id LIMIT ? OFFSET ?").all(limit, offset) as { id: string }[];
    return rows.map((row) => this.getSolve(row.id)!);
  }

  close() { this.db.close(); }

  private buildCertificate(solveId: string, matrixHash: string, result: SolveResult, timestamp: string): Certificate {
    const matrixVersionId = this.getVersionBySolve(solveId);
    const payload = {
      certificateId: deterministicId("certificate", { solveId }),
      matrixVersionId,
      matrixHash,
      issuedAt: timestamp,
      algorithm: result.algorithm,
      tolerance: result.tolerance,
      budget: result.budget,
      stopReason: result.stopReason,
      status: result.status,
      result
    };
    return { ...payload, signature: signPayload(payload) };
  }

  private getVersionBySolve(solveId: string) {
    const row = this.db.prepare("SELECT matrix_version_id FROM solves WHERE id=?").get(solveId) as { matrix_version_id: string };
    return row.matrix_version_id;
  }

  private insertActions(gameId: string, rows: string[], columns: string[]) {
    const stmt = this.db.prepare("INSERT INTO actions(game_id,role,action_index,label) VALUES(?,?,?,?)");
    rows.forEach((label, index) => stmt.run(gameId, "row", index, label));
    columns.forEach((label, index) => stmt.run(gameId, "column", index, label));
  }

  private insertVersion(gameId: string, version: number, matrix: Matrix, note: string, timestamp: string) {
    const id = deterministicId("version", { gameId, version, matrix });
    this.db.prepare("INSERT INTO matrix_versions(id,game_id,version,matrix_json,matrix_hash,revision_note,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, gameId, version, JSON.stringify(matrix), sha256(matrix), note, timestamp);
    return id;
  }
}

function validateGameInput(input: GameInput) {
  validateMatrix(input.matrix);
  if (!input.name?.trim()) throw Object.assign(new Error("name required"), { status: 400, code: "INVALID_NAME" });
  if (!input.payoffUnit?.trim()) throw Object.assign(new Error("payoff unit required"), { status: 400, code: "INVALID_PAYOFF_UNIT" });
  if (input.rowActions.length !== input.matrix.length || input.columnActions.length !== input.matrix[0].length) {
    throw Object.assign(new Error("action labels must match matrix dimensions"), { status: 400, code: "INVALID_ACTIONS" });
  }
  if ([...input.rowActions, ...input.columnActions].some((label) => !label.trim())) {
    throw Object.assign(new Error("action labels required"), { status: 400, code: "INVALID_ACTIONS" });
  }
}

function deterministicId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

function signPayload(payload: unknown) {
  return sha256({ payload, secret: CERTIFICATE_SECRET });
}
