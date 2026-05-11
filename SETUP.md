---
port: 6130
start: node server.js
---

# Setup

## Prerequisites

- **Node.js 18 or later** — [nodejs.org](https://nodejs.org)
- **Windows 10 or 11** for the PowerShell collector script (the server can run anywhere)
- **PowerShell 5.1+** — built into Windows 10/11, no installation needed

---

## Installation

```powershell
git clone https://github.com/your-username/PingGather.git
cd PingGather\server
npm install
```

No database setup is required. The server uses PGlite (embedded PostgreSQL) and creates its data directory at `server/pgdata/` automatically on first run.

---

## Running the server

```powershell
cd server
npm start
```

The server starts at **http://localhost:6130**.

To use a different port:

```powershell
$env:PORT = 7000
npm start
```

---

## Running the collector

Run `ping_gather.ps1` on any Windows machine you want to monitor. The script pings one or more IP addresses on a set interval and writes results to a CSV file.

```powershell
# Ping two destinations every 5 seconds (runs until stopped with Ctrl+C)
.\ping_gather.ps1 "8.8.8.8","1.1.1.1"

# Specify the output file and interval
.\ping_gather.ps1 "192.168.1.1","192.168.1.254" C:\Logs\results.csv -IntervalSeconds 10

# Run for a fixed duration (60 minutes), then stop automatically
.\ping_gather.ps1 "192.168.1.1" -IntervalSeconds 5 -DurationMinutes 60
```

If PowerShell blocks the script due to execution policy, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\ping_gather.ps1 "8.8.8.8"
```

---

## Getting data into the dashboard

### Option 1 — Drop files in the inbox (recommended)

Copy any CSV output file into `server/inbox/`. The server automatically scans the inbox every 5 minutes and imports new files. Processed files are moved to `server/inbox/completed/`.

You can also trigger import immediately from the dashboard without waiting for the next scan.

### Option 2 — Upload from the dashboard

Open **http://localhost:6130**, go to the **Upload** section, and drag-and-drop or browse to a CSV file. Progress is shown in real time.

### Option 3 — Start the collector from the dashboard

The dashboard has a **Collector** panel where you can enter destination IPs, interval, and duration, then click **Start**. The server runs `ping_gather.ps1` in the background and automatically moves the output to the inbox when it stops.

---

## Directory structure

```
PingGather/
├── ping_gather.ps1       # PowerShell collector — run this on monitored PCs
├── server/
│   ├── server.js         # Express web server and REST API
│   ├── db.js             # PGlite database setup
│   ├── import.js         # CSV parsing and database import
│   ├── watcher.js        # Inbox folder watcher
│   ├── package.json
│   ├── inbox/            # Drop CSV files here for auto-import
│   │   └── completed/    # Imported files are moved here
│   ├── holding/          # Temporary output for collector-started sessions
│   ├── pgdata/           # Embedded database (auto-created)
│   └── public/           # Static frontend assets
└── Examples/
    └── Screenshot ...    # Dashboard screenshot
```

---

## Notes

- The embedded database (`server/pgdata/`) is local to the machine running the server. Back it up if you want to preserve historical data.
- Duplicate records (same host + destination + timestamp) are silently skipped on re-import — it is safe to import the same file more than once.
- Latency values of `1001` in the CSV indicate a timeout (no response received within the default timeout window).
- The server must be running on Windows if you use the **Collector** panel in the UI, since it spawns `ping_gather.ps1` via `powershell.exe`. The server itself is platform-agnostic otherwise.
