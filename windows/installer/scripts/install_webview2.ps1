# install_webview2.ps1 - ensure the Microsoft Edge WebView2 runtime is present.
# The tray launcher hosts the UI in a WebView2 window; if no runtime is found it
# falls back to a browser. Best-effort by design: a problem here logs a warning
# and never aborts the platform install. Idempotent (skips when already present).
. "$PSScriptRoot\common.ps1"

try {
    # EdgeUpdate registers the runtime's version under this client GUID.
    $clients = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )
    foreach ($k in $clients) {
        try {
            $pv = (Get-ItemProperty -Path $k -ErrorAction Stop).pv
            if ($pv) { Write-Log "WebView2 runtime already present ($pv) - skipping."; return }
        } catch { }
    }

    $installer = Join-Path $AppDir 'webview2-runtime\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    if (-not (Test-Path $installer)) {
        Write-Log "WebView2 runtime installer not bundled ($installer); the launcher will fall back to a browser if no runtime is found." 'WARN'
        return
    }

    Write-Log "Installing Microsoft Edge WebView2 runtime (silent) ..."
    $code = Invoke-Logged -FilePath $installer -LogFile (Join-Path $LogDir 'webview2.log') -ArgumentList @('/silent', '/install')
    if ($code -eq 0) { Write-Log "WebView2 runtime installed." }
    else { Write-Log "WebView2 runtime installer returned $code (continuing; launcher can fall back to a browser)." 'WARN' }
}
catch {
    Write-Log "WebView2 runtime install skipped due to error: $($_.Exception.Message)" 'WARN'
}
