import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matrices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      payoff_unit TEXT NOT NULL,
      rows_count INTEGER NOT NULL CHECK(rows_count BETWEEN 1 AND 6),
      columns_count INTEGER NOT NULL CHECK(columns_count BETWEEN 1 AND 6),
      current_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matrix_versions (
      matrix_id TEXT NOT NULL REFERENCES matrices(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      values_json TEXT NOT NULL,
      revision_reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(matrix_id, version)
    );
    CREATE TABLE IF NOT EXISTS actions (
      matrix_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      player TEXT NOT NULL CHECK(player IN ('row','column')),
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 5),
      label TEXT NOT NULL,
      PRIMARY KEY(matrix_id, version, player, position),
      FOREIGN KEY(matrix_id, version) REFERENCES matrix_versions(matrix_id, version) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS solve_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      matrix_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parameters_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('equilibrium','unverified','failed')),
      stop_reason TEXT NOT NULL,
      certificate_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(matrix_id, version) REFERENCES matrix_versions(matrix_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_solve_runs_matrix ON solve_runs(matrix_id, version, created_at);
  `);
}

export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
