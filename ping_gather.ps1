<#
.SYNOPSIS
    ping_gather.ps1 - Pings IP address(es) and write the results to a CSV file.

.DESCRIPTION
    This script pings multiple IP addresses and writes the results to a CSV file. The script gets the latency value for an IP address and returns an object with the computer name, domain, location IP, date and time, latency value, and status. It writes the results to a CSV file specified by $ResultFilePath.

.PARAMETER DestinationIPs
    An array of IP addresses or hostnames to ping.

.PARAMETER ResultFilePath
    The path and filename of the CSV file to write the results to. If not specified, a default filename is generated.

.PARAMETER IntervalSeconds
    The number of seconds to wait between ping rounds. Default is 5.

.PARAMETER DurationMinutes
    Optional. The number of minutes to run before stopping. If not specified, runs indefinitely.

.EXAMPLE
    .\ping_gather.ps1 "192.168.1.1","192.168.1.2","192.168.1.3" C:\Results.csv

    This example pings three IP addresses and writes the results to a CSV file located at "C:\Results.csv".

.EXAMPLE
    .\ping_gather.ps1 "192.168.1.1","192.168.1.2" -IntervalSeconds 10 -DurationMinutes 60

    This example pings two IP addresses every 10 seconds for 60 minutes.

.NOTES
    Author: Patrick Moon
#>
param (
    [Parameter(Mandatory=$true)]
    [string[]]$DestinationIPs,
    [Parameter(Mandatory=$false)]
    [string]$ResultFilePath = "",
    [Parameter(Mandatory=$false)]
    [int]$IntervalSeconds = 5,
    [Parameter(Mandatory=$false)]
    [int]$DurationMinutes = 0
)

$ComputerName = $env:computername
$DateStamp = Get-Date -Format "yyyyMMdd"
$domain = $env:USERDOMAIN

if ($ResultFilePath -eq "") {
    $RandomString = -join (48..57 + 65..90 + 97..122 | Get-Random -Count 4 | ForEach-Object { [char]$_ })
    $ResultFilePath = ".\result_${ComputerName}_${DateStamp}-${RandomString}.csv"
}

function New-PingResult {
    param (
        [string]$IP,
        [string]$DateTime,
        [int]$Latency,
        [string]$Status
    )
    [PSCustomObject]@{
        ComputerName = $ComputerName
        Domain       = $domain
        LocationIP   = $IP
        DateTime     = $DateTime
        Latency      = $Latency
        Status       = $Status
    }
}

Write-Host "Writing results to $ResultFilePath."
Write-Host "Pinging $($DestinationIPs.Count) destination(s) every $IntervalSeconds seconds."
if ($DurationMinutes -gt 0) {
    Write-Host "Will run for $DurationMinutes minute(s)."
}

$startTime = Get-Date

while ($true) {
    if ($DurationMinutes -gt 0) {
        $elapsed = (Get-Date) - $startTime
        if ($elapsed.TotalMinutes -ge $DurationMinutes) {
            Write-Host "Duration of $DurationMinutes minute(s) reached. Stopping."
            break
        }
    }

    $datetime = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    $results = @()

    foreach ($ip in $DestinationIPs) {
        $ping = Test-Connection -ComputerName $ip -Count 1 -ErrorAction SilentlyContinue
        if ($null -eq $ping) {
            $results += New-PingResult -IP $ip -DateTime $datetime -Latency 1001 -Status "Timeout"
        } else {
            if ($null -eq $ping.ResponseTime) {
                $wmi = Get-CimInstance -ClassName Win32_PingStatus -Filter "Address='$ip'" -ErrorAction SilentlyContinue
                if ($null -ne $wmi -and $wmi.StatusCode -eq 0) {
                    $results += New-PingResult -IP $ip -DateTime $datetime -Latency $wmi.ResponseTime -Status "Success"
                } else {
                    $results += New-PingResult -IP $ip -DateTime $datetime -Latency 1001 -Status "Timeout"
                }
            } else {
                $results += New-PingResult -IP $ip -DateTime $datetime -Latency $ping.ResponseTime -Status "Success"
            }
        }
    }

    $results | Select-Object ComputerName, Domain, LocationIP, DateTime, Latency, Status |
        Export-Csv -Path $ResultFilePath -NoTypeInformation -Append

    Start-Sleep -Seconds $IntervalSeconds
}
