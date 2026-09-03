export type AppErrorCode =
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_EXTENSION'
  | 'INVALID_URL'
  | 'BINARY_UNAVAILABLE'
  | 'DOWNLOAD_FAILED'
  | 'CONVERSION_FAILED'
  | 'EMPTY_AUDIO'
  | 'WRITE_FAILED'
  | 'METADATA_FAILED'
  | 'UNPLAYABLE_NOTE'
  | 'DOMAIN_VALIDATION'
  | 'ANALYSIS_AUDIO_MISSING'
  | 'ANALYSIS_DECODE_FAILED'
  | 'RHYTHM_ANALYSIS_FAILED'
  | 'TONAL_ANALYSIS_FAILED'
  | 'CHORD_ANALYSIS_FAILED'
  | 'INSUFFICIENT_BEATS'
  | 'SONG_GRAPH_BUILD_FAILED'
  | 'ANALYSIS_LOW_CONFIDENCE'
  | 'EVIDENCE_TOO_LARGE'
  | 'RIGHTS_ATTESTATION_REQUIRED';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
