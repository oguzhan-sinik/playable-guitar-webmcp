import { AppError } from '../../errors/app-error.js';

export const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.flac'] as const;

export type SourceType = 'local' | 'url';

export function detectSourceType(input: string): SourceType {
  return /^https?:\/\//i.test(input) ? 'url' : 'local';
}

export function validateLocalSource(input: string): string {
  const ext = input.slice(input.lastIndexOf('.')).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new AppError(
      'UNSUPPORTED_EXTENSION',
      `Unsupported extension "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
  return ext;
}

export function validateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('INVALID_URL', `Invalid URL: ${input}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new AppError('INVALID_URL', `Only http(s) URLs supported: ${input}`);
  }
  return url;
}
