using System.Diagnostics;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;

namespace AttendanceLauncher;

/// <summary>
/// System-tray launcher for the Attendance Platform. Starts/stops the PostgreSQL
/// and Redis (Memurai) services, the uvicorn API, the Celery worker + beat, and
/// nginx; shows a live status of each service; and opens the UI in its own
/// desktop window (an embedded WebView2), falling back to the browser when no
/// WebView2 runtime is present.
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, "AttendancePlatformLauncher", out bool isNew);
        if (!isNew) return;

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp());
    }
}

internal sealed class TrayApp : ApplicationContext
{
    private const string PgService = "AttendancePostgres";
    private const string RedisService = "Memurai";
    // Must match common.ps1. uvicorn + Postgres use non-default ports to avoid
    // colliding with other services the machine may already run.
    private const int ApiPort = 18000;
    private const int NginxPort = 8080;
    private const int PgPort = 15432;
    private const int RedisPort = 6379;
    private static readonly string UiUrl = $"http://localhost:{NginxPort}";

    private readonly string _appDir;
    private readonly string _backendDir;
    private readonly string _pythonExe;
    private readonly string _nginxDir;
    private readonly string _nginxExe;
    private readonly string _insightfaceHome;
    private readonly string _logDir;

    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly System.Windows.Forms.Timer _statusTimer;
    private readonly System.Windows.Forms.Timer _openTimer;

    private MainWindow? _window;
    private bool _webViewChecked;
    private bool _webViewAvailable;
    private bool _browserFallbackNotified;

    private readonly Dictionary<string, Process> _procs = new();
    private readonly List<Service> _services = new();
    private readonly Image _dotUp;
    private readonly Image _dotDown;
    private readonly Icon _icon;

    private sealed class Service
    {
        public required string Name;
        public required ToolStripMenuItem Item;
        public required Func<bool> Probe;
        public string? LogFile;
        public bool Up;
    }

    public TrayApp()
    {
        _appDir = AppContext.BaseDirectory.TrimEnd('\\');
        _backendDir = Path.Combine(_appDir, "backend");
        _pythonExe = Path.Combine(_appDir, "python", "python.exe");
        _nginxDir = Path.Combine(_appDir, "nginx");
        _nginxExe = Path.Combine(_nginxDir, "nginx.exe");
        _insightfaceHome = Path.Combine(_appDir, "models", "insightface");
        _logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "AttendancePlatform", "logs");
        Directory.CreateDirectory(_logDir);

        _dotUp = MakeDot(Color.FromArgb(34, 197, 94));    // green
        _dotDown = MakeDot(Color.FromArgb(148, 163, 184)); // slate-gray
        _icon = LoadIcon();

        var menu = new ContextMenuStrip { ShowImageMargin = true };

        var header = new ToolStripMenuItem("Attendance Platform") { Enabled = false };
        header.Font = new Font(header.Font, FontStyle.Bold);
        menu.Items.Add(header);
        menu.Items.Add(new ToolStripSeparator());

        // Live service rows (click a row to open that service's log).
        AddService(menu, "Database (PostgreSQL)", () => TcpUp(PgPort), "postgres-init.log");
        AddService(menu, "Cache (Redis / Memurai)", () => TcpUp(RedisPort), null);
        AddService(menu, "API server", () => TcpUp(ApiPort), "uvicorn.log");
        AddService(menu, "Background worker (Celery)", () => ProcUp("celery-worker"), "celery-worker.log");
        AddService(menu, "Scheduler (Celery beat)", () => ProcUp("celery-beat"), "celery-beat.log");
        AddService(menu, "Web server (nginx)", () => TcpUp(NginxPort), "nginx-error.log");

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Open UI", null, (_, _) => OpenUi()) { Font = new Font(menu.Font, FontStyle.Bold) });
        _startItem = new ToolStripMenuItem("Start", null, (_, _) => StartAll());
        _stopItem = new ToolStripMenuItem("Stop", null, (_, _) => StopAll());
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripMenuItem("View logs", null, (_, _) => OpenLogs()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => Quit()));

        _tray = new NotifyIcon
        {
            Icon = _icon,
            Text = "Attendance Platform",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => OpenUi();

        _statusTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _statusTimer.Tick += async (_, _) => await RefreshStatusAsync();
        _statusTimer.Start();

        StartAll();

        // Open the app window shortly after the message loop starts (showing a
        // form before Application.Run is unreliable). It displays a splash and
        // navigates once the web server is reachable.
        _openTimer = new System.Windows.Forms.Timer { Interval = 150 };
        _openTimer.Tick += (_, _) => { _openTimer.Stop(); OpenUi(); };
        _openTimer.Start();
    }

    private void AddService(ContextMenuStrip menu, string name, Func<bool> probe, string? logFile)
    {
        var item = new ToolStripMenuItem(name) { Image = _dotDown };
        if (logFile != null) item.Click += (_, _) => OpenLogFile(logFile);
        var svc = new Service { Name = name, Item = item, Probe = probe, LogFile = logFile };
        _services.Add(svc);
        menu.Items.Add(item);
    }

    private Icon LoadIcon()
    {
        var ico = Path.Combine(_appDir, "app.ico");
        try { if (File.Exists(ico)) return new Icon(ico); } catch { /* fall through */ }
        return SystemIcons.Application;
    }

    private static Image MakeDot(Color color)
    {
        var bmp = new Bitmap(12, 12);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var b = new SolidBrush(color);
        g.FillEllipse(b, 1, 1, 9, 9);
        using var pen = new Pen(Color.FromArgb(60, 0, 0, 0));
        g.DrawEllipse(pen, 1, 1, 9, 9);
        return bmp;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    private void StartAll()
    {
        try
        {
            EnsureService(PgService);
            EnsureService(RedisService);
            StartBackend();
            StartNginx();
        }
        catch (Exception ex)
        {
            Log("launcher", $"StartAll failed: {ex}");
            _tray.ShowBalloonTip(5000, "Attendance Platform", "Failed to start: " + ex.Message, ToolTipIcon.Error);
        }
    }

    private void StopAll()
    {
        StopNginx();
        StopBackend();
        // Also stop the PostgreSQL + Redis Windows services so "Stop" means
        // everything is off (needs admin rights to stop a service).
        StopService(RedisService);
        StopService(PgService);
    }

    private static void EnsureService(string name) => RunQuiet("sc.exe", $"start {name}");

    private static void StopService(string name) => RunQuiet("sc.exe", $"stop {name}");

    private void StartBackend()
    {
        if (_procs.Values.Any(p => !p.HasExited)) return;
        if (!File.Exists(_pythonExe))
            throw new FileNotFoundException("Backend python not found", _pythonExe);

        var beatSchedule = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "AttendancePlatform", "appdata", "celerybeat-schedule");

        // uvicorn API + Celery worker (solo pool: prefork is unsupported on
        // Windows) + Celery beat. All import the app package from the backend dir.
        StartPyProcess("uvicorn", $"-m uvicorn main:app --host 127.0.0.1 --port {ApiPort}");
        StartPyProcess("celery-worker", "-m celery -A app.celery_app.celery_app worker --loglevel=info --pool=solo");
        StartPyProcess("celery-beat", $"-m celery -A app.celery_app.celery_app beat --loglevel=info --schedule \"{beatSchedule}\"");
    }

    private void StartPyProcess(string label, string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _pythonExe,
            Arguments = args,
            WorkingDirectory = _backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment["INSIGHTFACE_HOME"] = _insightfaceHome;

        var log = Path.Combine(_logDir, label + ".log");
        var writer = new StreamWriter(new FileStream(log, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) writer.WriteLine(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) writer.WriteLine(e.Data); };
        proc.Exited += (_, _) => { try { writer.Dispose(); } catch { } };
        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        _procs[label] = proc;
        Log("launcher", label + " started");
    }

    private void StopBackend()
    {
        foreach (var p in _procs.Values)
        {
            try { if (!p.HasExited) { p.Kill(entireProcessTree: true); p.WaitForExit(5000); } }
            catch (Exception ex) { Log("launcher", "StopBackend: " + ex.Message); }
        }
        _procs.Clear();
    }

    private void StartNginx()
    {
        if (!File.Exists(_nginxExe)) throw new FileNotFoundException("nginx not found", _nginxExe);
        StopNginx(); // avoid stacking masters
        var psi = new ProcessStartInfo
        {
            FileName = _nginxExe,
            Arguments = $"-p \"{_nginxDir}\" -c conf\\nginx.conf",
            WorkingDirectory = _nginxDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(psi);
        Log("launcher", "nginx started");
    }

    private void StopNginx()
    {
        if (!File.Exists(_nginxExe)) return;
        RunQuiet(_nginxExe, $"-p \"{_nginxDir}\" -c conf\\nginx.conf -s stop", _nginxDir);
        foreach (var p in Process.GetProcessesByName("nginx"))
        {
            try { p.Kill(); } catch { /* ignore */ }
        }
    }

    // ── Status ───────────────────────────────────────────────────────────────
    private async Task RefreshStatusAsync()
    {
        // Probe off the UI thread (TCP connects can block briefly), then update UI.
        var states = await Task.Run(() => _services.Select(s => s.Probe()).ToArray());

        int up = 0;
        for (int i = 0; i < _services.Count; i++)
        {
            var s = _services[i];
            s.Up = states[i];
            if (s.Up) up++;
            s.Item.Image = s.Up ? _dotUp : _dotDown;
            s.Item.Text = $"{s.Name}{(s.Up ? "" : "  —  stopped")}";
        }

        bool allUp = up == _services.Count;
        _tray.Text = Truncate($"Attendance Platform — {up}/{_services.Count} services up", 63);
        _startItem.Enabled = !allUp;
        _stopItem.Enabled = up > 0;
    }

    private static bool TcpUp(int port)
    {
        try
        {
            using var c = new TcpClient();
            var ar = c.BeginConnect("127.0.0.1", port, null, null);
            if (!ar.AsyncWaitHandle.WaitOne(350)) return false;
            c.EndConnect(ar);
            return true;
        }
        catch { return false; }
    }

    private bool ProcUp(string label) => _procs.TryGetValue(label, out var p) && !p.HasExited;

    // ── UI helpers ─────────────────────────────────────────────────────────
    private void OpenUi()
    {
        if (!WebViewAvailable())
        {
            if (!_browserFallbackNotified)
            {
                _browserFallbackNotified = true;
                _tray.ShowBalloonTip(5000, "Attendance Platform",
                    "WebView2 runtime not found - opening the UI in your browser instead.",
                    ToolTipIcon.Info);
            }
            OpenInBrowser();
            return;
        }
        try
        {
            if (_window == null || _window.IsDisposed)
                _window = new MainWindow(_appDir, NginxPort, _icon, Log);
            _window.Show();
            if (_window.WindowState == FormWindowState.Minimized)
                _window.WindowState = FormWindowState.Normal;
            _window.Activate();
            _window.BringToFront();
        }
        catch (Exception ex)
        {
            Log("launcher", "OpenUi failed; falling back to browser: " + ex);
            OpenInBrowser();
        }
    }

    private void OpenInBrowser() => Process.Start(new ProcessStartInfo(UiUrl) { UseShellExecute = true });

    /// <summary>Is a WebView2 runtime (bundled or system) available to host the window?</summary>
    private bool WebViewAvailable()
    {
        if (_webViewChecked) return _webViewAvailable;
        _webViewChecked = true;
        try
        {
            var ver = CoreWebView2Environment.GetAvailableBrowserVersionString(
                MainWindow.BundledRuntimeFolder(_appDir));
            _webViewAvailable = !string.IsNullOrEmpty(ver);
            Log("launcher", "WebView2 runtime: " + (ver ?? "not found"));
        }
        catch (Exception ex)
        {
            _webViewAvailable = false;
            Log("launcher", "WebView2 runtime check failed: " + ex.Message);
        }
        return _webViewAvailable;
    }

    private void OpenLogs() => Process.Start(new ProcessStartInfo(_logDir) { UseShellExecute = true });

    private void OpenLogFile(string fileName)
    {
        var path = Path.Combine(_logDir, fileName);
        var target = File.Exists(path) ? path : _logDir;
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }

    private void Quit()
    {
        _statusTimer.Stop();
        _openTimer.Stop();
        _window?.ExitApp();
        StopAll();
        _tray.Visible = false;
        ExitThread();
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max);

    // ── Process utilities ────────────────────────────────────────────────────
    private static void RunQuiet(string file, string args, string? cwd = null)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            if (cwd != null) psi.WorkingDirectory = cwd;
            using var p = Process.Start(psi);
            p?.WaitForExit(15000);
        }
        catch { /* best effort */ }
    }

    private void Log(string name, string msg)
    {
        try
        {
            File.AppendAllText(Path.Combine(_logDir, name + ".log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }
}
