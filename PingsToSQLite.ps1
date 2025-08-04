if (-not (Get-Module -ListAvailable -Name PSSQLite)) { 
    Install-Module -Name PSSQLite -Scope CurrentUser
}
Import-Module PSSQLite

# These are the variables that are used in the script
$primaryDirectory = "S:\PBIData\Pings\New"
$finishedDirectory = "S:\PBIData\Pings\Finished"
$databaseName = "S:\PBIData\Pings\pings.sqlite3"
$tableName = "pings"
$batchSize = 2000
$logFilePath = "S:\PBIData\Pings\error_log.txt"
$indexColumn = "ComputerName"

function Initialize-Database {
    param (
        [string]$dbPath
    )

    if (-Not (Test-Path $dbPath)) {
        # Create an empty database file
        $connection = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$dbPath;Version=3;")
        $connection.Open()
        $connection.Close()
    }
}

function Write-ErrorLog {
    param (
        [string]$errorMessage
    )
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logMessage = "$timestamp - $errorMessage"
    Add-Content -Path $logFilePath -Value $logMessage
}

function Show-ProgressBar {
    param (
        [int]$current,
        [int]$total,
        [string]$activity
    )
    $percentComplete = [math]::Round(($current / $total) * 100)
    Write-Progress -Activity $activity -Status "$percentComplete% Complete" -PercentComplete $percentComplete
}

function Process-CsvFiles {
    param (
        [string]$directory
    )

    $subfolders = Get-ChildItem -Path $directory -Directory
    foreach ($subfolder in $subfolders) {
        $csvFiles = Get-ChildItem -Path $subfolder.FullName -Filter *.csv
        foreach ($csvFile in $csvFiles) {
            try {
                $csvData = Import-Csv -Path $csvFile.FullName
                $totalRows = $csvData.Count
                if ($totalRows -eq 0) {
                    Write-Host "No data found in $($csvFile.FullName)"
                    continue
                }

                $columnNames = $csvData[0].PSObject.Properties.Name
                $columnNames += "Abbrv"

                # Initialize the database if it doesn't exist
                Initialize-Database -dbPath $databaseName

                # Create table if it doesn't exist
                $createTableQuery = "CREATE TABLE IF NOT EXISTS $tableName (" + ($columnNames -join " TEXT, ") + ", PRIMARY KEY (Domain, ComputerName, DateTime, LocationIP))"
                Invoke-SQLiteQuery -DataSource $databaseName -Query $createTableQuery

                # Create index if $indexColumn is not blank
                if ($indexColumn -ne "") {
                    $createIndexQuery = "CREATE INDEX IF NOT EXISTS idx_$indexColumn ON $tableName ($indexColumn)"
                    Invoke-SQLiteQuery -DataSource $databaseName -Query $createIndexQuery
                }

                # Insert or update data into the table in batches
                $batch = @()
                $currentRow = 0
                foreach ($row in $csvData) {
                    $row | Add-Member -MemberType NoteProperty -Name Abbrv -Value $subfolder.Name
                    $batch += $row
                    $currentRow++
                    if ($batch.Count -ge $batchSize) {
                        Show-ProgressBar -current $currentRow -total $totalRows -activity "Processing $($csvFile.Name)"
                        InsertOrUpdate-Batch -batch $batch -tableName $tableName
                        $batch = @()
                    }
                }
                # Insert remaining rows
                if ($batch.Count -gt 0) {
                    Show-ProgressBar -current $currentRow -total $totalRows -activity "Processing $($csvFile.Name)"
                    InsertOrUpdate-Batch -batch $batch -tableName $tableName
                }

                # Move the processed CSV file to the Finished directory
                $destinationFolder = Join-Path -Path $finishedDirectory -ChildPath $subfolder.Name
                if (-Not (Test-Path $destinationFolder)) {
                    New-Item -Path $destinationFolder -ItemType Directory
                }
                Move-Item -Path $csvFile.FullName -Destination $destinationFolder

                Write-Host "Processed and moved $($csvFile.FullName) to $destinationFolder"
            } catch {
                Write-ErrorLog -errorMessage $_.Exception.Message
            }
        }
    }
}

function InsertOrUpdate-Batch {
    param (
        [array]$batch,
        [string]$tableName
    )

    $insertQuery = "BEGIN TRANSACTION;"
    foreach ($row in $batch) {
        $insertQuery += "INSERT OR REPLACE INTO $tableName (" + ($row.PSObject.Properties.Name -join ", ") + ") VALUES ('" + ($row.PSObject.Properties.Value -join "', '") + "');"
    }
    $insertQuery += "COMMIT;"
    Invoke-SQLiteQuery -DataSource $databaseName -Query $insertQuery
}

# Start processing
Process-CsvFiles -directory $primaryDirectory
