import type { PracticePreview, PreviewCacheKeyInput } from './preview-render.js';
import { previewCacheKey } from './preview-render.js';

export type { PreviewCacheKeyInput };

/**
 * Rendered-preview cache. Key: songGraph + arrangement + section + tempo +
 * metronome. Repeated previews are near-instant. Bounded LRU-ish (oldest
 * evicted past the cap) so long agent sessions don't accumulate buffers.
 */
const MAX_ENTRIES = 20;
const cache = new Map<string, PracticePreview>();

export function cachePreviewPreview(keyInput: PreviewCacheKeyInput, preview: PracticePreview): void {
  const key = previewCacheKey(keyInput);
  cache.set(key, preview);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function getCachedPreview(keyInput: PreviewCacheKeyInput): PracticePreview | undefined {
  return cache.get(previewCacheKey(keyInput));
}

export function clearPreviewCache(): void {
  cache.clear();
}
