# Installing the Attendance Platform on Windows (offline)

`AttendancePlatformSetup.exe` is a self-contained, **offline** installer. The
target PC needs **no internet connection** — Python, PostgreSQL, nginx, all
dependencies, and the face-recognition models are included.

## Requirements

- Windows 10/11 or Windows Server 2019+ (**64-bit**)
- Administrator rights (to install into Program Files and register the database service)
- ~3 GB free disk space
- Free TCP ports: **8080** (web UI), **18000** (local API, loopback-only behind nginx), **15432** (PostgreSQL — non-default to avoid clashes), **6379** (Redis)

## Install

1. Double-click **`AttendancePlatformSetup.exe`** and accept the elevation prompt.
2. Choose the install location (default `C:\Program Files\AttendancePlatform`).
3. Pick optional tasks: desktop shortcut, start-on-boot.
4. Click **Install**. After files are copied, setup runs a one-time configuration
   (installs Python, creates the virtual environment from the bundled wheels,
   initializes PostgreSQL, runs migrations, seeds the admin account, writes the
   nginx config). **This can take several minutes** — please wait.
5. On finish, the tray launcher starts automatically.

## Running it

A tray icon (system notification area) controls everything. Right-click it:

| Menu item | Action |
|-----------|--------|
| **Open UI** | Opens `http://localhost:8080` in your browser (also: double-click the tray icon) |
| **Start** / **Stop** | Start or stop the backend + web server |
| **View logs** | Opens `%ProgramData%\AttendancePlatform\logs` |
| **Quit** | Stops the app and exits the launcher |

PostgreSQL (**AttendancePostgres**) and Redis/Memurai (**Memurai**) run as Windows
services and start on boot. The backend (uvicorn on loopback port 18000, reached
only through nginx), the Celery worker + beat (background jobs), and nginx
(port 8080) are started/stopped by the tray app.

> Redis-on-Windows is provided by **Memurai**. The bundled **Developer** Edition
> is for development/testing; production use requires a **Memurai Enterprise**
> license (see WINDOWS_BUILD.md to bundle the Enterprise MSI).

## First run

The first time you open the app it runs a short setup wizard that creates the
database schema and your administrator account. Open the UI and follow it:

1. Browse to `http://localhost:8080` (the installer also shows this when it finishes).
2. The wizard initializes the database, then asks for your organization name and
   the first administrator's name, email, and password.
3. Sign in with the email and password you just chose.

> There is no default login - you choose the administrator credentials in the
> wizard. The account created there is a platform super-admin.

## Where things live

```
C:\Program Files\AttendancePlatform\        # application + bundled runtimes
C:\ProgramData\AttendancePlatform\
├─ pgdata\                                   # PostgreSQL database files
├─ appdata\                                  # FAISS index, uploads, snapshots, beat schedule
├─ FIRST_RUN.txt                             # first-run setup instructions (delete after setup)
└─ logs\                                     # install, uvicorn, celery-worker, celery-beat, nginx, postgres, redis
```

## Uninstall

Use **Settings → Apps** or the Start Menu **Uninstall** shortcut. During
uninstall you'll be asked whether to **also delete all attendance data and the
database**:

- **No** (default) — keeps `C:\ProgramData\AttendancePlatform\pgdata` so a future
  reinstall keeps your data.
- **Yes** — removes the database and all runtime data permanently.

## Troubleshooting

- **UI won't open / "can't reach this page"** — give it a minute after first
  launch (models load on first use). Check **View logs → uvicorn.log**.
- **Port already in use** — another app is using 8080/18000/15432/6379. Stop it, or ask
  your administrator to change the ports (the values live in
  `…\AttendancePlatform\scripts\common.ps1`, the launcher, and the generated
  `nginx\conf\nginx.conf`).
- **Face recognition seems slow on the first scan** — the InsightFace model loads
  into memory once per backend start; subsequent recognitions are fast.
- **Setup failed during install** — open
  `%ProgramData%\AttendancePlatform\logs\install.log`; it records each step.
