import { randomBytes } from 'node:crypto';

export function newId(prefix: string, bytes = 6): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}

export function newSongId(): string {
  return newId('song');
}

export function newArrangementId(): string {
  return newId('arr');
}
