import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { AppError } from '../errors/app-error.js';
import { SongSchema, type Song } from '../domain/song/song.js';

export interface SongRepository {
  save(song: Song): Promise<void>;
  get(id: string): Promise<Song>;
  list(): Promise<Song[]>;
}

/** metadata.json per song dir. */
export class LocalSongRepository implements SongRepository {
  constructor(private readonly songsDir: string) {}

  private metaPath(id: string): string {
    return path.join(this.songsDir, id, 'metadata.json');
  }

  async save(song: Song): Promise<void> {
    const file = this.metaPath(song.id);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(song, null, 2) + '\n');
    } catch (err) {
      throw new AppError('WRITE_FAILED', `Failed to save song ${song.id}`, { cause: err });
    }
  }

  async get(id: string): Promise<Song> {
    let raw: Buffer;
    try {
      raw = await readFile(this.metaPath(id));
    } catch {
      throw new AppError('FILE_NOT_FOUND', `No song ${id}`);
    }
    return SongSchema.parse(JSON.parse(raw.toString()));
  }

  async list(): Promise<Song[]> {
    let ids: string[];
    try {
      ids = await readdir(this.songsDir);
    } catch {
      return [];
    }
    const songs = await Promise.all(
      ids.map((id) => this.get(id).catch(() => null)),
    );
    return songs.filter((s): s is Song => s !== null);
  }
}
