import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LoginCredential {
  username: string;
  password: string;
}

/**
 * Reads a Windows Credential Manager Generic Credential without ever letting the
 * secret enter model context. Adapted from flowaccount-mcp's reader (see PROJECT.md §6).
 * The password is read by a child PowerShell process and returned only to the
 * actuator that types it into the browser.
 */
const CREDENTIAL_SCRIPT = String.raw`
$Target = $env:SSOMCP_CRED_TARGET_READ
$source = @'
using System;
using System.Runtime.InteropServices;
public static class SsoMcpCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credentialPtr);
}
'@
Add-Type -TypeDefinition $source
$ptr = [IntPtr]::Zero
if (-not [SsoMcpCredentialReader]::CredRead($Target, 1, 0, [ref]$ptr)) { exit 2 }
try {
  $cred = [Runtime.InteropServices.Marshal]::PtrToStructure(
    $ptr, [type][SsoMcpCredentialReader+CREDENTIAL]
  )
  $password = if ($cred.CredentialBlobSize -gt 0) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni(
      $cred.CredentialBlob, [int]($cred.CredentialBlobSize / 2)
    )
  } else { "" }
  [pscustomobject]@{ username = $cred.UserName; password = $password } |
    ConvertTo-Json -Compress
} finally {
  [SsoMcpCredentialReader]::CredFree($ptr)
}
`;

const CREDENTIAL_PROMPT_SCRIPT = String.raw`
$Target = $env:SSOMCP_CRED_TARGET_READ
Add-Type -AssemblyName PresentationFramework
$message = "ไม่พบข้อมูลเข้าสู่ระบบ SSO e-Service ใน Windows Credential Manager." +
  [Environment]::NewLine + [Environment]::NewLine +
  "ต้องการเปิด Credential Manager เพื่อเพิ่ม Generic Credential หรือไม่?" +
  [Environment]::NewLine + [Environment]::NewLine +
  "เมื่อเปิดแล้ว เลือก Windows Credentials > Add a generic credential" +
  [Environment]::NewLine +
  "Internet or network address: $Target" +
  [Environment]::NewLine +
  "User name: ชื่อผู้ใช้ SSO e-Service ของนายจ้างรายนี้" +
  [Environment]::NewLine +
  "Password: รหัสผ่าน SSO e-Service"
$title = "ssomcp"
$answer = [System.Windows.MessageBox]::Show(
  $message,
  $title,
  [System.Windows.MessageBoxButton]::YesNo,
  [System.Windows.MessageBoxImage]::Question
)
if ($answer -eq [System.Windows.MessageBoxResult]::Yes) {
  Start-Process -FilePath "control.exe" -ArgumentList "/name","Microsoft.CredentialManager"
  Write-Output "YES"
} else {
  Write-Output "NO"
}
`;

export async function readWindowsCredential(target: string): Promise<LoginCredential | null> {
  if (process.platform !== 'win32' || !target) return null;

  const encoded = Buffer.from(CREDENTIAL_SCRIPT, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, SSOMCP_CRED_TARGET_READ: target },
      },
    );
    const parsed = JSON.parse(stdout.trim()) as Partial<LoginCredential>;
    if (!parsed.username || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export async function promptToOpenCredentialManager(target: string): Promise<boolean> {
  if (process.platform !== 'win32' || !target) return false;

  const encoded = Buffer.from(CREDENTIAL_PROMPT_SCRIPT, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, SSOMCP_CRED_TARGET_READ: target },
      },
    );
    return stdout.trim().endsWith('YES');
  } catch {
    return false;
  }
}

export type CredentialWriteResult = 'written' | 'cancelled' | 'unavailable' | 'error';

/**
 * Capture a login through a native dialog and write it straight into Windows Credential
 * Manager. The password is entered by the user in an OS PasswordBox and written by this
 * child process via CredWrite — it never returns to Node or the model. Used by the
 * "create employer profile" flow so setting up a นายจ้าง's login is one popup.
 */
const CREDENTIAL_WRITE_SCRIPT = String.raw`
$Target = $env:SSOMCP_CRED_TARGET_WRITE
$Label = $env:SSOMCP_CRED_LABEL
Add-Type -AssemblyName PresentationFramework
$source = @'
using System;
using System.Runtime.InteropServices;
public static class SsoMcpCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, UInt32 flags);
}
'@
Add-Type -TypeDefinition $source

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
  Title="ssomcp" SizeToContent="WidthAndHeight" WindowStartupLocation="CenterScreen"
  ResizeMode="NoResize" Topmost="True">
  <StackPanel Margin="16" Width="360">
    <TextBlock Name="Info" TextWrapping="Wrap" Margin="0,0,0,12"/>
    <TextBlock Text="ชื่อผู้ใช้ (SSO e-Service)" Margin="0,0,0,2"/>
    <TextBox Name="UserBox" Margin="0,0,0,10"/>
    <TextBlock Text="รหัสผ่าน" Margin="0,0,0,2"/>
    <PasswordBox Name="PassBox" Margin="0,0,0,14"/>
    <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
      <Button Name="OkBtn" Content="บันทึก" Width="80" Margin="0,0,8,0" IsDefault="True"/>
      <Button Name="CancelBtn" Content="ยกเลิก" Width="80" IsCancel="True"/>
    </StackPanel>
  </StackPanel>
</Window>
"@
$reader = New-Object System.Xml.XmlNodeReader $xaml
$win = [Windows.Markup.XamlReader]::Load($reader)
$info = $win.FindName("Info")
$userBox = $win.FindName("UserBox")
$passBox = $win.FindName("PassBox")
$okBtn = $win.FindName("OkBtn")
$info.Text = "กรอกข้อมูลเข้าสู่ระบบ SSO e-Service สำหรับ: $Label" + [Environment]::NewLine +
  "(เก็บใน Windows Credential Manager: $Target)"
$script:saved = $false
$okBtn.Add_Click({
  if ([string]::IsNullOrWhiteSpace($userBox.Text) -or $passBox.Password.Length -eq 0) { return }
  $script:saved = $true
  $win.DialogResult = $true
  $win.Close()
})
$null = $win.ShowDialog()
if (-not $script:saved) { Write-Output "CANCEL"; exit 0 }

$password = $passBox.Password
$blob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($password)
try {
  $cred = New-Object SsoMcpCredentialWriter+CREDENTIAL
  $cred.Type = 1
  $cred.TargetName = $Target
  $cred.UserName = $userBox.Text
  $cred.CredentialBlob = $blob
  $cred.CredentialBlobSize = [System.Text.Encoding]::Unicode.GetByteCount($password)
  $cred.Persist = 2
  if ([SsoMcpCredentialWriter]::CredWrite([ref]$cred, 0)) { Write-Output "OK" } else { Write-Output "ERROR" }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob)
}
`;

export async function writeWindowsCredential(
  target: string,
  label: string,
): Promise<CredentialWriteResult> {
  if (process.platform !== 'win32' || !target) return 'unavailable';

  const encoded = Buffer.from(CREDENTIAL_WRITE_SCRIPT, 'utf16le').toString('base64');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, SSOMCP_CRED_TARGET_WRITE: target, SSOMCP_CRED_LABEL: label },
      },
    );
    const result = stdout.trim();
    if (result.endsWith('OK')) return 'written';
    if (result.endsWith('CANCEL')) return 'cancelled';
    return 'error';
  } catch {
    return 'error';
  }
}

export async function waitForWindowsCredential(
  target: string,
  timeoutMs: number,
): Promise<LoginCredential | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const credential = await readWindowsCredential(target);
    if (credential) return credential;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}
