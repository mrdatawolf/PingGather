# PingGather

## Overview
PingGather is a simple script designed to ping multiple IP addresses and log the results in a JSON file. It can be used on both Windows (PowerShell script) and Linux (shell script) environments.

## Features
- Pings multiple IP addresses
- Logs the latency value, computer name, location IP, date, and time
- Writes results to a JSON file with customizable file paths
- Supports both Windows and Linux environments

## Requirements
- For Windows: PowerShell
- For Linux: Bash

## New
- Added a packet loss checker to the bash side.

## Thanks
- Thanks to https://gist.github.com/rwohleb/3d8242a7aaffa92aa76c90a238d4850f for the packet loss check
## Usage

### Windows (PowerShell)

#### Script: `ping_gather.ps1`

**Parameters:**
- `DestinationIPs`: An array of IP addresses to ping.
- `ResultFilePath` (Optional): The path and filename of the JSON file to write the results to. Defaults to a file in the current directory with a timestamp.
<!-- INSTALL_COMMAND: curl -L -o ping_gather.ps1 https://raw.githubusercontent.com/mrdatawolf/PingGather/main/ping_gather.ps1; curl -L -o ping_gather.sh https://raw.githubusercontent.com/mrdatawolf/PingGather/main/ping_gather.sh -->
<!-- RUN_COMMAND: .\ping_gather.ps1 "192.168.1.1","192.168.1.2","8.8.8.8" -->

### Linux (Bash)

#### Script: `./ping_gather.sh`

**Parameters:**
- `DestinationIPs`: An array of IP addresses to ping.
- `ResultFilePath` (Optional): The path and filename of the JSON file to write the results 
- `-l`: also writes a packet loss log

#### Example
```powershell
.\ping_gather.ps1 "192.168.1.1","192.168.1.2","192.168.1.3" C:\Results.json

#### Example
.\PingsToSQLite.ps1

<!-- Purpose: pings multiple IP addresses and log the results in a JSON file. It also puts the results into a SQLite DB -->
<!-- INSTALL_COMMAND: curl -L -o ping_gather.ps1 https://raw.githubusercontent.com/mrdatawolf/PingGather/main/ping_gather.ps1; -->
<!-- RUN_COMMAND: .\ping_gather.ps1 -->
