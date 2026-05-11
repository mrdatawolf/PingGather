import Papa from 'papaparse';
import { getDb } from './db.js';

const BATCH_SIZE = 1000;

/**
 * Parse CSV with papaparse, then bulk-upsert into PGLite.
 * Uses single transaction + dropped indexes for max throughput.
 */
const tick = () => new Promise(resolve => setImmediate(resolve));

export async function importCsv(buffer, sourceFileName, onProgress = () => {}) {
  const content = buffer.toString('utf-8');

  // ── Phase 1: Parse CSV ──
  onProgress({ step: 'parsing', detail: 'Parsing CSV...' });
  await tick();

  const startParse = Date.now();
  const { data: records } = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });

  // Map rows to insert-ready arrays
  const allRows = [];
  let skipped = 0;

  for (const row of records) {
    const computerName = row.ComputerName || row.computer_name || '';
    const domain = row.Domain || row.domain || '';
    const destIp = row.LocationIP || row.location_ip || row.DestinationIP || '';
    const dateTime = row.DateTime || row.datetime || row.timestamp || '';
    const latency = parseInt(row.Latency || row.latency || row.latency_ms || '0', 10);
    const status = row.Status || row.status || (latency >= 1001 ? 'Timeout' : 'Success');

    if (!destIp || !dateTime) {
      skipped++;
      continue;
    }

    allRows.push([computerName, domain, destIp, dateTime, isNaN(latency) ? 0 : latency, status, sourceFileName]);
  }

  const total = allRows.length;
  const parseMs = Date.now() - startParse;
  onProgress({
    step: 'parsing',
    detail: `Parsed ${total.toLocaleString()} rows in ${(parseMs / 1000).toFixed(1)}s (${skipped} skipped).`,
    total: total + skipped,
  });
  await tick();

  // ── Phase 2: Optimized bulk insert ──
  const db = await getDb();

  onProgress({ step: 'inserting', detail: 'Preparing database for bulk insert...', total, percent: 0 });
  await tick();

  // Drop indexes for speed (recreated after)
  await db.exec('DROP INDEX IF EXISTS idx_ping_ts');
  await db.exec('DROP INDEX IF EXISTS idx_ping_dest');
  await db.exec('DROP INDEX IF EXISTS idx_ping_host');
  await db.exec('DROP INDEX IF EXISTS idx_ping_source');

  await db.exec('BEGIN');

  const UPSERT_CONFLICT = `
    ON CONFLICT (computer_name, destination_ip, timestamp)
    DO UPDATE SET domain = EXCLUDED.domain,
                  latency_ms = EXCLUDED.latency_ms,
                  status = EXCLUDED.status,
                  source_file = EXCLUDED.source_file`;

  let inserted = 0;
  const errors = [];

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      values.push(...row);
    }

    await db.exec(`SAVEPOINT batch_${i}`);
    try {
      await db.query(
        `INSERT INTO ping_results (computer_name, domain, destination_ip, timestamp, latency_ms, status, source_file)
         VALUES ${placeholders.join(', ')} ${UPSERT_CONFLICT}`,
        values
      );
      await db.exec(`RELEASE SAVEPOINT batch_${i}`);
      inserted += batch.length;
    } catch (batchErr) {
      await db.exec(`ROLLBACK TO SAVEPOINT batch_${i}`);
      await db.exec(`RELEASE SAVEPOINT batch_${i}`);

      for (const row of batch) {
        await db.exec('SAVEPOINT row_insert');
        try {
          await db.query(
            `INSERT INTO ping_results (computer_name, domain, destination_ip, timestamp, latency_ms, status, source_file)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ${UPSERT_CONFLICT}`,
            row
          );
          await db.exec('RELEASE SAVEPOINT row_insert');
          inserted++;
        } catch (rowErr) {
          await db.exec('ROLLBACK TO SAVEPOINT row_insert');
          await db.exec('RELEASE SAVEPOINT row_insert');
          errors.push({ error: rowErr.message });
          skipped++;
        }
      }
    }

    const pct = Math.round(((i + batch.length) / allRows.length) * 100);
    onProgress({
      step: 'inserting',
      detail: `Upserting rows... ${inserted.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`,
      inserted,
      skipped,
      total,
      percent: pct,
    });
    await tick();
  }

  await db.exec('COMMIT');

  // ── Phase 3: Recreate indexes ──
  onProgress({ step: 'indexing', detail: 'Rebuilding indexes...', inserted, skipped, total, percent: 99 });
  await tick();

  await db.exec('CREATE INDEX IF NOT EXISTS idx_ping_ts ON ping_results(timestamp)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_ping_dest ON ping_results(destination_ip)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_ping_host ON ping_results(computer_name)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_ping_source ON ping_results(source_file)');

  onProgress({ step: 'done', detail: 'Import complete.', inserted, skipped, total, percent: 100 });
  return { inserted, skipped, errors: errors.slice(0, 10) };
}
