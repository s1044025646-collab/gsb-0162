import { openDatabase } from './db/client.js';
import { Repository } from './repository.js';
import { createApi, listenLocal } from './api/server.js';

const dbPath = process.env.ZSG_DB ?? 'data/zsg.sqlite';
const db = openDatabase(dbPath);
const server = createApi(new Repository(db), () => new Date().toISOString());
const port = Number(process.env.PORT ?? 0);
listenLocal(server, port).then((actualPort) => {
  console.log(`zero-sum game API listening on http://127.0.0.1:${actualPort}`);
  console.log(`database: ${dbPath}`);
});
