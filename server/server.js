import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { rename, mkdir } from 'fs/promises';
import { getDb } from './db.js';
import { importCsv } from './import.js';
import { startWatcher, getWatcherStatus, processInbox } from './watcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const PORT = process.env.PORT || 6130;

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// Upload CSV with SSE progress streaming
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Set up Server-Sent Events with immediate flushing
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.socket.setNoDelay(true);
    res.flushHeaders();

    const sendProgress = (data) => {
      const ok = res.write(`data: ${JSON.stringify(data)}\n\n`);
      // If write buffer is full, wait for drain before continuing
      if (!ok) {
        return new Promise(resolve => res.once('drain', resolve));
      }
    };

    const result = await importCsv(req.file.buffer, req.file.originalname, sendProgress);
    sendProgress({ step: 'complete', ...result });
    res.end();
  } catch (err) {
    // If headers already sent as SSE, send error as event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ step: 'error', detail: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Delete data for a source file (allows re-import)
app.delete('/api/source/:filename', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('DELETE FROM ping_results WHERE source_file = $1', [req.params.filename]);
    res.json({ deleted: result.affectedRows || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List imported source files
app.get('/api/sources', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT source_file, COUNT(*)::int AS row_count, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts
       FROM ping_results GROUP BY source_file ORDER BY last_ts DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query ping data with filters
app.get('/api/ping-data', async (req, res) => {
  try {
    const db = await getDb();
    const { host, domain, destination, start, end, limit = '5000', offset = '0' } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (host) { where.push(`computer_name = $${idx++}`); params.push(host); }
    if (domain) { where.push(`domain = $${idx++}`); params.push(domain); }
    if (destination) { where.push(`destination_ip = $${idx++}`); params.push(destination); }
    if (start) { where.push(`timestamp >= $${idx++}`); params.push(start); }
    if (end) { where.push(`timestamp <= $${idx++}`); params.push(end); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = `SELECT computer_name, domain, destination_ip, timestamp, latency_ms, status
                 FROM ping_results ${whereClause}
                 ORDER BY timestamp DESC
                 LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Summary statistics
app.get('/api/summary', async (req, res) => {
  try {
    const db = await getDb();
    const { host, domain, destination, start, end } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (host) { where.push(`computer_name = $${idx++}`); params.push(host); }
    if (domain) { where.push(`domain = $${idx++}`); params.push(domain); }
    if (destination) { where.push(`destination_ip = $${idx++}`); params.push(destination); }
    if (start) { where.push(`timestamp >= $${idx++}`); params.push(start); }
    if (end) { where.push(`timestamp <= $${idx++}`); params.push(end); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await db.query(`
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(DISTINCT DATE_TRUNC('day', timestamp))::int AS distinct_days,
        COUNT(DISTINCT destination_ip)::int AS distinct_destinations,
        COUNT(DISTINCT computer_name)::int AS distinct_hosts,
        ROUND(AVG(CASE WHEN status = 'Success' THEN latency_ms END))::int AS avg_latency,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'Success') AS median_latency,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'Success') AS p95_latency,
        COUNT(*) FILTER (WHERE status = 'Timeout')::int AS timeout_count
      FROM ping_results ${whereClause}
    `, params);

    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Time-series data for charts (aggregated by interval)
app.get('/api/timeseries', async (req, res) => {
  try {
    const db = await getDb();
    const { host, domain, destination, start, end, interval = '5 minutes' } = req.query;

    // Validate interval to prevent injection
    const validIntervals = ['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour', '6 hours', '1 day'];
    const safeInterval = validIntervals.includes(interval) ? interval : '5 minutes';

    let where = [];
    let params = [];
    let idx = 1;

    if (host) { where.push(`computer_name = $${idx++}`); params.push(host); }
    if (domain) { where.push(`domain = $${idx++}`); params.push(domain); }
    if (destination) { where.push(`destination_ip = $${idx++}`); params.push(destination); }
    if (start) { where.push(`timestamp >= $${idx++}`); params.push(start); }
    if (end) { where.push(`timestamp <= $${idx++}`); params.push(end); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await db.query(`
      SELECT
        DATE_TRUNC('minute', timestamp) AS bucket,
        destination_ip,
        ROUND(AVG(CASE WHEN status = 'Success' THEN latency_ms END))::int AS avg_latency,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'Success') AS median_latency,
        MAX(CASE WHEN status = 'Success' THEN latency_ms END) AS max_latency,
        COUNT(*) FILTER (WHERE status = 'Timeout')::int AS timeouts,
        COUNT(*)::int AS total
      FROM ping_results ${whereClause}
      GROUP BY bucket, destination_ip
      ORDER BY bucket ASC, destination_ip
    `, params);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct destinations
app.get('/api/destinations', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT DISTINCT destination_ip FROM ping_results ORDER BY destination_ip');
    res.json(result.rows.map(r => r.destination_ip));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct hosts
app.get('/api/hosts', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT DISTINCT computer_name FROM ping_results ORDER BY computer_name');
    res.json(result.rows.map(r => r.computer_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct domains
app.get('/api/domains', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT DISTINCT domain FROM ping_results WHERE domain IS NOT NULL ORDER BY domain');
    res.json(result.rows.map(r => r.domain));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    const db = await getDb();
    const { host, domain, destination, start, end } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (host) { where.push(`computer_name = $${idx++}`); params.push(host); }
    if (domain) { where.push(`domain = $${idx++}`); params.push(domain); }
    if (destination) { where.push(`destination_ip = $${idx++}`); params.push(destination); }
    if (start) { where.push(`timestamp >= $${idx++}`); params.push(start); }
    if (end) { where.push(`timestamp <= $${idx++}`); params.push(end); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT computer_name, domain, destination_ip, timestamp, latency_ms, status
       FROM ping_results ${whereClause} ORDER BY timestamp`, params
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ping_export.csv"');

    const header = 'ComputerName,Domain,LocationIP,DateTime,Latency,Status\n';
    const rows = result.rows.map(r =>
      `"${r.computer_name}","${r.domain}","${r.destination_ip}","${r.timestamp}",${r.latency_ms},"${r.status}"`
    ).join('\n');

    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as JSON
app.get('/api/export/json', async (req, res) => {
  try {
    const db = await getDb();
    const { host, domain, destination, start, end } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (host) { where.push(`computer_name = $${idx++}`); params.push(host); }
    if (domain) { where.push(`domain = $${idx++}`); params.push(domain); }
    if (destination) { where.push(`destination_ip = $${idx++}`); params.push(destination); }
    if (start) { where.push(`timestamp >= $${idx++}`); params.push(start); }
    if (end) { where.push(`timestamp <= $${idx++}`); params.push(end); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT computer_name, domain, destination_ip, timestamp, latency_ms, status
       FROM ping_results ${whereClause} ORDER BY timestamp`, params
    );

    res.setHeader('Content-Disposition', 'attachment; filename="ping_export.json"');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Watcher status (polled by frontend)
app.get('/api/watcher/status', (_req, res) => {
  res.json(getWatcherStatus());
});

// Manually trigger inbox processing
app.post('/api/watcher/process', (_req, res) => {
  const status = getWatcherStatus();
  if (status.active) {
    return res.status(409).json({ error: 'Already processing.' });
  }
  processInbox();
  res.json({ ok: true });
});

// ── Collector (run ping_gather.ps1 from the web UI) ──

const HOLDING = join(__dirname, 'holding');
const INBOX = join(__dirname, 'inbox');
const SCRIPT = join(__dirname, '..', 'ping_gather.ps1');

let collector = {
  proc: null,
  running: false,
  startedAt: null,
  destinationIPs: [],
  intervalSeconds: 5,
  durationMinutes: 0,
  outputFile: '',
};

function moveToInbox() {
  if (!collector.outputFile) return;
  const dest = join(INBOX, basename(collector.outputFile));
  rename(collector.outputFile, dest)
    .then(() => console.log(`[collector] Moved ${basename(collector.outputFile)} to inbox`))
    .catch(err => console.error('[collector] Move failed:', err.message));
}

app.post('/api/collector/start', (req, res) => {
  if (collector.running) {
    return res.status(409).json({ error: 'Collector is already running.' });
  }

  const { ips, intervalSeconds = 5, durationMinutes = 0 } = req.body;
  if (!ips || !ips.length) {
    return res.status(400).json({ error: 'At least one IP is required.' });
  }

  const dateStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  const outputFile = join(HOLDING, `result_${dateStamp}_${rand}.csv`);

  const args = [
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    '-DestinationIPs', ips.join(','),
    '-ResultFilePath', outputFile,
    '-IntervalSeconds', String(intervalSeconds),
  ];
  if (durationMinutes > 0) {
    args.push('-DurationMinutes', String(durationMinutes));
  }

  const proc = spawn('powershell.exe', args, { stdio: 'ignore' });

  collector = {
    proc,
    running: true,
    startedAt: new Date().toISOString(),
    destinationIPs: ips,
    intervalSeconds,
    durationMinutes,
    outputFile,
  };

  proc.on('exit', () => {
    collector.running = false;
    collector.proc = null;
    moveToInbox();
  });

  proc.on('error', (err) => {
    console.error('[collector] Process error:', err.message);
    collector.running = false;
    collector.proc = null;
  });

  console.log(`[collector] Started: ${ips.join(', ')} → ${basename(outputFile)}`);
  res.json({ ok: true, outputFile: basename(outputFile) });
});

app.post('/api/collector/stop', (_req, res) => {
  if (!collector.running || !collector.proc) {
    return res.status(400).json({ error: 'Collector is not running.' });
  }
  collector.proc.kill();
  res.json({ ok: true });
});

app.get('/api/collector/status', (_req, res) => {
  res.json({
    running: collector.running,
    startedAt: collector.startedAt,
    destinationIPs: collector.destinationIPs,
    intervalSeconds: collector.intervalSeconds,
    durationMinutes: collector.durationMinutes,
    outputFile: collector.outputFile ? basename(collector.outputFile) : '',
  });
});

// Initialize DB and start server
const db = await getDb();
console.log('Database initialized.');

await mkdir(HOLDING, { recursive: true });

app.listen(PORT, () => {
  console.log(`PingGather server running at http://localhost:${PORT}`);
});

startWatcher();
