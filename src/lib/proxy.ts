import { execFileSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getModernizeExePath(): string {
  if (process.env.MODERNIZE_EXE_PATH) {
    return process.env.MODERNIZE_EXE_PATH;
  }
  // Default install location
  const defaultPath = path.join(
    process.env.LOCALAPPDATA ?? '',
    'Programs',
    'modernize',
    'modernize.exe',
  );
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  throw new Error(
    'modernize.exe not found. Set MODERNIZE_EXE_PATH env var or install modernize.',
  );
}

export function proxyToModernize(args: string[]): void {
  const exePath = getModernizeExePath();
  try {
    execFileSync(exePath, args, { stdio: 'inherit' });
  } catch (err) {
    const spawnErr = err as SpawnSyncReturns<Buffer> & { status?: number };
    if (spawnErr.status !== undefined && spawnErr.status !== null) {
      process.exitCode = spawnErr.status;
    } else {
      throw err;
    }
  }
}
