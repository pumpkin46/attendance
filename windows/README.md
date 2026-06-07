# windows/ — offline Windows installer toolchain

Builds a single `AttendancePlatformSetup.exe` that installs the whole platform
(FastAPI backend + face recognition + React UI + PostgreSQL) on an **offline**
Windows PC. Nothing on the target needs internet.

## Layout

```
windows/
├─ build-installer.ps1            # one-command build orchestrator (run online)
├─ assets/
│  ├─ app-icon.png                # source icon
│  └─ app.ico                     # generated at build time (gitignored)
├─ installer/
│  ├─ fetch-prereqs.ps1           # download + normalize bundled binaries/models
│  ├─ inno/attendance.iss         # Inno Setup script
│  ├─ prereqs/                    # downloaded artifacts (gitignored)
│  │  ├─ python/  postgresql/  nginx/  models/  wheelhouse/
│  └─ scripts/                    # run on the TARGET at install/uninstall time
│     ├─ common.ps1               # shared paths, ports, logging
│     ├─ bootstrap.ps1            # post-install orchestrator
│     ├─ install_python.ps1
│     ├─ create_venv.ps1          # offline pip install from wheelhouse
│     ├─ init_postgres.ps1        # initdb + register service + create db
│     ├─ init_redis.ps1           # install Memurai (Redis) MSI as a service
│     ├─ configure_env.ps1        # write backend\.env (generated secrets)
│     ├─ migrate_and_seed.ps1     # alembic upgrade + seed.py
│     ├─ generate_nginx_conf.ps1  # serve dist/ + proxy /api/v1
│     └─ uninstall_cleanup.ps1
└─ launcher/                      # .NET system-tray launcher
   ├─ AttendanceLauncher.sln
   └─ AttendanceLauncher/{AttendanceLauncher.csproj, Program.cs}
```

## Architecture on the target

```
Browser → nginx (:8080) ─┬─ static frontend (frontend\dist)
                         └─ /api/v1 → uvicorn (:8000) ─┬─ PostgreSQL service (:15432)
                                                       ├─ Redis service (:6379)
                                                       └─ InsightFace buffalo_l + anti-spoof (bundled)
Celery worker + beat (background jobs) ── Redis broker (:6379)
```

- **PostgreSQL** (`AttendancePostgres`) and **Redis/Memurai** (`Memurai`) run as Windows services.
- **uvicorn**, **Celery worker**, **Celery beat**, and **nginx** are managed by the tray launcher.
- Writable runtime data lives in `C:\ProgramData\AttendancePlatform\appdata` (the
  install dir under Program Files is read-only for the non-elevated launcher).

See [../WINDOWS_BUILD.md](../WINDOWS_BUILD.md) (build) and
[../WINDOWS_INSTALL.md](../WINDOWS_INSTALL.md) (install/run).
