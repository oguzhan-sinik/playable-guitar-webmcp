/**
 * Where a piece of musical evidence came from. Every non-USER claim must name
 * a public URL — provenance is what makes research-derived data auditable.
 */
export type EvidenceSourceKind =
  | 'OFFICIAL_METADATA'
  | 'MUSIC_DATABASE'
  | 'CHORD_RESOURCE'
  | 'MUSIC_ANALYSIS_RESOURCE'
  | 'ARTICLE'
  | 'OTHER';

export type EvidenceSubmitter = 'WEBMCP_AGENT' | 'SYSTEM_PROVIDER' | 'USER';

export interface EvidenceSource {
  url: string;
  /** Normalized host, e.g. "tabs.example.com". */
  domain: string;
  title?: string;
  kind: EvidenceSourceKind;
}

/**
 * Coarse source family used for independence: pages on the same registrable
 * domain count as ONE family. ponytail: last-two-labels heuristic, add a PSL
 * table only if a co.uk-style false merge actually bites.
 */
export function domainFamilyOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
  const labels = host.replace(/^www\./, '').split('.').filter((l) => l.length > 0);
  return labels.slice(-2).join('.');
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url;
  }
}
