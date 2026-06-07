using System.Diagnostics;
using System.Net.Http;

namespace AttendanceLauncher;

/// <summary>
/// System-tray launcher for the Attendance Platform. Ensures the PostgreSQL
/// service is running, starts/stops the uvicorn backend and nginx front, and
/// opens the browser UI. The installed layout is:
///   &lt;AppDir&gt;\AttendanceLauncher.exe   (this exe)
///   &lt;AppDir&gt;\backend\.venv\Scripts\python.exe
///   &lt;AppDir&gt;\nginx\nginx.exe
///   &lt;AppDir&gt;\models\insightface       (INSIGHTFACE_HOME)
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // Single instance: if already running, just exit.
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
    private const int ApiPort = 8000;
    private const int NginxPort = 8080;
    private static readonly string UiUrl = $"http://localhost:{NginxPort}";
    private static readonly string HealthUrl = $"http://127.0.0.1:{ApiPort}/up";

    private readonly string _appDir;
    private readonly string _backendDir;
    private readonly string _venvPython;
    private readonly string _nginxDir;
    private readonly string _nginxExe;
    private readonly string _insightfaceHome;
    private readonly string _logDir;

    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly System.Windows.Forms.Timer _healthTimer;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };

    private readonly List<Process> _managed = new();
    private bool _backendUp;

    public TrayApp()
    {
        _appDir = AppContext.BaseDirectory.TrimEnd('\\');
        _backendDir = Path.Combine(_appDir, "backend");
        // Bundled embeddable Python (packages live in its Lib\site-packages).
        _venvPython = Path.Combine(_appDir, "python", "python.exe");
        _nginxDir = Path.Combine(_appDir, "nginx");
        _nginxExe = Path.Combine(_nginxDir, "nginx.exe");
        _insightfaceHome = Path.Combine(_appDir, "models", "insightface");
        _logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "AttendancePlatform", "logs");
        Directory.CreateDirectory(_logDir);

        var menu = new ContextMenuStrip();
        _statusItem = new ToolStripMenuItem("Starting…") { Enabled = false };
        _startItem = new ToolStripMenuItem("Start", null, (_, _) => StartAll());
        _stopItem = new ToolStripMenuItem("Stop", null, (_, _) => StopAll());
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Open UI", null, (_, _) => OpenUi()));
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripMenuItem("View logs", null, (_, _) => OpenLogs()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => Quit()));

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "Attendance Platform",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => OpenUi();

        _healthTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _healthTimer.Tick += async (_, _) => await PollHealthAsync();
        _healthTimer.Start();

        StartAll();
    }

    private Icon LoadIcon()
    {
        var ico = Path.Combine(_appDir, "app.ico");
        try { if (File.Exists(ico)) return new Icon(ico); } catch { /* fall through */ }
        return SystemIcons.Application;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────
    private void StartAll()
    {
        try
        {
            EnsurePostgres();
            EnsureRedis();
            StartBackend();
            StartNginx();
            SetStatus("Running");
        }
        catch (Exception ex)
        {
            Log("launcher", $"StartAll failed: {ex}");
            _tray.ShowBalloonTip(5000, "Attendance Platform", "Failed to start: " + ex.Message, ToolTipIcon.Error);
            SetStatus("Error");
        }
    }

    private void StopAll()
    {
        StopNginx();
        StopBackend();
        // PostgreSQL stays running as a Windows service.
        SetStatus("Stopped");
    }

    private void EnsurePostgres() => RunQuiet("sc.exe", $"start {PgService}");

    private void EnsureRedis() => RunQuiet("sc.exe", $"start {RedisService}");

    private void StartBackend()
    {
        if (_managed.Any(p => !p.HasExited)) return;
        if (!File.Exists(_venvPython))
            throw new FileNotFoundException("Backend python not found", _venvPython);

        var beatSchedule = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "AttendancePlatform", "appdata", "celerybeat-schedule");

        // uvicorn API + Celery worker (solo pool: prefork is unsupported on
        // Windows) + Celery beat (periodic jobs). All import the app package, so
        // they run from the backend dir where .env lives.
        StartPyProcess("uvicorn", $"-m uvicorn main:app --host 127.0.0.1 --port {ApiPort}");
        StartPyProcess("celery-worker", "-m celery -A app.celery_app.celery_app worker --loglevel=info --pool=solo");
        StartPyProcess("celery-beat", $"-m celery -A app.celery_app.celery_app beat --loglevel=info --schedule \"{beatSchedule}\"");
    }

    private void StartPyProcess(string label, string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _venvPython,
            Arguments = args,
            WorkingDirectory = _backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        // InsightFace resolves models under %INSIGHTFACE_HOME%\models\buffalo_l.
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
        _managed.Add(proc);
        Log("launcher", label + " started");
    }

    private void StopBackend()
    {
        foreach (var p in _managed)
        {
            try { if (!p.HasExited) { p.Kill(entireProcessTree: true); p.WaitForExit(5000); } }
            catch (Exception ex) { Log("launcher", "StopBackend: " + ex.Message); }
        }
        _managed.Clear();
    }

    private void StartNginx()
    {
        if (!File.Exists(_nginxExe)) throw new FileNotFoundException("nginx not found", _nginxExe);
        // Avoid stacking masters: stop any prior instance first.
        StopNginx();
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
        // Fallback: kill any stragglers.
        foreach (var p in Process.GetProcessesByName("nginx"))
        {
            try { p.Kill(); } catch { /* ignore */ }
        }
    }

    // ── UI helpers ─────────────────────────────────────────────────────────
    private void OpenUi() => Process.Start(new ProcessStartInfo(UiUrl) { UseShellExecute = true });

    private void OpenLogs() => Process.Start(new ProcessStartInfo(_logDir) { UseShellExecute = true });

    private void Quit()
    {
        _healthTimer.Stop();
        StopAll();
        _tray.Visible = false;
        ExitThread();
    }

    private void SetStatus(string s)
    {
        _statusItem.Text = $"Status: {s}";
        _tray.Text = $"Attendance Platform — {s}";
    }

    private async Task PollHealthAsync()
    {
        bool up;
        try
        {
            using var resp = await _http.GetAsync(HealthUrl);
            up = resp.IsSuccessStatusCode;
        }
        catch { up = false; }

        if (up != _backendUp)
        {
            _backendUp = up;
            SetStatus(up ? "Running" : "Starting…");
            _startItem.Enabled = !up;
            _stopItem.Enabled = up;
        }
    }

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
