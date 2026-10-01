import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Repository } from '../repository.js';
import { ApiError, parsePagination, requireString, validateLabels, validateMatrix, validateMaxIterations, validateTolerance } from '../validation.js';
import { solveGame, verifyProfile } from '../solver/game.js';
import { verifyCertificate } from '../certificates.js';

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new ApiError('PAYLOAD_TOO_LARGE', 413, 'request body is too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new ApiError('INVALID_JSON', 400, 'request body must be valid JSON')); }
    });
  });
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

export function createApi(repository: Repository, clock: () => string): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (method === 'GET' && path === '/health') return send(res, 200, { ok: true });

      if (method === 'POST' && path === '/api/matrices') {
        const body = await readJson(req);
        const values = validateMatrix(body.values);
        const payload = {
          name: requireString(body.name, 'name'),
          payoffUnit: requireString(body.payoffUnit ?? 'payoff unit', 'payoffUnit'),
          values,
          rowLabels: validateLabels(body.rowLabels, values.length, 'row'),
          columnLabels: validateLabels(body.columnLabels, values[0].length, 'column'),
          now: clock(),
        };
        return send(res, 201, repository.createMatrix(payload));
      }
      if (method === 'GET' && path === '/api/matrices') {
        const page = parsePagination(url);
        return send(res, 200, { items: repository.listMatrices(page.limit, page.offset), ...page });
      }
      const matrixMatch = path.match(/^\/api\/matrices\/([^/]+)(?:\/versions\/(\d+))?\/?$/);
      if (method === 'GET' && matrixMatch) {
        const matrix = repository.getMatrix(decodeURIComponent(matrixMatch[1]), matrixMatch[2] ? Number(matrixMatch[2]) : undefined);
        if (!matrix) throw new ApiError('MATRIX_NOT_FOUND', 404, 'matrix not found');
        return send(res, 200, { ...matrix, actions: repository.getActions(matrix.id, matrix.version) });
      }
      if (method === 'POST' && path.match(/^\/api\/matrices\/[^/]+\/revisions$/)) {
        const matrixId = decodeURIComponent(path.split('/')[3]);
        const body = await readJson(req);
        const values = validateMatrix(body.values);
        return send(res, 201, repository.reviseMatrix(matrixId, {
          name: requireString(body.name, 'name'),
          payoffUnit: requireString(body.payoffUnit ?? 'payoff unit', 'payoffUnit'),
          values,
          rowLabels: validateLabels(body.rowLabels, values.length, 'row'),
          columnLabels: validateLabels(body.columnLabels, values[0].length, 'column'),
          reason: requireString(body.reason, 'reason', 500),
          now: clock(),
        }));
      }
      if (method === 'POST' && path.match(/^\/api\/matrices\/[^/]+\/solve$/)) {
        const matrixId = decodeURIComponent(path.split('/')[3]);
        const body = await readJson(req);
        const key = requireString(body.idempotencyKey, 'idempotencyKey', 200);
        const version = body.version === undefined ? undefined : Number(body.version);
        return send(res, 201, repository.solve(matrixId, version, {
          tolerance: validateTolerance(body.tolerance),
          maxIterations: validateMaxIterations(body.maxIterations),
          eliminateStrictlyDominated: !!body.eliminateStrictlyDominated,
        }, key, clock()));
      }
      if (method === 'GET' && path.match(/^\/api\/matrices\/[^/]+\/runs$/)) {
        const matrixId = decodeURIComponent(path.split('/')[3]);
        const page = parsePagination(url);
        return send(res, 200, { items: repository.listRuns(matrixId, page.limit, page.offset), ...page });
      }
      if (method === 'POST' && path.match(/^\/api\/matrices\/[^/]+\/verify$/)) {
        const matrixId = decodeURIComponent(path.split('/')[3]);
        const body = await readJson(req);
        const version = Number(body.version ?? 1);
        const result = repository.verifyExternal(matrixId, version, body.rowStrategy, body.columnStrategy, validateTolerance(body.tolerance));
        return send(res, result.validProbabilities ? 200 : 422, result);
      }
      const compare = path.match(/^\/api\/matrices\/([^/]+)\/compare\/(\d+)\/(\d+)$/);
      if (method === 'GET' && compare) {
        const id = decodeURIComponent(compare[1]);
        const from = repository.getMatrix(id, Number(compare[2]));
        const to = repository.getMatrix(id, Number(compare[3]));
        if (!from || !to) throw new ApiError('VERSION_NOT_FOUND', 404, 'matrix version not found');
        const options = { tolerance: validateTolerance(url.searchParams.get('tolerance')) };
        const before = solveGame(from.values, repository.getActions(id, from.version), options);
        const after = solveGame(to.values, repository.getActions(id, to.version), options);
        return send(res, 200, { fromVersion: from.version, toVersion: to.version, valueBefore: before.value, valueAfter: after.value, valueDelta: after.value - before.value, before, after });
      }
      if (method === 'POST' && path === '/api/certificates/verify') {
        const body = await readJson(req);
        const valid = verifyCertificate(body.payload, requireString(body.fingerprint, 'fingerprint', 500), requireString(body.signature, 'signature', 500));
        return send(res, valid ? 200 : 409, { valid });
      }
      throw new ApiError('NOT_FOUND', 404, 'route not found');
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      return send(res, 500, { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'internal error' } });
    }
  });
}

export function listenLocal(server: Server, preferredPort = 0): Promise<number> {
  return new Promise((resolve) => server.listen(preferredPort, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}
