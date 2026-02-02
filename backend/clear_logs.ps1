$LogDir = "app_evaluation_agent/logs"

if (-not (Test-Path $LogDir)) {
    Write-Output "No log directory at $LogDir"
    exit 0
}

$files = Get-ChildItem -Path $LogDir -File -Recurse | Where-Object {
    $_.Name -like "*.log" -or $_.Name -like "*.log.*" -or $_.Name -like "*.jsonl"
}

if (-not $files) {
    Write-Output "No log files found under $LogDir"
    exit 0
}

foreach ($file in $files) {
    Write-Output "Removing $($file.FullName)"
    Remove-Item -Force $file.FullName
}

Write-Output "Log cleanup complete under $LogDir"
