using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Windows.Forms;

namespace AttendanceLauncher;

internal static class Program
{
    private static readonly string AppName = "Attendance Platform";
    private static readonly string AppVersion = "2.0.0";

    private static readonly int BackendPort = 8000;
    private static readonly string UiDomain = "attendance.local";

    private static readonly string BackendUrl = $"http://127.0.0.1:{BackendPort}";
    private static readonly string UiUrl = $"http://{UiDomain}";

    private static Process? _backendProc;
    private static Process? _uiProc;

    private static NotifyIcon? _tray;
    private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    private static System.Windows.Forms.Timer? _healthTimer;

    private static ToolStripMenuItem? _headerItem;
    private static ToolStripMenuItem? _backendStatusItem;
    private static ToolStripMenuItem? _nginxStatusItem;
    private static ToolStripMenuItem? _startItem;
    private static ToolStripMenuItem? _stopItem;
    private static ToolStripMenuItem? _restartItem;
    private static ToolStripMenuItem? _openUiItem;

    private enum ServiceState { Stopped, Starting, Running, Error }

    private static ServiceState _backendState = ServiceState.Stopped;
    private static ServiceState _nginxState = ServiceState.Stopped;

    [STAThread]
    public static void Main()
    {
        ApplicationConfiguration.Initialize();

        _tray = new NotifyIcon
        {
            Text = AppName,
            Visible = true,
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            ContextMenuStrip = BuildMenu(),
        };

        _tray.DoubleClick += (_, _) => OpenUi();

        _healthTimer = new System.Windows.Forms.Timer { Interval = 5_000 };
        _healthTimer.Tick += async (_, _) => await RefreshServiceStatusAsync();
        _healthTimer.Start();

        Application.ApplicationExit += (_, _) =>
        {
            _healthTimer?.Stop();
            try { StopAll(); } catch { /* ignore */ }
            try { _tray!.Visible = false; _tray.Dispose(); } catch { /* ignore */ }
        };

        Application.Run();
    }

    private static ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Renderer = new ProfessionalMenuRenderer();

        _headerItem = new ToolStripMenuItem($"  {AppName}  v{AppVersion}")
        {
            Enabled = false,
            Font = new Font(menu.Font, FontStyle.Bold),
        };
        menu.Items.Add(_headerItem);
        menu.Items.Add(new ToolStripSeparator());

        _backendStatusItem = MakeStatusItem("Backend + AI (Python)", ServiceState.Stopped);
        _nginxStatusItem = MakeStatusItem("Web Server (nginx)", ServiceState.Stopped);

        menu.Items.Add(_backendStatusItem);
        menu.Items.Add(_nginxStatusItem);
        menu.Items.Add(new ToolStripSeparator());

        _startItem = new ToolStripMenuItem("▶  Start All", null, async (_, _) => await StartAllAsync());
        _stopItem = new ToolStripMenuItem("■  Stop All", null, (_, _) => StopAll());
        _restartItem = new ToolStripMenuItem("⟳  Restart All", null, async (_, _) =>
        {
            StopAll();
            await StartAllAsync();
        });

        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(_restartItem);
        menu.Items.Add(new ToolStripSeparator());

        _openUiItem = new ToolStripMenuItem($"🌐  Open UI  ({UiDomain})", null, (_, _) => OpenUi());
        menu.Items.Add(_openUiItem);
        menu.Items.Add(new ToolStripMenuItem("📂  Open Logs Folder", null, (_, _) => OpenLogsFolder()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => Application.Exit()));

        UpdateMenuState();
        return menu;
    }

    private static ToolStripMenuItem MakeStatusItem(string label, ServiceState state)
    {
        return new ToolStripMenuItem(FormatStatusLabel(label, state)) { Enabled = false };
    }

    private static string FormatStatusLabel(string label, ServiceState state)
    {
        var (indicator, status) = state switch
        {
            ServiceState.Running  => ("●", "Running"),
            ServiceState.Starting => ("◐", "Starting..."),
            ServiceState.Error    => ("●", "Error"),
            _                     => ("○", "Stopped"),
        };
        return $"  {indicator}  {label}  —  {status}";
    }

    private static void SetServiceState(ref ServiceState field, ServiceState value,
        ToolStripMenuItem? item, string label)
    {
        field = value;
        if (item != null)
            item.Text = FormatStatusLabel(label, value);
    }

    private static void UpdateMenuState()
    {
        bool anyRunning = IsAlive(_backendProc) || IsAlive(_uiProc);
        bool allStopped = !IsAlive(_backendProc) && !IsAlive(_uiProc);

        if (_startItem != null)  _startItem.Enabled = allStopped;
        if (_stopItem != null)   _stopItem.Enabled = anyRunning;
        if (_restartItem != null) _restartItem.Enabled = anyRunning;

        UpdateTrayTooltip();
    }

    private static void UpdateTrayTooltip()
    {
        if (_tray == null) return;
        int running = 0;
        int total = 2;
        if (_backendState == ServiceState.Running) running++;
        if (_nginxState == ServiceState.Running) running++;

        var tooltip = $"{AppName}\n{running}/{total} services running";
        _tray.Text = tooltip.Length > 63 ? tooltip[..63] : tooltip;
    }

    private static bool IsAlive(Process? p) => p != null && !p.HasExited;

    private static async Task RefreshServiceStatusAsync()
    {
        var backendAlive = IsAlive(_backendProc);
        var nginxAlive = IsAlive(_uiProc);

        var backendOk = backendAlive ? await CheckHttpAsync($"{BackendUrl}/up") : false;
        var nginxOk = nginxAlive ? await CheckHttpAsync($"{UiUrl}/") : false;

        SetServiceState(ref _backendState,
            !backendAlive ? ServiceState.Stopped : backendOk ? ServiceState.Running : ServiceState.Starting,
            _backendStatusItem, "Backend + AI (Python)");

        SetServiceState(ref _nginxState,
            !nginxAlive ? ServiceState.Stopped : nginxOk ? ServiceState.Running : ServiceState.Starting,
            _nginxStatusItem, "Web Server (nginx)");

        UpdateMenuState();
    }

    private static async Task<bool> CheckHttpAsync(string url)
    {
        try
        {
            using var resp = await _http.GetAsync(url);
            return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 400;
        }
        catch { return false; }
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────

    private static string InstallRoot()
    {
        var exeDir = AppContext.BaseDirectory;
        return Path.GetFullPath(Path.Combine(exeDir, ".."));
    }

    private static string LogsDir()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AttendancePlatform",
            "logs"
        );
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void OpenLogsFolder()
    {
        Process.Start(new ProcessStartInfo { FileName = LogsDir(), UseShellExecute = true });
    }

    private static async Task StartAllAsync()
    {
        _startItem!.Enabled = false;

        var root = InstallRoot();
        var logs = LogsDir();

        var bundledPython = Path.Combine(root, "windows", "runtime", "python", "python.exe");
        var venvPython = Path.Combine(root, "backend", ".venv", "Scripts", "python.exe");
        var pythonExe = File.Exists(bundledPython) ? bundledPython : venvPython;

        if (!File.Exists(pythonExe))
        {
            SetServiceState(ref _backendState, ServiceState.Error, _backendStatusItem, "Backend + AI (Python)");
            UpdateMenuState();
            return;
        }

        // Single Python backend (merged backend + AI)
        if (!IsAlive(_backendProc))
        {
            SetServiceState(ref _backendState, ServiceState.Starting, _backendStatusItem, "Backend + AI (Python)");
            try
            {
                _backendProc = StartProcess(
                    workingDir: Path.Combine(root, "backend"),
                    fileName: pythonExe,
                    arguments: $"-m uvicorn main:app --host 127.0.0.1 --port {BackendPort}",
                    stdoutPath: Path.Combine(logs, "backend.stdout.log"),
                    stderrPath: Path.Combine(logs, "backend.stderr.log")
                );
            }
            catch
            {
                SetServiceState(ref _backendState, ServiceState.Error, _backendStatusItem, "Backend + AI (Python)");
            }
        }

        // Nginx
        if (!IsAlive(_uiProc))
        {
            SetServiceState(ref _nginxState, ServiceState.Starting, _nginxStatusItem, "Web Server (nginx)");

            var nginxDir = Path.Combine(root, "windows", "runtime", "nginx");
            var nginxExe = Path.Combine(nginxDir, "nginx.exe");
            var nginxConf = Path.Combine(nginxDir, "conf", "nginx.conf");

            if (!File.Exists(nginxExe))
            {
                SetServiceState(ref _nginxState, ServiceState.Error, _nginxStatusItem, "Web Server (nginx)");
                UpdateMenuState();
                return;
            }

            if (!File.Exists(nginxConf))
            {
                try
                {
                    var genScript = Path.Combine(root, "windows", "scripts", "generate_nginx_conf.ps1");
                    if (File.Exists(genScript))
                    {
                        var gen = Process.Start(new ProcessStartInfo
                        {
                            FileName = "powershell.exe",
                            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{genScript}\" -InstallRoot \"{root}\"",
                            CreateNoWindow = true,
                            UseShellExecute = false,
                        });
                        gen?.WaitForExit(10_000);
                    }
                }
                catch { /* best-effort */ }
            }

            try
            {
                _uiProc = StartProcess(
                    workingDir: nginxDir,
                    fileName: nginxExe,
                    arguments: $"-c \"{nginxConf}\"",
                    stdoutPath: Path.Combine(logs, "ui.stdout.log"),
                    stderrPath: Path.Combine(logs, "ui.stderr.log")
                );
            }
            catch
            {
                SetServiceState(ref _nginxState, ServiceState.Error, _nginxStatusItem, "Web Server (nginx)");
            }
        }

        UpdateMenuState();

        var okBackend = await WaitHttpOkAsync($"{BackendUrl}/up", timeoutMs: 90_000);
        var okUi = await WaitHttpOkAsync($"{UiUrl}/", timeoutMs: 60_000);

        SetServiceState(ref _backendState,
            okBackend ? ServiceState.Running : ServiceState.Error,
            _backendStatusItem, "Backend + AI (Python)");
        SetServiceState(ref _nginxState,
            okUi ? ServiceState.Running : ServiceState.Error,
            _nginxStatusItem, "Web Server (nginx)");

        UpdateMenuState();

        if (okBackend && okUi)
            OpenUi();
    }

    private static void StopAll()
    {
        StopNginx();
        StopProcess(_backendProc); _backendProc = null;

        SetServiceState(ref _backendState, ServiceState.Stopped, _backendStatusItem, "Backend + AI (Python)");
        SetServiceState(ref _nginxState, ServiceState.Stopped, _nginxStatusItem, "Web Server (nginx)");
        UpdateMenuState();
    }

    private static void StopNginx()
    {
        if (_uiProc == null) return;
        try
        {
            if (!_uiProc.HasExited)
            {
                var nginxExe = _uiProc.StartInfo.FileName;
                var nginxConf = "";
                var args = _uiProc.StartInfo.Arguments;
                var cIdx = args.IndexOf("-c ");
                if (cIdx >= 0)
                    nginxConf = args[(cIdx + 3)..].Trim().Trim('"');

                if (!string.IsNullOrEmpty(nginxConf))
                {
                    var stop = Process.Start(new ProcessStartInfo
                    {
                        FileName = nginxExe,
                        Arguments = $"-c \"{nginxConf}\" -s quit",
                        CreateNoWindow = true,
                        UseShellExecute = false,
                    });
                    stop?.WaitForExit(5_000);
                }

                if (!_uiProc.HasExited)
                    _uiProc.Kill(entireProcessTree: true);

                _uiProc.WaitForExit(3_000);
            }
        }
        catch { /* ignore */ }
        _uiProc = null;
    }

    private static void OpenUi()
    {
        Process.Start(new ProcessStartInfo { FileName = UiUrl, UseShellExecute = true });
    }

    // ─── Process helpers ────────────────────────────────────────────────

    private static void StopProcess(Process? p)
    {
        if (p == null) return;
        try
        {
            if (!p.HasExited)
            {
                p.Kill(entireProcessTree: true);
                p.WaitForExit(5_000);
            }
        }
        catch { /* ignore */ }
    }

    private static Process StartProcess(
        string workingDir, string fileName, string arguments,
        string stdoutPath, string stderrPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(stdoutPath)!);
        var psi = new ProcessStartInfo
        {
            WorkingDirectory = workingDir,
            FileName = fileName,
            Arguments = arguments,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        p.Start();

        _ = PumpToFileAsync(p.StandardOutput, stdoutPath);
        _ = PumpToFileAsync(p.StandardError, stderrPath);

        return p;
    }

    private static async Task PumpToFileAsync(StreamReader reader, string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            using var sw = new StreamWriter(fs, Encoding.UTF8) { AutoFlush = true };
            while (true)
            {
                var line = await reader.ReadLineAsync();
                if (line == null) break;
                await sw.WriteLineAsync($"[{DateTimeOffset.Now:O}] {line}");
            }
        }
        catch { /* ignore */ }
    }

    private static async Task<bool> WaitHttpOkAsync(string url, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                using var resp = await _http.GetAsync(url);
                if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300)
                    return true;
            }
            catch { /* retry */ }
            await Task.Delay(1_000);
        }
        return false;
    }

    private class ProfessionalMenuRenderer : ToolStripProfessionalRenderer
    {
        public ProfessionalMenuRenderer()
            : base(new ProfessionalMenuColors()) { }
    }

    private class ProfessionalMenuColors : ProfessionalColorTable
    {
        public override Color MenuItemSelected => Color.FromArgb(230, 240, 250);
        public override Color MenuItemBorder => Color.FromArgb(180, 200, 220);
        public override Color ToolStripDropDownBackground => Color.White;
        public override Color ImageMarginGradientBegin => Color.White;
        public override Color ImageMarginGradientMiddle => Color.White;
        public override Color ImageMarginGradientEnd => Color.White;
        public override Color SeparatorDark => Color.FromArgb(220, 225, 230);
        public override Color SeparatorLight => Color.White;
    }
}
