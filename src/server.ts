import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { Store } from "./db.js";
import { validateMatrix, validateStrategies } from "./solver.js";
import type { Matrix } from "./types.js";

export function createApiServer(store = new Store(process.env.GAME_DB_PATH ?? "data/game.sqlite")): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const route = `${request.method} ${url.pathname}`;
      const body = await readJson(request);

      if (route === "GET /health") return send(response, 200, { ok: true });
      if (route === "POST /games") {
        const created = store.createGame({
          name: requiredString(body.name, "name"),
          payoffUnit: requiredString(body.payoffUnit, "payoffUnit"),
          rowActions: requiredStringArray(body.rowActions, "rowActions", 1, 6),
          columnActions: requiredStringArray(body.columnActions, "columnActions", 1, 6),
          matrix: requiredMatrix(body.matrix)
        });
        return send(response, created.reused ? 200 : 201, created);
      }
      if (route === "GET /games") return send(response, 200, paginate(url, store.listGames.bind(store)));

      const gameMatch = url.pathname.match(/^\/games\/([^/]+)$/);
      if (gameMatch && request.method === "GET") {
        const game = store.getGame(gameMatch[1]);
        if (!game) return error(response, 404, "GAME_NOT_FOUND", "game not found");
        return send(response, 200, { ...game, actions: store.getActions(game.id), versions: store.listVersions(game.id) });
      }

      const versionsMatch = url.pathname.match(/^\/games\/([^/]+)\/versions$/);
      if (versionsMatch && request.method === "POST") {
        const version = store.reviseMatrix(
          versionsMatch[1],
          requiredMatrix(body.matrix),
          requiredString(body.revisionNote, "revisionNote")
        );
        return send(response, 201, version);
      }

      const solveMatch = url.pathname.match(/^\/matrix-versions\/([^/]+)\/solve$/);
      if (solveMatch && request.method === "POST") {
        const params = {
          tolerance: optionalPositiveNumber(body.tolerance, "tolerance", 1e-9),
          budget: optionalPositiveInteger(body.budget, "budget", 2000),
          reduceStrictDom: Boolean(body.reduceStrictDom ?? false),
          requestId: typeof body.requestId === "string" ? body.requestId : undefined
        };
        const solved = store.solve(solveMatch[1], params);
        const certificate = store.exportCertificate(solved.id);
        return send(response, 200, { ...solved, certificate });
      }

      if (route === "POST /validate") {
        const matrix = requiredMatrix(body.matrix);
        return send(response, 200, validateStrategies(matrix, body.rowStrategy, body.columnStrategy, optionalPositiveNumber(body.tolerance, "tolerance", 1e-9)));
      }

      if (route === "POST /certificates/verify") {
        if (!body.certificate || typeof body.certificate !== "object") return error(response, 400, "INVALID_CERTIFICATE", "certificate object required");
        return send(response, 200, store.verifyCertificate(body.certificate));
      }

      if (route === "GET /solves") return send(response, 200, paginate(url, store.listSolves.bind(store)));

      const solveMatchGet = url.pathname.match(/^\/solves\/([^/]+)$/);
      if (solveMatchGet && request.method === "GET") {
        const solved = store.getSolve(solveMatchGet[1]);
        if (!solved) return error(response, 404, "SOLVE_NOT_FOUND", "solve not found");
        return send(response, 200, { ...solved, certificate: store.exportCertificate(solved.id) });
      }

      return error(response, 404, "NOT_FOUND", "unknown API route");
    } catch (caught) {
      const err = caught as NodeJS.ErrnoException & { status?: number; code?: string };
      if (err.status) return error(response, err.status, err.code ?? "ERROR", err.message);
      console.error(err);
      return error(response, 500, "INTERNAL_ERROR", "internal error");
    }
  });
}

async function readJson(request: IncomingMessage): Promise<any> {
  if (request.method === "GET") return {};
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { status: 400, code: "INVALID_JSON" });
  }
}

function requiredMatrix(value: unknown): Matrix {
  validateMatrix(value);
  return value;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw Object.assign(new Error(`${field} required`), { status: 400, code: `INVALID_${field.toUpperCase()}` });
  return value;
}

function requiredStringArray(value: unknown, field: string, min: number, max: number) {
  if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((item) => typeof item === "string" && item.trim())) {
    throw Object.assign(new Error(`${field} must contain ${min}-${max} non-empty strings`), { status: 400, code: `INVALID_${field.toUpperCase()}` });
  }
  return value as string[];
}

function optionalPositiveNumber(value: unknown, field: string, fallback: number) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw Object.assign(new Error(`${field} must be positive`), { status: 400, code: `INVALID_${field.toUpperCase()}` });
  return number;
}

function optionalPositiveInteger(value: unknown, field: string, fallback: number) {
  const number = optionalPositiveNumber(value, field, fallback);
  if (!Number.isInteger(number)) throw Object.assign(new Error(`${field} must be an integer`), { status: 400, code: `INVALID_${field.toUpperCase()}` });
  return number;
}

function paginate(url: URL, list: (limit: number, offset: number) => unknown[]) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw Object.assign(new Error("pagination values invalid"), { status: 400, code: "INVALID_PAGINATION" });
  const items = list(limit, offset);
  return { items, limit, offset, nextOffset: items.length === limit ? offset + limit : null };
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

function error(response: ServerResponse, status: number, code: string, message: string) {
  send(response, status, { error: { code, message } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApiServer();
  server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    console.log(`API listening on http://127.0.0.1:${port}`);
  });
}
