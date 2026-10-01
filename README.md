# Zero-Sum Matrix Game Solver

Local Windows-compatible TypeScript/Node.js backend for two-player finite zero-sum matrix games up to 6×6. It provides a JSON API, CLI, deterministic fictitious/sample payoff matrices, SQLite persistence, signed result certificates, and automated tests. There is no web UI, network play, or third-party game solver.

## Algorithm

- Row player maximizes payoff; column player minimizes the same matrix.
- Mixed strategies are found by support-set vertex enumeration, including unequal rectangular support sizes and degenerate inactive constraints.
- Every action, including actions outside the chosen support, participates in best-response checks.
- Reports lower guarantee, upper guarantee, duality gap, both best-response sets, support, algorithm, public tolerance, and stop reason.
- Multiple equilibria are not represented as unique: the result is the lexicographically smallest deterministic representative and the certificate records that tie-breaking rule.
- Optional pure strict-dominance elimination records every domination witness and maps reduced actions back to original indices.
- Certificates include the exact matrix version, parameters, result, SHA-256 canonical fingerprint, and HMAC-SHA256 signature.

## Requirements

- Node.js 25 or newer with built-in `node:sqlite` and `node:test`.
- npm dependencies are TypeScript, TSX, and Node type definitions only.

## Install and Test

```powershell
npm install
npm test
npm run typecheck
```

## Start and Stop

```powershell
npm start
```

The HTTP server binds only to `127.0.0.1` and port `0` by default, so the OS assigns an unused local port. The startup line prints the actual URL and SQLite path. Stop it with `Ctrl+C`; it only manages the Node process started by this command.

Override only for local development if needed:

```powershell
$env:PORT="3721"
$env:ZSG_DB="data/dev.sqlite"
npm start
```

## Repeated Demo

```powershell
npm run demo
```

The demo always recreates `data/demo.sqlite`, uses fixed timestamps and an idempotency key, creates Matching Pennies, solves it, revises payoffs as a new version, and verifies an old strategy against the old matrix.

## CLI

```powershell
npx tsx src/cli/index.ts create '[[1,-1],[-1,1]]' --name matching
npx tsx src/cli/index.ts solve <matrix-id> --idempotency-key run-1
npx tsx src/cli/index.ts support <matrix-id>
npx tsx src/cli/index.ts verify <matrix-id> --row '[0.5,0.5]' --column '[0.5,0.5]'
npx tsx src/cli/index.ts revise <matrix-id> '[[3,-1],[-1,3]]' --reason revision
npx tsx src/cli/index.ts compare <matrix-id> 1 2
npx tsx src/cli/index.ts export-certificate <matrix-id> --out data/result.json
```

CLI commands print state before and after key mutations. All databases, exports, and temporary data remain under `data/` in this project.

## API

- `POST /api/matrices` — create a matrix with units, actions/labels, and values.
- `GET /api/matrices?limit=&offset=` — paginated matrix query.
- `GET /api/matrices/:id/versions/:version` — retrieve an immutable version.
- `POST /api/matrices/:id/revisions` — create a same-shape payoff revision.
- `POST /api/matrices/:id/solve` — solve with `idempotencyKey`, `version`, `tolerance`, and dominance options.
- `GET /api/matrices/:id/runs?limit=&offset=` — paginated result metadata.
- `POST /api/matrices/:id/verify` — validate an external probability pair and check every best response.
- `GET /api/matrices/:id/compare/:from/:to` — compare revision values and certificates.
- `POST /api/certificates/verify` — verify canonical fingerprint and HMAC signature.

Errors return JSON such as `{ "error": { "code": "INVALID_MATRIX_SIZE", "message": "..." } }`. Probabilities must be finite, non-negative, and sum to one.

## Persistence

Migrations use `CREATE TABLE IF NOT EXISTS`, so startup is repeatable. Solving is idempotent by a unique key; revisions add a new version without overwriting prior matrices, allowing old strategies to be checked against original payoffs. Mutations run inside SQLite transactions and roll back on failure.
