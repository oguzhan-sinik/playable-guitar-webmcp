import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors/app-error.js';
import type { ArtifactReference, ArtifactStore } from './artifact-store.js';

export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  private resolve(songId: string, relPath: string): string {
    const full = path.resolve(this.rootDir, 'songs', songId, relPath);
    // trust boundary: songId/relPath must not escape the data dir
    const allowed = path.resolve(this.rootDir, 'songs');
    if (!full.startsWith(allowed + path.sep)) {
      throw new AppError('WRITE_FAILED', `Illegal artifact path: ${relPath}`);
    }
    return full;
  }

  async put(songId: string, relPath: string, data: Buffer | string): Promise<ArtifactReference> {
    const full = this.resolve(songId, relPath);
    try {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    } catch (err) {
      throw new AppError('WRITE_FAILED', `Failed to write ${full}`, { cause: err });
    }
    return { relativePath: path.join('songs', songId, relPath) };
  }

  async exists(songId: string, relPath: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(songId, relPath))).isFile();
    } catch {
      return false;
    }
  }
}

export async function readArtifact(rootDir: string, ref: ArtifactReference): Promise<Buffer> {
  return readFile(path.join(rootDir, ref.relativePath));
}
