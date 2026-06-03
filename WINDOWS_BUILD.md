# Windows app build guide

How to produce **AttendancePlatformSetup.exe** — the offline installer that ships the Attendance Platform tray app, web UI, backend, and optional bundled runtimes (PostgreSQL, Redis, Python, nginx).

For what the installer does on end-user machines, see [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md).

## What you are building

| Artifact | Description |
|----------|-------------|
| `AttendancePlatformSetup.exe` | Inno Setup installer (offline-capable) |
| `AttendanceLauncher.exe` | System-tray app (starts backend + nginx, opens UI) |

Default install location: `%ProgramFiles%\Attendance Platform\`

Installer output (after compile):

`windows/installer/inno/Output/AttendancePlatformSetup.exe`

## Build machine requirements

| Tool | Version / notes |
|------|-----------------|
| **Windows** | x64 (Windows 10/11 or Server 2016+) |
| **Node.js** | LTS recommended — only needed on the *build* machine to compile `frontend/dist` |
| **.NET SDK** | 8.0+ — builds the tray launcher |
| **Inno Setup** | 6 or 7 — provides `ISCC.exe` |
| **PowerShell** | 5.1+ (built into Windows) |
| **Git** | Clone this repo |

End users do **not** need Node.js or .NET; those are build-time only (except .NET runtime bundled inside the launcher).

## Repository layout (Windows packaging)

```
windows/
├── build-installer.ps1          # Builds launcher + compiles Inno Setup
├── launcher/                    # AttendanceLauncher (.NET tray app)
├── installer/
│   ├── inno/attendance.iss      # Inno Setup script
│   ├── scripts/                 # bootstrap, prereq install, migrations
│   └── prereqs/                 # Large binaries (not in git) — see below
└── launch-flow.md               # Runtime startup order
```

## Step 1 — Download offline prereqs

Prereq files are **gitignored** (too large for GitHub). Place them under `windows/installer/prereqs/` before compiling the installer.

| File | Path | Approx. size |
|------|------|--------------|
| PostgreSQL server zip | `postgresql/postgresql-server-windows-x64.zip` | ~42 MB |
| Python installer | `python/python-3.14.4-amd64.exe` | ~29 MB |
| Memurai (Redis) | `redis/memurai.msi` | ~9 MB |
| nginx | `nginx/nginx-1.30.2.zip` | ~3 MB |

**Total prereq payload:** ~85 MB (setup EXE compresses further with LZMA2).

### PostgreSQL (server only)

Do **not** use the ~350 MB EDB graphical installer. Build the slim server bundle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/installer/scripts/prepare_postgresql_prereq.ps1
```

This downloads [EDB PostgreSQL binaries](https://www.enterprisedb.com/download-postgresql-binaries) if needed, keeps only `bin`, `lib`, and `share`, and writes:

`windows/installer/prereqs/postgresql/postgresql-server-windows-x64.zip`

More detail: [windows/installer/prereqs/README.md](windows/installer/prereqs/README.md).

### Python

Download the Windows x64 installer from [python.org](https://www.python.org/downloads/windows/) and save as:

`windows/installer/prereqs/python/python-3.14.4-amd64.exe`

(Version must match the filename in `attendance.iss` or update the script.)

### Redis (Memurai)

Download [Memurai](https://www.memurai.com/) (Redis-compatible for Windows) MSI:

`windows/installer/prereqs/redis/memurai.msi`

### nginx

```powershell
$ver = "1.30.2"
$dest = "windows/installer/prereqs/nginx"
Invoke-WebRequest -Uri "https://nginx.org/download/nginx-$ver.zip" -OutFile "$dest/nginx-$ver.zip"
```

## Step 2 — Build the frontend

The installer serves prebuilt static files from `frontend/dist` (no Node on target PCs).

```powershell
cd frontend
npm ci
npm run build
cd ..
```

Confirm `frontend/dist/index.html` exists.

## Step 3 — Build the tray launcher

```powershell
dotnet build -c Release windows/launcher/AttendanceLauncher.sln
```

Output:

`windows/launcher/AttendanceLauncher/bin/Release/net8.0-windows/AttendanceLauncher.exe`

## Step 4 — Compile the installer

### Option A — One command (launcher + Inno Setup)

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1
```

If `ISCC.exe` is not on PATH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1 `
  -InnoSetupIsccPath "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```

Optional custom output directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1 -OutputDir "D:\dist"
```

`build-installer.ps1` does **not** run `npm run build` or download prereqs — run Steps 1–2 first.

### Option B — Inno Setup GUI

1. Complete Steps 1–3.
2. Open `windows/installer/inno/attendance.iss` in **Inno Setup Compiler**.
3. **Build → Compile**.

## Full build checklist (copy/paste order)

```powershell
# 1. Prereqs (PostgreSQL slim zip; download Python/Memurai/nginx manually if missing)
powershell -NoProfile -ExecutionPolicy Bypass -File windows/installer/scripts/prepare_postgresql_prereq.ps1

# 2. Frontend
cd frontend; npm ci; npm run build; cd ..

# 3. Launcher + installer
powershell -NoProfile -ExecutionPolicy Bypass -File windows/build-installer.ps1
```

## Verify the build

Before distributing `AttendancePlatformSetup.exe`:

1. **Prereqs present** — Inno compile fails if any required file under `windows/installer/prereqs/` is missing.
2. **`frontend/dist`** — exists and is recent.
3. **Launcher** — `AttendanceLauncher.exe` timestamp matches your Release build.
4. **Smoke test** — run the setup EXE on a clean VM or machine:
   - Select install tasks (PostgreSQL, Redis, Python) if services are not already running.
   - Confirm `bootstrap.log` under `{app}\logs\` has no errors.
   - Launch **Attendance Platform** from the Start Menu; browser opens `http://attendance.local`.
5. **Health** — `GET http://127.0.0.1:8000/api/v1/health` returns OK after the tray app starts services.

## Expected installer size

| Configuration | Approx. setup EXE size |
|---------------|-------------------------|
| All prereqs bundled (current default) | **~90–120 MB** |
| Legacy full PostgreSQL EDB installer | ~390 MB (deprecated) |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ISCC.exe` not found | Install [Inno Setup](https://jrsoftware.org/isinfo.php) or pass `-InnoSetupIsccPath` |
| Inno compile error on `[Files]` | Missing prereq under `windows/installer/prereqs/` — see Step 1 |
| UI blank after install | `frontend/dist` was not built before packaging |
| Bootstrap: PostgreSQL missing | Run `prepare_postgresql_prereq.ps1`; ensure `postgresql-server-windows-x64.zip` exists |
| Bootstrap: port 5432 / 6379 in use | Stop existing PostgreSQL/Redis or uncheck those install tasks |
| `dotnet build` fails | Install .NET 8 SDK |

Bootstrap log on an installed machine:

`%ProgramFiles%\Attendance Platform\logs\bootstrap.log`

## Related documentation

- [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md) — end-user install and runtime behavior
- [windows/installer/prereqs/README.md](windows/installer/prereqs/README.md) — prereq download details
- [windows/launch-flow.md](windows/launch-flow.md) — service startup order
- [windows/README.md](windows/README.md) — packaging overview
