import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../errors/app-error.js';
import { validateLocalSource } from '../../domain/song/audio-source.js';

/** Validate a local audio file and copy it into the song's source dir. */
export async function importLocalFile(inputPath: string, songDir: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  let st;
  try {
    st = await stat(resolved);
  } catch {
    throw new AppError('FILE_NOT_FOUND', `File does not exist: ${resolved}`);
  }
  if (!st.isFile()) {
    throw new AppError('FILE_NOT_FOUND', `Not a file: ${resolved}`);
  }
  validateLocalSource(resolved);
  const destDir = path.join(songDir, 'source');
  const dest = path.join(destDir, `original${path.extname(resolved).toLowerCase()}`);
  try {
    await mkdir(destDir, { recursive: true });
    await copyFile(resolved, dest);
  } catch (err) {
    throw new AppError('WRITE_FAILED', `Failed to copy source into ${dest}`, { cause: err });
  }
  return dest;
}
