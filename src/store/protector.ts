import { spawn } from 'node:child_process';

export interface DataProtector {
  readonly id: string;
  protect(plaintext: Buffer): Promise<Buffer>;
  unprotect(ciphertext: Buffer): Promise<Buffer>;
}

const PROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = [Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())
$outputBytes = [Security.Cryptography.ProtectedData]::Protect(
  $inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`;

const UNPROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = [Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())
$outputBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($outputBytes))
`;

async function runPowerShell(script: string, input: Buffer): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI is available only on Windows');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`DPAPI helper failed with exit code ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      try {
        resolve(Buffer.from(Buffer.concat(stdout).toString('ascii').trim(), 'base64'));
      } catch (error) {
        reject(new Error('DPAPI helper returned invalid output', { cause: error }));
      }
    });
    child.stdin.end(input.toString('base64'));
  });
}

export class WindowsDpapiProtector implements DataProtector {
  readonly id = 'windows-dpapi-current-user-v1';

  protect(plaintext: Buffer): Promise<Buffer> {
    return runPowerShell(PROTECT_SCRIPT, plaintext);
  }

  unprotect(ciphertext: Buffer): Promise<Buffer> {
    return runPowerShell(UNPROTECT_SCRIPT, ciphertext);
  }
}
