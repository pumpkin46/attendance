; Attendance Platform - Windows EXE installer (Inno Setup)
; Designed for OFFLINE installation:
; - Bundles all prereq installers (Postgres, Redis, Python, nginx)
; - Bundles app code (backend, frontend, launcher)
; - Runs bootstrap scripts to install prereqs + initialize the app
#define RepoRoot SourcePath + "\..\..\..\"
#define InstallerRoot SourcePath + "\..\"

[Setup]
AppId={{6C7D1B3B-7A9F-4B57-9F05-2C7AAB73F92E}
AppName=Attendance Platform
AppVersion=2.0.0
AppPublisher=Attendance Platform
SetupIconFile={#SourcePath}\..\..\assets\app.ico
DefaultDirName={autopf}\Attendance Platform
DefaultGroupName=Attendance Platform
OutputBaseFilename=AttendancePlatformSetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
Name: "{app}\logs"
Name: "{app}\windows\prereqs\postgresql"
Name: "{app}\windows\prereqs\redis"
Name: "{app}\windows\prereqs\python"
Name: "{app}\windows\prereqs\nginx"
Name: "{app}\windows\runtime"
Name: "{app}\windows\runtime\nginx"

[Files]
; =====================================================================
; App bundle
; =====================================================================
; IMPORTANT for offline installs: include frontend/dist so UI can be served without Node.
Source: "{#RepoRoot}frontend\*"; DestDir: "{app}\frontend"; Excludes: "node_modules\*,.vite\*,coverage\*"; Flags: recursesubdirs createallsubdirs ignoreversion
; \models\* = ONNX weights at backend root only — not app\models (SQLAlchemy)
Source: "{#RepoRoot}backend\*"; DestDir: "{app}\backend"; Excludes: "venv\*,.venv\*,env\*,__pycache__\*,*.pyc,.pytest_cache\*,.mypy_cache\*,.ruff_cache\*,data\*,\models\*,*.egg-info\*"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#RepoRoot}windows\launcher\AttendanceLauncher\bin\Release\net8.0-windows\*"; DestDir: "{app}\launcher"; Flags: recursesubdirs createallsubdirs ignoreversion

; =====================================================================
; Installer scripts
; =====================================================================
Source: "{#InstallerRoot}scripts\*"; DestDir: "{app}\windows\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion

; =====================================================================
; Offline prereq installers (REQUIRED — build fails if any are missing)
; =====================================================================
Source: "{#InstallerRoot}prereqs\postgresql\postgresql-server-windows-x64.zip"; DestDir: "{app}\windows\prereqs\postgresql"; Flags: ignoreversion
Source: "{#InstallerRoot}prereqs\redis\memurai.msi"; DestDir: "{app}\windows\prereqs\redis"; Flags: ignoreversion
Source: "{#InstallerRoot}prereqs\python\python-3.14.4-amd64.exe"; DestDir: "{app}\windows\prereqs\python"; Flags: ignoreversion
Source: "{#InstallerRoot}prereqs\nginx\nginx-1.30.2.zip"; DestDir: "{app}\windows\prereqs\nginx"; Flags: ignoreversion

; =====================================================================
; Bundled runtimes (optional — pre-extracted Python for portability)
; =====================================================================
Source: "{#RepoRoot}windows\runtime\*"; DestDir: "{app}\windows\runtime"; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\Attendance Platform"; Filename: "{app}\launcher\AttendanceLauncher.exe"
Name: "{group}\Uninstall Attendance Platform"; Filename: "{uninstallexe}"

[Tasks]
Name: "install_postgres"; Description: "Install PostgreSQL (required if not already installed)"; Flags: checkedonce
Name: "install_redis"; Description: "Install Redis / Memurai (required if not already installed)"; Flags: checkedonce
Name: "install_python"; Description: "Install Python 3.14 (required for backend + AI)"; Flags: checkedonce

[Run]
; Bootstrap: install prereqs, set up Python venv, run migrations.
; Logs to {app}\logs\bootstrap.log (Start-Transcript inside bootstrap.ps1).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\scripts\bootstrap.ps1"" -InstallRoot ""{app}"" -LogPath ""{app}\logs\bootstrap.log"" {code:GetBootstrapArgs}"; Flags: runhidden waituntilterminated

; Launch on finish
Filename: "{app}\launcher\AttendanceLauncher.exe"; Description: "Launch Attendance Platform"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Run cleanup script to uninstall prereqs (PostgreSQL, Redis, Python) and wipe all data.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\scripts\uninstall_cleanup.ps1"" -InstallRoot ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "UninstallCleanup"

[UninstallDelete]
; Inno only removes files it originally installed. These catch everything created at
; runtime (venv, logs, data, ONNX models, FAISS indexes, __pycache__, etc.).
Type: filesandordirs; Name: "{app}\backend\.venv"
Type: filesandordirs; Name: "{app}\backend\data"
Type: filesandordirs; Name: "{app}\backend\models"
Type: filesandordirs; Name: "{app}\backend\__pycache__"
Type: filesandordirs; Name: "{app}\windows\runtime"
Type: filesandordirs; Name: "{app}\logs"
Type: dirifempty; Name: "{app}"

[Code]
function GetBootstrapArgs(Param: string): string;
begin
  Result := '';
  if WizardIsTaskSelected('install_postgres') then
    Result := Result + ' -InstallPostgres';
  if WizardIsTaskSelected('install_redis') then
    Result := Result + ' -InstallRedis';
  if WizardIsTaskSelected('install_python') then
    Result := Result + ' -InstallPython';
end;
