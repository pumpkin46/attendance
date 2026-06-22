using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AttendanceLauncher;

/// <summary>
/// Native desktop window that hosts the web UI in an embedded WebView2 control,
/// so the platform runs in its own application window instead of a browser tab.
/// It serves the same locally-hosted UI (nginx on <see cref="_url"/>): a splash
/// shows until the web server is reachable, then it navigates. Closing the
/// window hides it to the tray; the tray app calls <see cref="ExitApp"/> on a
/// real quit.
/// </summary>
internal sealed class MainWindow : Form
{
    private readonly string _appDir;
    private readonly int _nginxPort;
    private readonly string _url;
    private readonly Action<string, string> _log;
    private readonly WebView2 _web;
    private readonly System.Windows.Forms.Timer _waitTimer;
    private bool _exiting;
    private bool _coreReady;
    private bool _navigated;

    public MainWindow(string appDir, int nginxPort, Icon icon, Action<string, string> log)
    {
        _appDir = appDir;
        _nginxPort = nginxPort;
        _url = $"http://localhost:{nginxPort}";
        _log = log;

        Text = "Attendance Platform";
        Icon = icon;
        // Frameless: the web app draws its own title bar (a drag region plus the
        // minimize/maximize/close controls), so there's no redundant native
        // caption stacked above it. Resize + Aero Snap are kept via CreateParams.
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 840);
        MinimumSize = new Size(900, 600);
        BackColor = Color.FromArgb(2, 6, 23); // slate-950, matches the app shell

        _web = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_web);

        // Poll the web server and navigate as soon as it accepts connections.
        _waitTimer = new System.Windows.Forms.Timer { Interval = 500 };
        _waitTimer.Tick += (_, _) => TryNavigateWhenUp();

        Load += async (_, _) => await InitAsync();
    }

    /// <summary>The bundled fixed-version WebView2 runtime folder, if shipped.</summary>
    internal static string? BundledRuntimeFolder(string appDir)
    {
        var f = Path.Combine(appDir, "webview2");
        return File.Exists(Path.Combine(f, "msedgewebview2.exe")) ? f : null;
    }

    private async Task InitAsync()
    {
        try
        {
            // A per-user, always-writable profile dir (the install dir under
            // Program Files is read-only for the non-elevated launcher).
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AttendancePlatform", "WebView2");
            Directory.CreateDirectory(userData);

            // browserExecutableFolder = bundled runtime when present, else null
            // (use the machine's Evergreen runtime).
            var env = await CoreWebView2Environment.CreateAsync(
                BundledRuntimeFolder(_appDir), userData, null);
            await _web.EnsureCoreWebView2Async(env);

            var s = _web.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = true;
            s.AreDevToolsEnabled = true; // handy while iterating; cheap to keep
            // Honour CSS `app-region: drag` so the web header can act as the
            // frameless window's title bar (drag / double-click-to-maximize).
            s.IsNonClientRegionSupportEnabled = true;

            // External / target=_blank links open in the system browser instead
            // of a popup webview.
            _web.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); }
                catch (Exception ex) { _log("launcher", "open external link failed: " + ex.Message); }
            };

            // The web title bar's min/maximize/close buttons message the host.
            _web.CoreWebView2.WebMessageReceived += OnWebMessage;
            // Sync the maximize/restore icon once the page (and its listener) loads.
            _web.CoreWebView2.NavigationCompleted += (_, _) => PostWindowState();

            _coreReady = true;
            ShowSplash();
            _waitTimer.Start();
        }
        catch (Exception ex)
        {
            _log("launcher", "WebView2 init failed: " + ex);
            ShowError(ex.Message);
        }
    }

    private void TryNavigateWhenUp()
    {
        if (_navigated || !_coreReady) return;
        if (!TcpUp(_nginxPort)) return;
        _navigated = true;
        _waitTimer.Stop();
        try { _web.CoreWebView2.Navigate(_url); }
        catch (Exception ex) { _log("launcher", "navigate failed: " + ex.Message); }
    }

    private void ShowSplash()
    {
        const string html =
            "<!doctype html><html><head><meta charset='utf-8'><style>" +
            "html,body{height:100%;margin:0}" +
            "body{background:#020617;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;" +
            "display:flex;align-items:center;justify-content:center}" +
            ".box{text-align:center}" +
            ".spin{width:42px;height:42px;margin:0 auto 18px;border:4px solid #1e293b;" +
            "border-top-color:#3b82f6;border-radius:50%;animation:r .9s linear infinite}" +
            "@keyframes r{to{transform:rotate(360deg)}}" +
            "h1{font-size:18px;font-weight:600;margin:0 0 6px}" +
            "p{margin:0;color:#64748b;font-size:13px}" +
            "</style></head><body><div class='box'>" +
            "<div class='spin'></div><h1>Attendance Platform</h1>" +
            "<p>Starting services...</p></div></body></html>";
        try { _web.CoreWebView2.NavigateToString(html); } catch { /* pre-init */ }
    }

    private void ShowError(string detail)
    {
        if (!_coreReady) return; // core never initialized; nothing to render into
        var html =
            "<!doctype html><html><head><meta charset='utf-8'></head>" +
            "<body style='background:#020617;color:#e2e8f0;font-family:Segoe UI,system-ui;" +
            "display:flex;height:100vh;margin:0;align-items:center;justify-content:center;text-align:center'>" +
            "<div style='max-width:440px'><h2>Could not start the in-app view</h2>" +
            "<p style='color:#94a3b8'>The embedded view failed to initialize. You can still open " +
            "the UI in your browser at <b>" + _url + "</b>.</p>" +
            "<p style='color:#64748b;font-size:12px'>" + System.Net.WebUtility.HtmlEncode(detail) +
            "</p></div></body></html>";
        try { _web.CoreWebView2.NavigateToString(html); } catch { /* ignore */ }
    }

    private static bool TcpUp(int port)
    {
        try
        {
            using var c = new TcpClient();
            var ar = c.BeginConnect("127.0.0.1", port, null, null);
            if (!ar.AsyncWaitHandle.WaitOne(300)) return false;
            c.EndConnect(ar);
            return true;
        }
        catch { return false; }
    }

    // Closing the window hides it to the tray; only a real Quit disposes it.
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }

    public void ExitApp()
    {
        _exiting = true;
        try { Close(); } catch { /* ignore */ }
    }

    // ── Frameless window plumbing ────────────────────────────────────────────
    // Re-add a resizable frame + Aero Snap to the borderless window. The sizing
    // border stays in the (DWM-managed) non-client area, so resizing still works
    // even though the WebView2 child fills the client area.
    protected override CreateParams CreateParams
    {
        get
        {
            const int WS_THICKFRAME = 0x00040000;
            const int WS_MINIMIZEBOX = 0x00020000;
            const int WS_MAXIMIZEBOX = 0x00010000;
            const int WS_SYSMENU = 0x00080000;
            var cp = base.CreateParams;
            cp.Style |= WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Win11 polish: dark frame + rounded outer corners. Silently ignored on
        // older Windows (e.g. Server 2019 / Win10), so it's safe to always try.
        try
        {
            int dark = 1;
            DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
            int round = DWMWCP_ROUND;
            DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));
        }
        catch { /* dwmapi unavailable */ }
    }

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void WndProc(ref Message m)
    {
        const int WM_GETMINMAXINFO = 0x0024;
        // A frameless WS_THICKFRAME window maximizes a few pixels past the work
        // area; clamp it so a maximized window doesn't cover the taskbar.
        if (m.Msg == WM_GETMINMAXINFO)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(m.LParam);
            var scr = Screen.FromHandle(Handle);
            mmi.ptMaxPosition = new POINT { x = scr.WorkingArea.Left - scr.Bounds.Left, y = scr.WorkingArea.Top - scr.Bounds.Top };
            mmi.ptMaxSize = new POINT { x = scr.WorkingArea.Width, y = scr.WorkingArea.Height };
            mmi.ptMinTrackSize = new POINT { x = MinimumSize.Width, y = MinimumSize.Height };
            Marshal.StructureToPtr(mmi, m.LParam, true);
            m.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref m);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        PostWindowState();
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string action;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            if (!root.TryGetProperty("type", out var type) || type.GetString() != "window") return;
            if (!root.TryGetProperty("action", out var act)) return;
            action = act.GetString() ?? "";
        }
        catch { return; }

        switch (action)
        {
            case "minimize": WindowState = FormWindowState.Minimized; break;
            case "maximize":
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal : FormWindowState.Maximized;
                break;
            case "close": Close(); break;       // hides to the tray (see OnFormClosing)
            case "state": PostWindowState(); break;
        }
    }

    private void PostWindowState()
    {
        if (!_coreReady) return;
        var maximized = WindowState == FormWindowState.Maximized ? "true" : "false";
        try { _web.CoreWebView2.PostWebMessageAsJson($"{{\"type\":\"window-state\",\"maximized\":{maximized}}}"); }
        catch { /* page not ready yet */ }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize;
    }
}
