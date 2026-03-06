# run-tests.ps1
# Run Schemathesis against all 5 services with correct auth headers.
# Output saved to openapi/tests/schemathesis/<service>.log
#
# Prerequisites: npm run dev must be running in another terminal.
# Usage:
#   .\openapi\tests\schemathesis\run-tests.ps1
#   .\openapi\tests\schemathesis\run-tests.ps1 -Service payment-service
#   .\openapi\tests\schemathesis\run-tests.ps1 -Service payment-service,partner-analytics-service
param(
    [string[]]$Service = @()   # empty = run all; comma-separated names to run a subset
)

$ErrorActionPreference = "Continue"
$root   = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$logDir = "$PSScriptRoot"

# Fix UnicodeEncodeError on Chinese Windows (GBK locale) when rich tries to
# print special characters (e.g. checkmark \u2705).  Switch console to UTF-8 and tell
# Python to use UTF-8 for all I/O.
chcp 65001 | Out-Null
$env:PYTHONUTF8       = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# NO_COLOR forces rich into plain-text mode, bypassing LegacyWindowsTerm (Win32
# console API) which uses GBK encoding and crashes on emoji such as U+2705.
$env:NO_COLOR = "1"

# -- 1. Generate tokens --------------------------------------------------------------
Write-Host "Generating auth tokens..." -ForegroundColor Cyan
$tokensJson = node "$PSScriptRoot\gen-tokens.js"
$tokens     = $tokensJson | ConvertFrom-Json
$userToken     = $tokens.user
$internalToken = $tokens.internal
$deviceKey     = if ($env:DEVICE_API_KEY)  { $env:DEVICE_API_KEY }  else { "dev-device-key" }
$partnerKey    = if ($env:PARTNER_API_KEY) { $env:PARTNER_API_KEY } else { "dev-partner-key" }
$partnerId     = "schemathesis-partner"

Write-Host "  User JWT:     $($userToken.Substring(0,30))..." -ForegroundColor Gray
Write-Host "  Internal JWT: $($internalToken.Substring(0,30))..." -ForegroundColor Gray
Write-Host ""

# -- 2. Service definitions ----------------------------------------------------------
# Each entry: name, spec path, base-url, and the schemathesis --header flags
$services = @(
    @{
        name    = "user-service"
        spec    = "openapi/user-service.yaml"
        url     = "http://localhost:3001"
        # User JWT for public/user routes; internal JWT for /v1/internal/* routes
        headers = @(
            "Authorization: Bearer $userToken",
            "X-Internal-Token: $internalToken"
        )
    },
    @{
        name    = "ride-service"
        spec    = "openapi/ride-service.yaml"
        url     = "http://localhost:3002"
        # User JWT for /v1/rides; internal token for /v1/internal/rides
        # Schemathesis sends both headers; routes ignore the one they don't use
        headers = @(
            "Authorization: Bearer $userToken",
            "X-Internal-Token: $internalToken"   # informational; real auth is Bearer
        )
    },
    @{
        name    = "bike-inventory-service"
        spec    = "openapi/bike-inventory-service.yaml"
        url     = "http://localhost:3003"
        # User JWT for /v1/bikes; device key for /v1/device routes
        headers = @(
            "Authorization: Bearer $userToken",
            "X-Device-Key: $deviceKey"
        )
    },
    @{
        name    = "payment-service"
        spec    = "openapi/payment-service.yaml"
        url     = "http://localhost:3004"
        # All routes require internal JWT
        headers = @("Authorization: Bearer $internalToken")
    },
    @{
        name    = "partner-analytics-service"
        spec    = "openapi/partner-analytics-service.yaml"
        url     = "http://localhost:3005"
        # Partner key + partner ID header
        headers = @(
            "X-Api-Key: $partnerKey",
            "X-Partner-Id: $partnerId"
        )
    }
)

# -- 3. Run Schemathesis for each service --------------------------------------------
$results = @()

# Filter to requested services (case-insensitive); default = all
$runList = if ($Service.Count -gt 0) {
    $services | Where-Object { $Service -contains $_.name }
} else {
    $services
}

if ($runList.Count -eq 0) {
    Write-Host "No matching service found. Valid names: $($services.name -join ', ')" -ForegroundColor Red
    exit 1
}

foreach ($svc in $runList) {
    $logFile = "$logDir\$($svc.name).log"
    Write-Host "Testing $($svc.name) -> $($svc.url)" -ForegroundColor Green
    Write-Host "  Spec:    $($svc.spec)"
    Write-Host "  Headers: $($svc.headers -join ', ')"
    Write-Host "  Log:     $logFile"

    # Build argument list explicitly (handles spaces in path and multi-headers)
    $specPath = (Join-Path $root $svc.spec).Replace('\', '/')
    $argList = [System.Collections.ArrayList]@()
    $argList.Add("run")      | Out-Null
    $argList.Add($specPath)  | Out-Null
    $argList.Add("--url")    | Out-Null
    $argList.Add($svc.url)   | Out-Null
    foreach ($h in $svc.headers) {
        $argList.Add("--header") | Out-Null
        $argList.Add($h)         | Out-Null
    }

    # Run schemathesis and capture output
    $output = & schemathesis @argList 2>&1

    # Write log - pre-compute values to avoid PS5 array-expression bugs
    $sep   = "=" * 60
    $runAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    @($sep,
      "Service : $($svc.name)",
      "Spec    : $($svc.spec)",
      "URL     : $($svc.url)",
      "Headers : $($svc.headers -join ' | ')",
      "Run at  : $runAt",
      $sep, ""
    ) | Out-File -FilePath $logFile -Encoding utf8
    @($output) | Out-File -FilePath $logFile -Encoding utf8 -Append
    Write-Host "  Done. Log saved." -ForegroundColor Gray

    # Check for failures
    $passed = $output | Select-String "passed" | Select-Object -Last 1
    $results += [PSCustomObject]@{
        Service = $svc.name
        Result  = if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }
        Summary = if ($passed) { $passed.Line.Trim() } else { "see log" }
    }
    Write-Host ""
}

# -- 4. Summary table ----------------------------------------------------------------
$sep = "=" * 60
Write-Host $sep -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host $sep -ForegroundColor Cyan
$results | Format-Table -AutoSize

Write-Host "Logs saved to: $logDir" -ForegroundColor Cyan
