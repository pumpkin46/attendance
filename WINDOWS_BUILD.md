# Building the offline Windows installer

This produces a single `AttendancePlatformSetup.exe` that installs and runs the
entire platform on a Windows PC **with no internet access**. Everything the
target needs — Python, PostgreSQL, nginx, all Python wheels, and the face-recognition
models — is baked into the installer.

The build is run **once on an online Windows machine**. The resulting EXE is fully offline.

## Build machine prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Windows | 10/11 or Server 2019+ | x64 |
| Python | **3.14.x (x64)** | Must match the version baked in (`-PythonVersion`). The wheelhouse is built with this interpreter, so its CPython tag must match the target. |
| Node.js | 20+ | Frontend build |
| .NET SDK | 9.0+ | Tray launcher (`dotnet publish`) |
| Inno Setup | 6.3+ | Auto-installed by the build script if missing |
| Internet | required | To download prerequisites once |

## One command

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File .\build-installer.ps1
```

Optional flags:

```powershell
.\build-installer.ps1 -Version 2.1.0 -PythonVersion 3.14.4 -SkipPrereqs
```

- `-SkipPrereqs` — reuse already-downloaded prerequisites in `installer\prereqs\`.
- `-PythonVersion` — must equal the build machine's `major.minor`.

## What the build does

1. **Inno Setup** — uses `iscc` if on PATH, else silent-installs it.
2. **`fetch-prereqs.ps1`** — downloads + normalizes into `installer\prereqs\`:
   - `python\python-<ver>-amd64.exe` (official installer)
   - `postgresql\` — EDB "binaries only" zip, PostgreSQL 18 (flattened)
   - `nginx\` — nginx/Windows zip (flattened)
   - `redis\` — Memurai MSI (Redis-compatible Windows server, installed as a service)
     > **License:** the default **Memurai Developer** Edition is free for
     > development/testing only — **production requires Memurai Enterprise**.
     > To ship Enterprise, drop its MSI in `installer\prereqs\redis\` (replacing
     > the Developer one) or pass `-MemuraiMsiUrl` to `fetch-prereqs.ps1`.
   - `models\insightface\models\buffalo_l\` — InsightFace recognition pack
   - `models\MiniFASNetV2.onnx` — anti-spoof model
3. **Wheelhouse** — `pip wheel -r backend\requirements.txt -w installer\prereqs\wheelhouse`.
   This resolves the **entire** dependency tree to wheels (building any sdists,
   e.g. `insightface`, locally) so the target only ever runs `pip install --no-index`.
4. **Frontend** — `npm ci && npm run build` with `VITE_API_URL` unset, so the app
   uses the relative `/api/v1` base and is served same-origin behind nginx.
5. **Tray launcher** — `dotnet publish -r win-x64 --self-contained` (no .NET needed on target).
6. **Icon** — generates `assets\app.ico` from `assets\app-icon.png`.
7. **Compile** — `iscc installer\inno\attendance.iss` → `AttendancePlatformSetup.exe`
   (copied to the repo root).

## Output

- `windows\installer\inno\Output\AttendancePlatformSetup.exe`
- A copy at the repo root: `AttendancePlatformSetup.exe`

Expected size ≈ **0.8 GB** compressed (buffalo_l ~280 MB, wheels ~400 MB incl.
onnxruntime/faiss/opencv, PostgreSQL ~300 MB, Redis ~12 MB — LZMA2-compressed).

## Updating bundled component versions

Edit the defaults at the top of `installer\fetch-prereqs.ps1`
(`PostgresUrl`, `NginxVersion`, `BuffaloUrl`, `AntispoofUrl`) and re-run with the
prereqs folder cleared (or `Remove-Item installer\prereqs\<component>\*`).

## Troubleshooting

- **`pip wheel` fails on a dependency** — the build machine is missing a C/C++
  toolchain needed to build an sdist. Install the
  [Build Tools for Visual Studio](https://visualstudio.microsoft.com/downloads/)
  (C++ workload) and re-run. Most deps ship wheels; `insightface` is the usual
  one that may need building.
- **`Build Python is X but installer targets Y`** — install a matching Python
  `major.minor` (x64) and re-run, or pass `-PythonVersion` to match what you have.
- **EDB PostgreSQL URL 404s** — the version moved; update `PostgresUrl` in
  `fetch-prereqs.ps1` to a current `…-windows-x64-binaries.zip`.

See [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md) for the end-user install/run guide.
