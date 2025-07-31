<#
.SYNOPSIS
    ping_gather.ps1 - Pings IP address(es) and write the results to a CSV file.

.DESCRIPTION
    This script pings multiple IP addresses and writes the results to a CSV file. The script gets the latency value for an IP address and returns an object with the computer name, location IP, date and time, and actual latency value. It writes the results to a CSV file specified by $ResultFilePath.

.PARAMETER DestinationIPs
    An array of IP addresses to ping.

.PARAMETER ResultFilePath
    The path and filename of the CSV file to write the results to. If not specified, the default filename is "result_$env:computername_$((Get-Date).ToString('yyyyMMdd_HHmmss')).csv".

.EXAMPLE
    .\ping_gather.ps1 "192.168.1.1","192.168.1.2","192.168.1.3" C:\Results.csv

    This example pings three IP addresses and writes the results to a CSV file located at "C:\Results.csv".

.EXAMPLE
    .\ping_gather.ps1 "192.168.1.1","192.168.1.2","192.168.1.3"

    This example pings three IP addresses and writes the results to a CSV file located in the current directory with a default filename of "result_$env:computername_$((Get-Date).ToString('yyyyMMdd_HHmmss'))_{randomCharacters}.json".

.NOTES
    Author: Patrick Moon
#>
param (
    [Parameter(Mandatory=$true)]
    [string[]]$DestinationIPs,
    [Parameter(Mandatory=$false)]
    [string]$ResultFilePath = ""
)

$ComputerName = $env:computername
$DateStamp = Get-Date -Format "yyyyMMdd"
# Get the domain the computer is connected to
$domain = $env:USERDOMAIN

if( $ResultFilePath -eq "") {
    $ResultFilePath = ".\result_$ComputerName_$DateStamp.csv"
    # Generate a random 4-character string
    $RandomString = -join (48..57 + 65..90 + 97..122 | Get-Random -Count 4 | ForEach-Object { [char]$_ })

    # Combine the random string with the original filename
    $ResultFilePath = $ResultFilePath -replace '\.csv$', "-$RandomString.csv"
}
Write-Host "Writing results to $ResultFilePath."
while ($true) {
    $datetime = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"  # ISO 8601 format

    $results = @()  # Collect results in an array

    foreach ($ip in $DestinationIPs) {
        $ping = Test-Connection -ComputerName $ip -Count 1 -ErrorAction SilentlyContinue
        if ($null -eq $ping) {
            $pingObject = New-Object PSObject -Property @{
                ComputerName = $ComputerName
                Domain = $domain
                LocationIP = $ip
                DateTime = $datetime
                Latency = 1001
            }
        } else {
            if ($null -eq $ping.ResponseTime) {
                $wmi = Get-CimInstance -ClassName Win32_PingStatus -Filter "Address='$ip'" -ErrorAction SilentlyContinue
                if ($null -ne $wmi -and $wmi.StatusCode -eq 0) {
                    $pingObject = $ping | Select-Object @{Name='ComputerName';Expression={$ComputerName}}, @{Name='Domain';Expression={$domain}}, @{Name='LocationIP';Expression={$ip}}, @{Name='DateTime';Expression={$datetime}}, @{Name='Latency';Expression={$wmi.ResponseTime}}
                } else {
                    $pingObject = New-Object PSObject -Property @{
                        ComputerName = $ComputerName
                        Domain = $domain
                        LocationIP = $ip
                        DateTime = $datetime
                        Latency = 1001
                    }
                }
            } else {
                $pingObject = $ping | Select-Object @{Name='ComputerName';Expression={$ComputerName}}, @{Name='Domain';Expression={$domain}}, @{Name='LocationIP';Expression={$ip}}, @{Name='DateTime';Expression={$datetime}}, @{Name='Latency';Expression={$ping.ResponseTime}}
            }
        }
        $results += $pingObject  # Add to results array
    }

    # Write all results in one batch
    $results | Export-Csv -Path $ResultFilePath -NoTypeInformation -Append

    Start-Sleep -Seconds 5
}
