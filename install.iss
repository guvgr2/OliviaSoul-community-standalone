; 「林离的信」安装脚本（Inno Setup 6）
; 值得抄的一条：桌面快捷方式直接指向 exe 本身，不经任何 .bat / .vbs / .ps1 中转。
; 中转脚本会被安全软件当成可疑启动项拦掉（图标点了没反应），是同类程序最常见的坑。

#define MyAppName "林离的信"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "OliviaSoul 社区"
#define MyAppExeName "LinliLetters.exe"

[Setup]
AppId={{B7E4C1A2-6D3F-4A18-9C55-2F0A7D31E9A4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\LinliLetters
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=林离的信-1.0.0-安装程序
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=no
RestartApplications=no
[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "快捷方式:"; Flags: unchecked

[Files]
Source: "dist\package\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\package\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\package\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; 直接指 exe，不走脚本中转
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "现在启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
