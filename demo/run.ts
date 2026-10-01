import { rmSync } from 'node:fs';
import { openDatabase } from '../src/db/client.js';
import { Repository } from '../src/repository.js';
import { verifyProfile } from '../src/solver/game.js';

const dbPath = 'data/demo.sqlite';
rmSync(dbPath, { force: true });
const repository = new Repository(openDatabase(dbPath));
const matrix = repository.createMatrix({
  name: 'deterministic-demo',
  payoffUnit: 'utility',
  values: [[1, -1], [-1, 1]],
  rowLabels: ['heads', 'tails'],
  columnLabels: ['heads', 'tails'],
  now: '2026-01-01T00:00:00.000Z',
});
console.log('created', matrix.id, 'version', matrix.current_version);
const solved = repository.solve(matrix.id, 1, { tolerance: 1e-8 }, 'demo-matching-pennies', '2026-01-01T00:00:01.000Z');
console.log('value', solved.solution.value, 'equilibrium', solved.solution.equilibrium, 'fingerprint', solved.fingerprint ?? 'embedded');
console.log('support', solved.solution.rowSupport, solved.solution.columnSupport);
const revised = repository.reviseMatrix(matrix.id, {
  name: 'deterministic-demo',
  payoffUnit: 'utility',
  values: [[3, 1], [1, 3]],
  rowLabels: ['heads', 'tails'],
  columnLabels: ['heads', 'tails'],
  reason: 'deterministic demo revision',
  now: '2026-01-01T00:00:02.000Z',
});
const old = verifyProfile(matrix.values, { rowStrategy: [0.5, 0.5], columnStrategy: [0.5, 0.5] }, 1e-8);
console.log('revised version', revised.current_version, 'old strategy still verifies', old.equilibrium);
console.log('database', dbPath);
