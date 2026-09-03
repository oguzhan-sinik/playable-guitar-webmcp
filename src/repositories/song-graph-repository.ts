import path from 'node:path';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { AppError } from '../errors/app-error.js';
import { SongGraphSchema, type SongGraph } from '../domain/music/song-graph.js';

export interface SongGraphRepository {
  save(songId: string, graph: SongGraph): Promise<void>;
  load(songId: string): Promise<SongGraph>;
  exists(songId: string): Promise<boolean>;
}

/** graph.json inside the song directory. */
export class LocalSongGraphRepository implements SongGraphRepository {
  constructor(private readonly songsDir: string) {}

  private graphPath(songId: string): string {
    return path.join(this.songsDir, songId, 'graph.json');
  }

  async save(songId: string, graph: SongGraph): Promise<void> {
    const file = this.graphPath(songId);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(graph, null, 2) + '\n');
    } catch (err) {
      throw new AppError('WRITE_FAILED', `Failed to save graph for ${songId}`, { cause: err });
    }
  }

  async load(songId: string): Promise<SongGraph> {
    let raw: Buffer;
    try {
      raw = await readFile(this.graphPath(songId));
    } catch {
      throw new AppError('FILE_NOT_FOUND', `No graph for song ${songId} — run "guitar song analyze ${songId}"`);
    }
    const parsed = SongGraphSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) {
      throw new AppError('DOMAIN_VALIDATION', `Corrupt graph.json for ${songId}`);
    }
    return parsed.data;
  }

  async exists(songId: string): Promise<boolean> {
    try {
      await access(this.graphPath(songId));
      return true;
    } catch {
      return false;
    }
  }
}
