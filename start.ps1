# OMNIPOTENT Startup Script
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OMNIPOTENT - Starting..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# Check if Electron is available
$electronPath = Get-Command electron -ErrorAction SilentlyContinue

if ($electronPath) {
    Write-Host "Starting Electron app..." -ForegroundColor Yellow
    Write-Host ""
    npm run dev:electron
} else {
    Write-Host "Electron not found, starting web mode..." -ForegroundColor Yellow
    Write-Host "Run 'npm install' to install dependencies for Electron mode." -ForegroundColor Gray
    Write-Host ""

    # Wait a moment then open browser
    Start-Job -ScriptBlock {
        Start-Sleep -Seconds 5
        Start-Process "http://localhost:5173"
    } | Out-Null

    # Run npm run dev (this will block and show output)
    npm run dev
}
