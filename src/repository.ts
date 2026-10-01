import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { withTransaction } from './db/client.js';
import { issueCertificate } from './certificates.js';
import { ApiError } from './validation.js';
import { solveGame, verifyProfile, type GameSolution, type SolveOptions } from './solver/game.js';

export interface CreateMatrixInput {
  name: string;
  payoffUnit: string;
  values: number[][];
  rowLabels?: string[];
  columnLabels?: string[];
  now: string;
}

export interface RevisionInput extends CreateMatrixInput {
  reason: string;
}

export class Repository {
  constructor(private readonly db: DatabaseSync) {}

  createMatrix(input: CreateMatrixInput) {
    const id = randomUUID();
    return withTransaction(this.db, () => {
      try {
        this.db.prepare(`INSERT INTO matrices(id,name,payoff_unit,rows_count,columns_count,current_version,created_at,updated_at)
          VALUES(?,?,?,?,?,1,?,?)`).run(id, input.name, input.payoffUnit, input.values.length, input.values[0].length, input.now, input.now);
      } catch (error) {
        throw new ApiError('NAME_CONFLICT', 409, 'matrix name already exists');
      }
      this.insertVersion(id, 1, input);
      return this.getMatrix(id, 1)!;
    });
  }

  reviseMatrix(matrixId: string, input: RevisionInput) {
    const current = this.getMatrix(matrixId);
    if (!current) throw new ApiError('MATRIX_NOT_FOUND', 404, 'matrix not found');
    if (current.rows_count !== input.values.length || current.columns_count !== input.values[0].length) {
      throw new ApiError('SHAPE_CHANGED', 400, 'revisions must preserve matrix dimensions');
    }
    const version = current.current_version + 1;
    return withTransaction(this.db, () => {
      this.db.prepare('UPDATE matrices SET name=?, payoff_unit=?, current_version=?, updated_at=? WHERE id=?')
        .run(input.name, input.payoffUnit, version, input.now, matrixId);
      this.insertVersion(matrixId, version, input, input.reason);
      return this.getMatrix(matrixId, version)!;
    });
  }

  private insertVersion(matrixId: string, version: number, input: CreateMatrixInput, reason?: string) {
    this.db.prepare('INSERT INTO matrix_versions(matrix_id,version,values_json,revision_reason,created_at) VALUES(?,?,?,?,?)')
      .run(matrixId, version, JSON.stringify(input.values), reason ?? null, input.now);
    const actionSql = this.db.prepare('INSERT INTO actions(matrix_id,version,player,position,label) VALUES(?,?,?,?,?)');
    input.rowLabels!.forEach((label, i) => actionSql.run(matrixId, version, 'row', i, label));
    input.columnLabels!.forEach((label, i) => actionSql.run(matrixId, version, 'column', i, label));
  }

  getMatrix(id: string, version?: number) {
    const matrix = this.db.prepare('SELECT * FROM matrices WHERE id=?').get(id) as any;
    if (!matrix) return undefined;
    const selectedVersion = version ?? matrix.current_version;
    const revision = this.db.prepare('SELECT * FROM matrix_versions WHERE matrix_id=? AND version=?').get(id, selectedVersion) as any;
    if (!revision) throw new ApiError('VERSION_NOT_FOUND', 404, 'matrix version not found');
    if (version !== undefined && (version < 1 || version > matrix.current_version)) throw new ApiError('VERSION_NOT_FOUND', 404, 'matrix version not found');
    return { ...matrix, version: selectedVersion, values: JSON.parse(revision.values_json), revisionReason: revision.revision_reason, createdAt: revision.created_at };
  }

  listMatrices(limit: number, offset: number) {
    return (this.db.prepare('SELECT id,name,payoff_unit,rows_count,columns_count,current_version,updated_at FROM matrices ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(limit, offset) as any[]);
  }

  getActions(matrixId: string, version: number) {
    return {
      row: (this.db.prepare("SELECT position,label FROM actions WHERE matrix_id=? AND version=? AND player='row' ORDER BY position").all(matrixId, version) as any[]).map((x) => x.label),
      column: (this.db.prepare("SELECT position,label FROM actions WHERE matrix_id=? AND version=? AND player='column' ORDER BY position").all(matrixId, version) as any[]).map((x) => x.label),
    };
  }

  solve(matrixId: string, requestedVersion: number | undefined, options: SolveOptions, idempotencyKey: string, now: string) {
    const existing = this.db.prepare('SELECT * FROM solve_runs WHERE idempotency_key=?').get(idempotencyKey) as any;
    if (existing) {
      return {
        ...JSON.parse(existing.certificate_json),
        fingerprint: existing.fingerprint,
        signature: existing.signature,
        runId: existing.id,
      };
    }
    const matrix = this.getMatrix(matrixId, requestedVersion);
    if (!matrix) throw new ApiError('MATRIX_NOT_FOUND', 404, 'matrix not found');
    const labels = this.getActions(matrixId, matrix.version);
    const solution = solveGame(matrix.values, labels, options);
    const payload = {
      matrixId,
      version: matrix.version,
      values: matrix.values,
      labels,
      payoffUnit: matrix.payoff_unit,
      parameters: { tolerance: options.tolerance, eliminateStrictlyDominated: !!options.eliminateStrictlyDominated },
      solution,
      issuedAt: now,
    };
    const cert = issueCertificate(payload);
    const id = randomUUID();
    withTransaction(this.db, () => {
      this.db.prepare(`INSERT INTO solve_runs(id,idempotency_key,matrix_id,version,parameters_json,status,stop_reason,certificate_json,fingerprint,signature,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, idempotencyKey, matrixId, matrix.version, JSON.stringify(payload.parameters),
        solution.equilibrium ? 'equilibrium' : solution.stopReason === 'optimal' ? 'unverified' : 'failed',
        solution.stopReason, JSON.stringify(payload), cert.fingerprint, cert.signature, now,
      );
    });
    return { ...payload, fingerprint: cert.fingerprint, signature: cert.signature, runId: id };
  }

  listRuns(matrixId: string, limit: number, offset: number) {
    return (this.db.prepare('SELECT id,matrix_id,version,status,stop_reason,fingerprint,created_at FROM solve_runs WHERE matrix_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(matrixId, limit, offset) as any[]);
  }

  verifyExternal(matrixId: string, version: number, rowStrategy: number[], columnStrategy: number[], tolerance: number) {
    const matrix = this.getMatrix(matrixId, version);
    if (!matrix) throw new ApiError('MATRIX_NOT_FOUND', 404, 'matrix not found');
    return verifyProfile(matrix.values, { rowStrategy, columnStrategy }, tolerance);
  }
}
