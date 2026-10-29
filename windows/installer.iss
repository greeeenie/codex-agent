#define AppName "Codex Agent"
#define AppVersion "0.3.2"
[Setup]
AppId={{9B346F73-0D59-4D48-96F4-9A9CD67102DC}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=greeeenie
AppPublisherURL=https://github.com/greeeenie/codex-agent
AppSupportURL=https://github.com/greeeenie/codex-agent/issues
DefaultDirName={localappdata}\Programs\CodexAgent
DisableDirPage=yes
DefaultGroupName=Codex Agent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir=..\dist
OutputBaseFilename=Codex-Agent-Setup-x64
SetupIconFile=..\.build\agent.ico
UninstallDisplayIcon={app}\CodexAgent.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
AppMutex=CodexAgentInstaller
VersionInfoVersion=0.3.2.0
DisableWelcomePage=no
DisableReadyPage=yes
UninstallDisplayName=Codex Agent

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "startup"; Description: "{cm:StartupTask}"; Flags: checkedonce

[CustomMessages]
english.StartupTask=Start Codex Agent when I sign in to Windows
russian.StartupTask=Запускать Codex Agent при входе в Windows
english.LaunchAgent=Launch Codex Agent
russian.LaunchAgent=Запустить Codex Agent
english.WelcomeLabel2=This will install Codex Agent on your computer.%n%nNode.js is included. Your existing Codex installation will be used. No terminal or separate runtime installation is required.
russian.WelcomeLabel2=Установщик добавит Codex Agent на компьютер.%n%nNode.js уже включён. Агент использует установленный Codex. Терминал и отдельная установка компонентов не нужны.

[Files]
Source: "..\.build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Codex Agent"; Filename: "{app}\CodexAgent.exe"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "CodexAgent"; ValueData: """{app}\CodexAgent.exe"" --autostart"; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\CodexAgent.exe"; Description: "{cm:LaunchAgent}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\CodexAgent.exe"; Parameters: "--shutdown"; Flags: runhidden waituntilterminated; RunOnceId: "StopAgent"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\CodexAgent.exe')) then
    Exec(ExpandConstant('{app}\CodexAgent.exe'), '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
