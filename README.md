# PingGather

A lightweight network latency monitoring tool for Windows environments. Run a PowerShell collector on any number of PCs, drop the CSV results into an inbox folder, and explore the data through a local web dashboard.

![PingGather Dashboard](Examples/Screenshot%202026-03-05%20141846.png)

---

## How it works

```
Windows PC(s)                    Dashboard Server
─────────────────────────────    ────────────────────────────────
ping_gather.ps1                  node server.js
  │  pings IPs on an interval         │
  │  writes rows to CSV               │  watches server/inbox/
  └──► result_HOST_DATE.csv ─────────►│  imports CSVs automatically
                                       │  serves http://localhost:6130
```

1. **Collector** — `ping_gather.ps1` runs on any Windows machine and pings one or more IP addresses at a configurable interval, writing results to a CSV file.
2. **Inbox** — Copy (or drop) CSV files into `server/inbox/`. The server picks them up automatically every 5 minutes, or you can trigger import manually from the UI.
3. **Dashboard** — A browser-based UI at `http://localhost:6130` for charts, filtering, summary stats, and CSV/JSON export.

You can also start and stop the collector directly from the dashboard UI — no need to run the script manually.

---

## Components

| Component | Description |
|---|---|
| `ping_gather.ps1` | PowerShell collector script — runs on monitored Windows PCs |
| `server/` | Node.js + Express web server with embedded PGlite database |
| `server/inbox/` | Drop CSV files here for automatic import |

No external database required — PGlite is an embedded PostgreSQL that stores data in `server/pgdata/`.

---

## Quick start

See [SETUP.md](SETUP.md) for full installation and configuration instructions.

```powershell
# 1. Collect ping data on a Windows machine
.\ping_gather.ps1 "8.8.8.8","1.1.1.1" -IntervalSeconds 5

# 2. Start the dashboard server
cd server
npm start

# 3. Open the dashboard
start http://localhost:6130
```

---

## Collector script usage

```powershell
# Ping multiple IPs, write to a named file
.\ping_gather.ps1 "192.168.1.1","192.168.1.2" C:\Results.csv

# Run every 10 seconds for 60 minutes, auto-named output file
.\ping_gather.ps1 "192.168.1.1","8.8.8.8" -IntervalSeconds 10 -DurationMinutes 60
```

### Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `DestinationIPs` | Yes | — | Array of IPs or hostnames to ping |
| `ResultFilePath` | No | auto-generated | Path to the output CSV file |
| `IntervalSeconds` | No | `5` | Seconds between ping rounds |
| `DurationMinutes` | No | `0` (indefinite) | Stop after this many minutes |

### CSV output columns

| Column | Description |
|---|---|
| `ComputerName` | Hostname of the machine running the script |
| `Domain` | Windows domain of the machine |
| `LocationIP` | Destination IP that was pinged |
| `DateTime` | ISO 8601 timestamp |
| `Latency` | Round-trip time in milliseconds (`1001` = timeout) |
| `Status` | `Success` or `Timeout` |

---

## Dashboard features

- **Time-series charts** — median, average, and max latency per destination
- **Summary stats** — total records, avg/median/P95 latency, timeout count
- **Filters** — by host, domain, destination IP, and date range
- **Collector control** — start/stop `ping_gather.ps1` from the browser
- **Data management** — upload CSVs, re-import, delete by source file
- **Export** — download filtered data as CSV or JSON

---

## Requirements

- Windows (for the collector script)
- Node.js 18+ (for the server — can run on Windows, macOS, or Linux)
- PowerShell 5.1+ (built into Windows 10/11)
