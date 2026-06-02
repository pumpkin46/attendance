using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace AttendanceLauncher;

internal static class Program
{
    private static readonly string AppName = "Attendance Platform";

    // Defaults aligned with repo docs and frontend/vite.config.ts
    private static readonly int BackendPort = 8000;
    private static readonly int AiPort = 8001;
    private static readonly int UiPort = 5173;

    private static readonly string BackendUrl = $"http://127.0.0.1:{BackendPort}";
    private static readonly string AiUrl = $"http://127.0.0.1:{AiPort}";
    private static readonly string UiUrl = $"http://127.0.0.1:{UiPort}";

    private static Process? _backendProc;
    private static Process? _aiProc;
    private static Process? _uiProc;

    private static NotifyIcon? _tray;
    private static readonly HttpClient _http = new HttpClient();

    [STAThread]
    public static void Main()
    {
        ApplicationConfiguration.Initialize();

        _tray = new NotifyIcon
        {
            Text = AppName,
            Visible = true,
            Icon = SystemIcons.Application,
            ContextMenuStrip = BuildMenu(),
        };

        _tray.DoubleClick += (_, _) => OpenUi();

        Application.ApplicationExit += (_, _) =>
        {
            try { StopAll(); } catch { /* ignore */ }
            try { _tray!.Visible = false; _tray.Dispose(); } catch { /* ignore */ }
        };

        Application.Run();
    }

    private static ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Start", null, async (_, _) => await StartAllAsync());
        menu.Items.Add("Stop", null, (_, _) => StopAll());
        menu.Items.Add("Restart", null, async (_, _) =>
        {
            StopAll();
            await StartAllAsync();
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open UI", null, (_, _) => OpenUi());
        menu.Items.Add("Open Logs Folder", null, (_, _) => OpenLogsFolder());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Application.Exit());
        return menu;
    }

    private static string InstallRoot()
    {
        // If run from install dir: ...\windows\launcher\...\bin\Release\net8.0-windows\
        // We want repository root at runtime bundle: two levels up from exe folder in packaged build.
        // For now (dev), assume this executable is placed under: <install>\launcher\AttendanceLauncher.exe
        var exeDir = AppContext.BaseDirectory;
        return Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", "..", "..", "..", ".."));
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
        var dir = LogsDir();
        Process.Start(new ProcessStartInfo
        {
            FileName = dir,
            UseShellExecute = true,
        });
    }

    private static void SetStatus(string status)
    {
        if (_tray == null) return;
        _tray.Text = $"{AppName} - {status}".Length > 63
            ? $"{AppName} - {status}"[..63]
            : $"{AppName} - {status}";
    }

    private static async Task StartAllAsync()
    {
        SetStatus("starting...");

        // NOTE: Postgres/Redis start/health-check will be added once installer decides how they are bundled.
        // For now we only start the three app processes and do best-effort health checks.

        var root = InstallRoot();
        var logs = LogsDir();

        // Start AI first
        if (_aiProc == null || _aiProc.HasExited)
        {
            _aiProc = StartProcess(
                workingDir: Path.Combine(root, "ai-service"),
                fileName: "cmd.exe",
                arguments: $"/c \"call .venv\\Scripts\\activate.bat && uvicorn main:app --host 127.0.0.1 --port {AiPort}\"",
                stdoutPath: Path.Combine(logs, "ai-service.stdout.log"),
                stderrPath: Path.Combine(logs, "ai-service.stderr.log")
            );
        }

        // Start backend
        if (_backendProc == null || _backendProc.HasExited)
        {
            _backendProc = StartProcess(
                workingDir: Path.Combine(root, "backend"),
                fileName: "cmd.exe",
                arguments: $"/c \"php artisan serve --host 127.0.0.1 --port {BackendPort}\"",
                stdoutPath: Path.Combine(logs, "backend.stdout.log"),
                stderrPath: Path.Combine(logs, "backend.stderr.log")
            );
        }

        // Start UI (static server)
        // Use the bundled Python (ai-service venv) to avoid relying on Node at runtime.
        if (_uiProc == null || _uiProc.HasExited)
        {
            var dist = Path.Combine(root, "frontend", "dist");
            _uiProc = StartProcess(
                workingDir: root,
                fileName: "cmd.exe",
                arguments: $"/c \"call ai-service\\.venv\\Scripts\\activate.bat && python -m http.server {UiPort} --bind 127.0.0.1 --directory \\\"{dist}\\\"\"",
                stdoutPath: Path.Combine(logs, "ui.stdout.log"),
                stderrPath: Path.Combine(logs, "ui.stderr.log")
            );
        }

        // Health checks (best-effort)
        var okAi = await WaitHttpOkAsync($"{AiUrl}/health", timeoutMs: 60_000);
        var okBackend = await WaitHttpOkAsync($"{BackendUrl}/up", timeoutMs: 60_000);
        var okUi = await WaitHttpOkAsync($"{UiUrl}/", timeoutMs: 60_000);

        if (okAi && okBackend && okUi)
        {
            SetStatus("running");
            OpenUi();
        }
        else
        {
            SetStatus("error (check logs)");
        }
    }

    private static void StopAll()
    {
        SetStatus("stopping...");
        StopProcess(_uiProc); _uiProc = null;
        StopProcess(_backendProc); _backendProc = null;
        StopProcess(_aiProc); _aiProc = null;
        SetStatus("stopped");
    }

    private static void OpenUi()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = UiUrl,
            UseShellExecute = true,
        });
    }

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
        string workingDir,
        string fileName,
        string arguments,
        string stdoutPath,
        string stderrPath
    )
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

        // async log pumps
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
        catch
        {
            // ignore
        }
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
            catch
            {
                // ignore and retry
            }
            await Task.Delay(1000);
        }
        return false;
    }
}

