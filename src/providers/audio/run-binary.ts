import { execFile } from 'node:child_process';
import { AppError } from '../../errors/app-error.js';

/** Check a binary exists and runs. Returns version string. */
export async function checkBinary(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        reject(
          new AppError(
            'BINARY_UNAVAILABLE',
            err.code === 'ENOENT' ? `${cmd} not found on PATH` : `${cmd} failed: ${err.message}`,
            { cause: err },
          ),
        );
      } else {
        resolve(stdout.trim().split('\n')[0] ?? '');
      }
    });
  });
}

/** Run a binary, throwing AppError on failure. */
export async function runBinary(
  cmd: string,
  args: string[],
  errorCode: 'DOWNLOAD_FAILED' | 'CONVERSION_FAILED',
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          reject(new AppError('BINARY_UNAVAILABLE', `${cmd} not found on PATH`));
        } else {
          const detail = stderr.trim().split('\n').pop() || err.message;
          reject(new AppError(errorCode, `${cmd} failed: ${detail}`, { cause: err }));
        }
      } else {
        resolve(stdout);
      }
    });
  });
}
