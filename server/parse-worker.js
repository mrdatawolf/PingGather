import { parentPort, workerData } from 'worker_threads';
import Papa from 'papaparse';

const { headerLine, csvChunk, sourceFileName } = workerData;

// Reconstruct CSV with header so Papa can map columns
const csvText = headerLine + '\n' + csvChunk;

const { data: records } = Papa.parse(csvText, {
  header: true,
  skipEmptyLines: true,
  transformHeader: h => h.trim(),
});

const rows = [];
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

  rows.push([computerName, domain, destIp, dateTime, isNaN(latency) ? 0 : latency, status, sourceFileName]);
}

parentPort.postMessage({ rows, skipped });
