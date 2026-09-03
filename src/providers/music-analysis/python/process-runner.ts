import { spawn } from 'node:child_process';
import path from 'node:path';
import { AppError } from '../../../errors/app-error.js';

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a command, captures output. No shell. */
export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new AppError('BINARY_UNAVAILABLE', `Cannot run ${command}: ${err.message}`, { cause: err }));
    });
    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new AppError('BINARY_UNAVAILABLE', `${command} timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
    });
  });
}

export interface MirWorkerPaths {
  /** Directory containing pyproject.toml + .venv (uv environment). */
  mirDir: string;
}

export function mirWorkerDir(): string {
  return process.env.MIR_WORKER_DIR ?? path.join(process.cwd(), 'mir');
}
