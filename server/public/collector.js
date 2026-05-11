const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusSection = document.getElementById('statusSection');
let pollTimer = null;

startBtn.addEventListener('click', async () => {
  const ips = [
    document.getElementById('ip1').value.trim(),
    document.getElementById('ip2').value.trim(),
    document.getElementById('ip3').value.trim(),
    document.getElementById('ip4').value.trim(),
  ].filter(Boolean);

  if (ips.length === 0) {
    alert('Enter at least one target IP or hostname.');
    return;
  }

  const interval = parseInt(document.getElementById('interval').value) || 5;
  const duration = parseInt(document.getElementById('duration').value) || 0;

  startBtn.disabled = true;
  try {
    const res = await fetch('/api/collector/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips, intervalSeconds: interval, durationMinutes: duration }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to start collector.');
      startBtn.disabled = false;
      return;
    }
    setRunningUI();
  } catch (err) {
    alert('Error: ' + err.message);
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try {
    await fetch('/api/collector/stop', { method: 'POST' });
  } catch {
    // ignore
  }
  // Poll will detect the stopped state
});

function setRunningUI() {
  startBtn.hidden = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  statusSection.hidden = false;
  disableInputs(true);
  if (!pollTimer) pollTimer = setInterval(pollStatus, 2000);
  pollStatus();
}

function setIdleUI() {
  startBtn.hidden = false;
  startBtn.disabled = false;
  stopBtn.hidden = true;
  disableInputs(false);
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function disableInputs(disabled) {
  for (const id of ['ip1', 'ip2', 'ip3', 'ip4', 'interval', 'duration']) {
    document.getElementById(id).disabled = disabled;
  }
}

function formatElapsed(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function pollStatus() {
  try {
    const res = await fetch('/api/collector/status');
    const s = await res.json();

    if (s.running) {
      document.getElementById('statusText').textContent = 'Running';
      document.getElementById('statusTargets').textContent = s.destinationIPs.join(', ');
      document.getElementById('statusElapsed').textContent = formatElapsed(s.startedAt);
      document.getElementById('statusInterval').textContent = s.intervalSeconds + 's';
      document.getElementById('statusFile').textContent = s.outputFile || '--';
      statusSection.hidden = false;
    } else {
      setIdleUI();
      if (s.lastResult) {
        document.getElementById('statusText').textContent = 'Stopped — file sent to inbox';
        statusSection.hidden = false;
      } else {
        statusSection.hidden = true;
      }
    }
  } catch {
    // ignore
  }
}

// Check status on page load in case script is already running
pollStatus().then(async () => {
  try {
    const res = await fetch('/api/collector/status');
    const s = await res.json();
    if (s.running) setRunningUI();
  } catch {}
});
