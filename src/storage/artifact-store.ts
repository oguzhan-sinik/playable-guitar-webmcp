export interface ArtifactReference {
  /** Path relative to the data dir, e.g. songs/song_abc/audio/analysis.wav */
  relativePath: string;
}

export interface ArtifactStore {
  /** Store bytes under songs/<songId>/<...relPath>. Returns the reference. */
  put(songId: string, relPath: string, data: Buffer | string): Promise<ArtifactReference>;
  exists(songId: string, relPath: string): Promise<boolean>;
}
