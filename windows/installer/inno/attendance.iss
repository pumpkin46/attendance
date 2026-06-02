; Attendance Platform - Windows EXE installer (Inno Setup)
; This installer is designed to:
; - Install the app bundle (backend/frontend/ai-service + launcher)
; - Bootstrap prerequisites (Postgres, Redis, PHP, Python) via PowerShell scripts
; - Run one-time initialization (composer/npm/pip, .env generation, migrations)

[Setup]
AppId={{6C7D1B3B-7A9F-4B57-9F05-2C7AAB73F92E}
AppName=Attendance Platform
AppVersion=1.0.0
AppPublisher=Attendance Platform
DefaultDirName={commonpf}\Attendance Platform
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

[Files]
; App bundle
; NOTE: {#SourcePath} is this folder: windows\installer\inno
; Repo root is: ..\..\..
Source: "{#SourcePath}\..\..\..\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\..\..\..\frontend\*"; DestDir: "{app}\frontend"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\..\..\..\ai-service\*"; DestDir: "{app}\ai-service"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#SourcePath}\..\..\..\windows\launcher\AttendanceLauncher\bin\Release\net8.0-windows\*"; DestDir: "{app}\launcher"; Flags: recursesubdirs createallsubdirs ignoreversion

; Installer scripts
Source: "{#SourcePath}\..\scripts\*"; DestDir: "{app}\windows\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion

; Optional offline prereq installers (drop files here before compiling):
;   windows/installer/prereqs/postgresql/postgresql-installer.exe
;   windows/installer/prereqs/redis/redis-installer.exe
Source: "{#SourcePath}\..\prereqs\*"; DestDir: "{app}\windows\prereqs"; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\Attendance Platform"; Filename: "{app}\launcher\AttendanceLauncher.exe"
Name: "{group}\Uninstall Attendance Platform"; Filename: "{uninstallexe}"

[Tasks]
Name: "install_postgres"; Description: "Install PostgreSQL (required if not already installed)"; Flags: checkedonce
Name: "install_redis"; Description: "Install Redis (required if not already installed)"; Flags: checkedonce

[Run]
; Bootstrap (downloads/installs) dependencies and builds the app bundle.
; NOTE: these scripts are written to be idempotent.
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\scripts\bootstrap.ps1"" -InstallRoot ""{app}"" {code:GetBootstrapArgs}"; Flags: runhidden waituntilterminated

; Launch on finish
Filename: "{app}\launcher\AttendanceLauncher.exe"; Description: "Launch Attendance Platform"; Flags: nowait postinstall skipifsilent

[Code]
function GetBootstrapArgs(Param: string): string;
begin
  Result := '';
  if WizardIsTaskSelected('install_postgres') then
    Result := Result + ' -InstallPostgres';
  if WizardIsTaskSelected('install_redis') then
    Result := Result + ' -InstallRedis';
end;


