import { PGlite } from '@electric-sql/pglite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'pgdata');

let db;

export async function getDb() {
  if (db) return db;

  db = new PGlite(DATA_DIR);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ping_results (
      id SERIAL PRIMARY KEY,
      computer_name TEXT NOT NULL,
      domain TEXT,
      destination_ip TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      latency_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Success',
      source_file TEXT,
      UNIQUE (computer_name, destination_ip, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_ping_ts ON ping_results(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ping_dest ON ping_results(destination_ip);
    CREATE INDEX IF NOT EXISTS idx_ping_host ON ping_results(computer_name);
    CREATE INDEX IF NOT EXISTS idx_ping_source ON ping_results(source_file);
  `);

  return db;
}
