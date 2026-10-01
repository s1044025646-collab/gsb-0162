#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { openDatabase } from '../db/client.js';
import { Repository } from '../repository.js';
import { solveGame } from '../solver/game.js';

const args = process.argv.slice(2);
const command = args.shift();
const repo = new Repository(openDatabase(process.env.ZSG_DB ?? 'data/zsg.sqlite'));

function json(value: unknown): string { return JSON.stringify(value, null, 2); }
function matrixFromArg(value: string): number[][] {
  const matrix = JSON.parse(value);
  if (!Array.isArray(matrix) || matrix.some((row) => !Array.isArray(row) || row.some((v) => typeof v !== 'number'))) throw new Error('matrix must be a JSON number matrix');
  return matrix;
}
function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  if (command === 'create') {
    const values = matrixFromArg(args[0]);
    const name = flag('--name') ?? 'matrix';
    const before = repo.listMatrices(1, 0);
    console.log(`before: ${before.length} visible matrix/matrices`);
    const result = repo.createMatrix({ name, payoffUnit: flag('--unit') ?? 'utility', values, now: new Date().toISOString() });
    console.log(json(result));
    console.log(`after: matrix ${result.id} version ${result.current_version}`);
  } else if (command === 'show') {
    console.log(json(repo.getMatrix(args[0], args[1] ? Number(args[1]) : undefined)));
  } else if (command === 'revise') {
    const id = args[0];
    const before = repo.getMatrix(id)!;
    const values = matrixFromArg(args[1]);
    console.log(`before: version ${before.current_version}, value count ${before.values.flat().length}`);
    const result = repo.reviseMatrix(id, { ...before, values, rowLabels: repo.getActions(id, before.version).row, columnLabels: repo.getActions(id, before.version).column, reason: flag('--reason') ?? 'manual revision', now: new Date().toISOString() });
    console.log(json(result));
    console.log(`after: version ${result.current_version}`);
  } else if (command === 'solve') {
    const id = args[0];
    const before = repo.getMatrix(id)!;
    console.log(`before: latest version ${before.current_version}`);
    const result = repo.solve(id, Number(flag('--version') ?? before.current_version), { tolerance: Number(flag('--tolerance') ?? 1e-8), eliminateStrictlyDominated: args.includes('--eliminate-dominated') }, flag('--idempotency-key') ?? cryptoRandom(), new Date().toISOString());
    const s = result.solution;
    console.log(json(result));
    console.log(`after: status ${s.equilibrium ? 'EQUILIBRIUM' : 'UNVERIFIED'}, value ${s.value}, gap ${s.dualityGap}`);
  } else if (command === 'support') {
    const matrix = repo.getMatrix(args[0], Number(flag('--version') ?? undefined));
    const solution = solveGame(matrix!.values, repo.getActions(matrix!.id, matrix!.version), { tolerance: 1e-8 });
    console.log(json({ rowSupport: solution.rowSupport, columnSupport: solution.columnSupport, rowStrategy: solution.rowStrategy, columnStrategy: solution.columnStrategy }));
  } else if (command === 'verify') {
    const id = args[0];
    const version = Number(flag('--version') ?? 1);
    const result = repo.verifyExternal(id, version, JSON.parse(flag('--row') ?? '[]'), JSON.parse(flag('--column') ?? '[]'), Number(flag('--tolerance') ?? 1e-8));
    console.log(json(result));
    process.exitCode = result.equilibrium ? 0 : 2;
  } else if (command === 'compare') {
    const id = args[0], from = Number(args[1]), to = Number(args[2]);
    const a = repo.getMatrix(id, from)!, b = repo.getMatrix(id, to)!;
    const sa = solveGame(a.values, repo.getActions(id, from), { tolerance: 1e-8 });
    const sb = solveGame(b.values, repo.getActions(id, to), { tolerance: 1e-8 });
    console.log(json({ valueBefore: sa.value, valueAfter: sb.value, delta: sb.value - sa.value }));
  } else if (command === 'export-certificate') {
    const result = repo.solve(args[0], Number(flag('--version') ?? undefined), { tolerance: Number(flag('--tolerance') ?? 1e-8) }, flag('--idempotency-key') ?? cryptoRandom(), new Date().toISOString());
    const output = flag('--out') ?? 'data/certificate.json';
    writeFileSync(output, json(result));
    console.log(`certificate exported to ${output}`);
  } else {
    console.log('Commands: create <matrix-json> --name, show <id>, revise <id> <json>, solve <id>, support <id>, verify <id>, compare <id> <from> <to>, export-certificate <id>');
  }
}

function cryptoRandom(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
main().catch((error) => { console.error(error.message); process.exit(1); });
