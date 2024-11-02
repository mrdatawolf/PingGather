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

## Usage

### Windows (PowerShell)

#### Script: `ping_gather.ps1`

**Parameters:**
- `DestinationIPs`: An array of IP addresses to ping.
- `ResultFilePath` (Optional): The path and filename of the JSON file to write the results to. Defaults to a file in the current directory with a timestamp.

#### Example
```powershell
.\ping_gather.ps1 "192.168.1.1","192.168.1.2","192.168.1.3" C:\Results.json

<!-- INSTALL_COMMAND: curl -L -o ping_gather.ps1 https://raw.githubusercontent.com/mrdatawolf/PingGather/main/ping_gather.ps1; curl -L -o ping_gather.sh https://raw.githubusercontent.com/mrdatawolf/PingGather/main/ping_gather.sh -->
<!-- RUN_COMMAND: .\ping_gather.ps1 "192.168.1.1","192.168.1.2","8.8.8.8" -->
