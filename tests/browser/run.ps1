# Starts a headless Chrome/Edge with a DevTools port, runs the browser
# interaction test against index.html, then shuts the browser down.
# Windows only. Run from the repo root or via `npm run test:browser`.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$indexPath = Join-Path $root 'index.html'
if (-not (Test-Path -LiteralPath $indexPath)) {
  throw "index.html not found at $indexPath"
}

$roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
$candidates = foreach ($base in $roots) {
  Join-Path $base 'Google\Chrome\Application\chrome.exe'
  Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
}
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) {
  throw 'Chrome or Edge was not found. Install one to run the browser interaction test.'
}

$port = if ($env:CDP_PORT) { [int]$env:CDP_PORT } else { 9333 }
$profileDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bikegeo-cdp-' + [guid]::NewGuid().ToString('N'))
$url = ([System.Uri]$indexPath).AbsoluteUri

$portArgument = '--remote-debugging-port=' + $port
$profileArgument = '--user-data-dir="' + $profileDir + '"'
$arguments = @(
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  $portArgument,
  '--remote-allow-origins=*',
  $profileArgument,
  '--window-size=1440,900',
  $url
)

$browserProcess = Start-Process -FilePath $browser -ArgumentList $arguments -PassThru
try {
  Start-Sleep -Seconds 3
  $env:CDP_URL = 'http://127.0.0.1:' + $port
  & node (Join-Path $PSScriptRoot 'interaction.js')
  exit $LASTEXITCODE
}
finally {
  Stop-Process -Id $browserProcess.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  foreach ($name in @('chrome.exe', 'msedge.exe')) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like ('*' + $profileDir + '*') } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
}
