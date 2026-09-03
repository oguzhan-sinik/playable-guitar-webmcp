export interface DownloadedAudio {
  /** Path to the downloaded audio file on disk. */
  filePath: string;
  title?: string;
  artist?: string;
  durationMs?: number;
}

export interface AudioDownloader {
  /** Only call for content you have permission to download. */
  download(url: string, destDir: string): Promise<DownloadedAudio>;
}
