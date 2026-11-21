import fs from 'node:fs';
import { loadConfig } from '../config/env.js';

// Deletes the SQLite file and its WAL/SHM sidecars. The schema is recreated on next startup.
// Run with: npm run db:reset (stop the server first).
const { DB_PATH } = loadConfig();

if (DB_PATH === ':memory:') {
  console.log('[db:reset] DB_PATH is :memory:, nothing to delete.');
} else {
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    fs.rmSync(file, { force: true });
  }
  console.log(`[db:reset] removed ${DB_PATH} (schema is recreated on next start).`);
}
