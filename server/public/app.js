const PAGE_SIZE = 100;
let currentPage = 0;
let latencyChart = null;
let hostChart = null;

// ── Helpers ──

function getFilters() {
  const params = new URLSearchParams();
  const host = document.getElementById('filterHost').value;
  const domain = document.getElementById('filterDomain').value;
  const dest = document.getElementById('filterDest').value;
  const start = document.getElementById('filterStart').value;
  const end = document.getElementById('filterEnd').value;
  if (host) params.set('host', host);
  if (domain) params.set('domain', domain);
  if (dest) params.set('destination', dest);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return params;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fmt(n) {
  if (n == null || n === '--') return '--';
  return Number(n).toLocaleString();
}

const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
];

// ── Upload with modal + SSE progress ──

const modal = document.getElementById('uploadModal');
const modalTitle = document.getElementById('modalTitle');
const modalDetail = document.getElementById('modalDetail');
const modalStats = document.getElementById('modalStats');
const progressBar = document.getElementById('progressBar');
const modalCloseBtn = document.getElementById('modalCloseBtn');

const stepEls = {
  parsing: document.getElementById('stepParsing'),
  inserting: document.getElementById('stepInserting'),
  indexing: document.getElementById('stepIndexing'),
};

function setStepState(stepName, state) {
  // state: 'pending' | 'active' | 'done'
  const el = stepEls[stepName];
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  if (state === 'done') el.classList.add('done');
}

function resetModal() {
  modalTitle.textContent = 'Importing CSV...';
  modalDetail.textContent = 'Preparing...';
  modalStats.hidden = true;
  modalCloseBtn.hidden = true;
  progressBar.style.width = '0%';
  for (const key of Object.keys(stepEls)) setStepState(key, 'pending');
}

modalCloseBtn.addEventListener('click', () => {
  modal.hidden = true;
  refreshAll();
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('csvFile');
  const status = document.getElementById('uploadStatus');
  if (!fileInput.files.length) { status.textContent = 'Select a file first.'; return; }

  resetModal();
  modal.hidden = false;
  status.textContent = '';

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }

        // Update step indicators
        const stepOrder = ['parsing', 'inserting', 'indexing', 'done', 'complete', 'error'];
        const currentIdx = stepOrder.indexOf(data.step);
        for (const [key] of Object.entries(stepEls)) {
          const keyIdx = stepOrder.indexOf(key);
          if (keyIdx < currentIdx) setStepState(key, 'done');
          else if (keyIdx === currentIdx) setStepState(key, 'active');
          else setStepState(key, 'pending');
        }

        // Update detail text
        if (data.detail) modalDetail.textContent = data.detail;

        // Update progress bar
        if (data.percent != null) {
          progressBar.style.width = data.percent + '%';
        }

        // Handle completion
        if (data.step === 'complete' || data.step === 'done') {
          for (const key of Object.keys(stepEls)) setStepState(key, 'done');
          progressBar.style.width = '100%';

          if (data.message) {
            // Duplicate file
            modalTitle.textContent = 'Already Imported';
            modalDetail.textContent = data.message;
          } else {
            modalTitle.textContent = 'Import Complete';
            modalDetail.textContent = `Successfully imported ${(data.inserted || 0).toLocaleString()} rows.`;
            if (data.skipped > 0) {
              modalStats.hidden = false;
              document.getElementById('statInserted').textContent = `Inserted: ${data.inserted.toLocaleString()}`;
              document.getElementById('statSkipped').textContent = `Skipped: ${data.skipped.toLocaleString()}`;
            }
          }
          modalCloseBtn.hidden = false;
        }

        // Handle error
        if (data.step === 'error') {
          modalTitle.textContent = 'Import Failed';
          modalDetail.textContent = data.detail || 'An unknown error occurred.';
          progressBar.style.width = '100%';
          progressBar.style.background = 'var(--alert)';
          modalCloseBtn.hidden = false;
        }
      }
    }
  } catch (err) {
    modalTitle.textContent = 'Upload Failed';
    modalDetail.textContent = err.message;
    modalCloseBtn.hidden = false;
  }
});

// ── Filters ──

document.getElementById('applyFilters').addEventListener('click', () => {
  currentPage = 0;
  refreshAll();
});

document.getElementById('clearFilters').addEventListener('click', () => {
  document.getElementById('filterHost').value = '';
  document.getElementById('filterDomain').value = '';
  document.getElementById('filterDest').value = '';
  document.getElementById('filterStart').value = '';
  document.getElementById('filterEnd').value = '';
  currentPage = 0;
  refreshAll();
});

// ── Export ──

document.getElementById('exportCsv').addEventListener('click', () => {
  const params = getFilters();
  window.location.href = '/api/export/csv?' + params.toString();
});

document.getElementById('exportJson').addEventListener('click', () => {
  const params = getFilters();
  window.location.href = '/api/export/json?' + params.toString();
});

// ── Pagination ──

document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 0) { currentPage--; refreshTable(); }
});
document.getElementById('nextPage').addEventListener('click', () => {
  currentPage++;
  refreshTable();
});

// ── Populate filter dropdowns ──

async function loadFilters() {
  try {
    const [hosts, domains, destinations] = await Promise.all([
      fetchJson('/api/hosts'),
      fetchJson('/api/domains'),
      fetchJson('/api/destinations'),
    ]);

    populateSelect('filterHost', hosts);
    populateSelect('filterDomain', domains);
    populateSelect('filterDest', destinations);
  } catch (err) {
    console.error('Failed to load filters:', err);
  }
}

function populateSelect(id, values) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  sel.value = current;
}

// ── Summary cards ──

async function refreshSummary() {
  try {
    const params = getFilters();
    const data = await fetchJson('/api/summary?' + params.toString());
    document.getElementById('totalRecords').textContent = fmt(data.total_records);
    document.getElementById('distinctDays').textContent = fmt(data.distinct_days);
    document.getElementById('avgLatency').textContent = fmt(data.avg_latency);
    document.getElementById('medianLatency').textContent = fmt(data.median_latency);
    document.getElementById('p95Latency').textContent = fmt(data.p95_latency);
    document.getElementById('timeoutCount').textContent = fmt(data.timeout_count);
  } catch (err) {
    console.error('Failed to load summary:', err);
  }
}

// ── Time-series chart ──

async function refreshLatencyChart() {
  try {
    const params = getFilters();
    const data = await fetchJson('/api/timeseries?' + params.toString());

    // Group by destination_ip
    const groups = {};
    for (const row of data) {
      if (!groups[row.destination_ip]) groups[row.destination_ip] = [];
      groups[row.destination_ip].push({
        x: new Date(row.bucket),
        y: row.median_latency != null ? Math.round(row.median_latency) : null,
      });
    }

    const datasets = Object.entries(groups).map(([ip, points], i) => ({
      label: ip,
      data: points,
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '20',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.2,
      fill: true,
    }));

    if (latencyChart) latencyChart.destroy();
    latencyChart = new Chart(document.getElementById('latencyChart'), {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'PPpp' },
            grid: { color: '#2a2d3a' },
            ticks: { color: '#8b8d98' },
          },
          y: {
            title: { display: true, text: 'Latency (ms)', color: '#8b8d98' },
            grid: { color: '#2a2d3a' },
            ticks: { color: '#8b8d98' },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { labels: { color: '#e4e4e7' } },
        },
      },
    });

    // Set canvas height
    document.getElementById('latencyChart').parentElement.style.height = '350px';
  } catch (err) {
    console.error('Failed to load latency chart:', err);
  }
}

// ── Host chart ──

async function refreshHostChart() {
  try {
    const params = getFilters();
    // Fetch summary per host
    const hosts = await fetchJson('/api/hosts');
    if (!hosts.length) return;

    const hostData = [];
    for (const host of hosts.slice(0, 10)) {
      const p = new URLSearchParams(params);
      p.set('host', host);
      const summary = await fetchJson('/api/summary?' + p.toString());
      hostData.push({ host, avg: summary.avg_latency || 0, median: summary.median_latency || 0 });
    }

    if (hostChart) hostChart.destroy();
    hostChart = new Chart(document.getElementById('hostChart'), {
      type: 'bar',
      data: {
        labels: hostData.map(d => d.host),
        datasets: [
          {
            label: 'Avg Latency',
            data: hostData.map(d => d.avg),
            backgroundColor: '#3b82f6',
          },
          {
            label: 'Median Latency',
            data: hostData.map(d => d.median),
            backgroundColor: '#22c55e',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: '#2a2d3a' }, ticks: { color: '#8b8d98' } },
          y: {
            title: { display: true, text: 'ms', color: '#8b8d98' },
            grid: { color: '#2a2d3a' },
            ticks: { color: '#8b8d98' },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { labels: { color: '#e4e4e7' } },
        },
      },
    });

    document.getElementById('hostChart').parentElement.style.height = '350px';
  } catch (err) {
    console.error('Failed to load host chart:', err);
  }
}

// ── Data table ──

async function refreshTable() {
  try {
    const params = getFilters();
    params.set('limit', PAGE_SIZE);
    params.set('offset', currentPage * PAGE_SIZE);
    const data = await fetchJson('/api/ping-data?' + params.toString());

    const tbody = document.querySelector('#dataTable tbody');
    tbody.innerHTML = '';

    for (const row of data) {
      const tr = document.createElement('tr');
      const statusClass = row.status === 'Timeout' ? 'status-timeout' : 'status-success';
      tr.innerHTML = `
        <td>${esc(row.computer_name)}</td>
        <td>${esc(row.domain)}</td>
        <td>${esc(row.destination_ip)}</td>
        <td>${esc(row.timestamp)}</td>
        <td>${row.latency_ms}</td>
        <td class="${statusClass}">${esc(row.status)}</td>
      `;
      tbody.appendChild(tr);
    }

    document.getElementById('prevPage').disabled = currentPage === 0;
    document.getElementById('nextPage').disabled = data.length < PAGE_SIZE;
    document.getElementById('pageInfo').textContent = `Page ${currentPage + 1}`;
  } catch (err) {
    console.error('Failed to load table:', err);
  }
}

function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ── Sources list ──

async function refreshSources() {
  try {
    const data = await fetchJson('/api/sources');
    const container = document.getElementById('sourcesList');
    if (!data.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No files imported yet. Upload a CSV to get started.</p>';
      return;
    }
    container.innerHTML = data.map(s => `
      <div class="source-item">
        <div>
          <strong>${esc(s.source_file)}</strong>
          <span class="source-info">&mdash; ${s.row_count} rows, ${esc(s.first_ts)} to ${esc(s.last_ts)}</span>
        </div>
        <button class="btn-danger" onclick="deleteSource('${esc(s.source_file)}')">Delete</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load sources:', err);
  }
}

window.deleteSource = async function(filename) {
  if (!confirm(`Delete all data from "${filename}"?`)) return;
  try {
    await fetch('/api/source/' + encodeURIComponent(filename), { method: 'DELETE' });
    await refreshAll();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
};

// ── Refresh all ──

async function refreshAll() {
  await loadFilters();
  await Promise.all([
    refreshSummary(),
    refreshLatencyChart(),
    refreshHostChart(),
    refreshTable(),
    refreshSources(),
  ]);
}

// ── Watcher polling ──

const batchInfo = document.getElementById('batchInfo');
let watcherWasActive = false;

async function pollWatcher() {
  try {
    const s = await fetchJson('/api/watcher/status');
    if (s.active) {
      if (!watcherWasActive) {
        resetModal();
        modal.hidden = false;
        watcherWasActive = true;
      }

      // Batch info
      batchInfo.hidden = false;
      batchInfo.textContent = `File ${s.currentFile} of ${s.totalFiles}: ${s.currentFileName}`;

      modalTitle.textContent = `Processing Inbox (${s.currentFile}/${s.totalFiles})`;

      // Step indicators
      const stepOrder = ['parsing', 'inserting', 'indexing', 'done', 'complete'];
      const currentIdx = stepOrder.indexOf(s.step);
      for (const key of Object.keys(stepEls)) {
        const keyIdx = stepOrder.indexOf(key);
        if (keyIdx < currentIdx) setStepState(key, 'done');
        else if (keyIdx === currentIdx) setStepState(key, 'active');
        else setStepState(key, 'pending');
      }

      if (s.detail) modalDetail.textContent = s.detail;
      if (s.percent != null) progressBar.style.width = s.percent + '%';

    } else if (watcherWasActive) {
      // Just finished
      watcherWasActive = false;
      for (const key of Object.keys(stepEls)) setStepState(key, 'done');
      progressBar.style.width = '100%';
      modalTitle.textContent = 'Inbox Processing Complete';
      modalDetail.textContent = 'All files have been processed.';
      batchInfo.hidden = true;
      modalCloseBtn.hidden = false;
    }
  } catch {
    // ignore poll errors
  }
}

setInterval(pollWatcher, 2000);

// ── Process Inbox button ──

document.getElementById('processInboxBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/watcher/process', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Failed to start processing.');
    }
    // Polling will detect active state and show modal
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// Initial load
refreshAll();
