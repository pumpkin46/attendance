; ============================================================================
;  Attendance Platform - offline Windows installer
;  Compiled by windows\build-installer.ps1 (passes /DMyAppVersion, /DPythonVersion).
;  Source paths are relative to this .iss file:
;     ..            -> windows\installer
;     ..\..         -> windows
;     ..\..\..      -> repo root
; ============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "2.0.0"
#endif
#ifndef PythonVersion
  #define PythonVersion "3.14.4"
#endif

#define MyAppName "Attendance Platform"
#define MyAppPublisher "Attendance Platform"
#define MyLauncher "AttendanceLauncher.exe"

[Setup]
AppId={{8F2C5A1E-4B7D-4E9A-9C3F-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\AttendancePlatform
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=AttendancePlatformSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Large payload (Python wheels + Postgres + models) - allow plenty of headroom.
DiskSpanning=no
#if FileExists("..\..\assets\app.ico")
SetupIconFile=..\..\assets\app.ico
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"
Name: "autostart"; Description: "Start {#MyAppName} automatically when Windows starts"; GroupDescription: "Startup:"

[Files]
; -- Backend source (no venv / caches / runtime data / secrets) --
Source: "..\..\..\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "*.pyc,__pycache__,\.venv\*,\venv\*,\.pytest_cache\*,\tests\*,\.env,\data\*,\models\*"

; -- Frontend (prebuilt static bundle) --
Source: "..\..\..\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Bundled Python installer (run silently at first install) --
Source: "..\prereqs\python\python-*-amd64.exe"; DestDir: "{app}\pyinstaller"; Flags: ignoreversion

; -- Portable PostgreSQL binaries --
Source: "..\prereqs\postgresql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Portable nginx --
Source: "..\prereqs\nginx\*"; DestDir: "{app}\nginx"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Native Redis for Windows (installed as a service) --
Source: "..\prereqs\redis\*"; DestDir: "{app}\redis"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- InsightFace model pack (INSIGHTFACE_HOME) --
Source: "..\prereqs\models\insightface\*"; DestDir: "{app}\models\insightface"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Anti-spoof model (resolved relative to backend CWD: models\MiniFASNetV2.onnx) --
Source: "..\prereqs\models\MiniFASNetV2.onnx"; DestDir: "{app}\backend\models"; Flags: ignoreversion

; -- Offline pip wheelhouse --
Source: "..\prereqs\wheelhouse\*"; DestDir: "{app}\wheelhouse"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Self-contained tray launcher (publish output) --
Source: "..\..\launcher\publish\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

; -- Install/uninstall helper scripts --
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyLauncher}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyLauncher}"; Tasks: desktopicon
Name: "{commonstartup}\{#MyAppName}"; Filename: "{app}\{#MyLauncher}"; Tasks: autostart

[Run]
; Launch the tray app at the end of a successful (non-silent) install.
Filename: "{app}\{#MyLauncher}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove the venv, generated .env, runtime data and other post-install files.
Type: filesandordirs; Name: "{app}"

[Code]
{ Run the offline bootstrap (Python install, venv, Postgres init, migrate/seed,
  nginx conf) after files are copied, and surface any failure to the user. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption :=
      'Configuring Python, PostgreSQL and the database. This can take several minutes...';
    WizardForm.StatusLabel.Update;
    if not Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\bootstrap.ps1') + '"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      MsgBox('Could not launch the setup script (PowerShell).', mbError, MB_OK);
    end
    else if ResultCode <> 0 then
    begin
      MsgBox('Initial setup failed (exit code ' + IntToStr(ResultCode) + ').' + #13#10 +
             'See %ProgramData%\AttendancePlatform\logs\install.log for details.',
             mbError, MB_OK);
    end
    else
    begin
      MsgBox('Setup complete.' + #13#10 + #13#10 +
             'Your administrator sign-in details are saved to:' + #13#10 +
             ExpandConstant('{commonappdata}\AttendancePlatform\ADMIN_CREDENTIALS.txt') + #13#10 + #13#10 +
             'Open the app from the tray icon, then browse to http://localhost:8080.',
             mbInformation, MB_OK);
    end;
  end;
end;

{ On uninstall: stop processes + remove the Postgres service, optionally purging data. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  PurgeArg: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    PurgeArg := '';
    if MsgBox('Also delete all attendance data and the database?' + #13#10 +
              'Choose No to keep it for a future reinstall.',
              mbConfirmation, MB_YESNO) = IDYES then
      PurgeArg := ' -PurgeData';
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\uninstall_cleanup.ps1') + '"' + PurgeArg,
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
