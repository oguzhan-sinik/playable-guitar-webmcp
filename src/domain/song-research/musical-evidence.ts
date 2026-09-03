import { AppError } from '../../errors/app-error.js';
import { domainOf, type EvidenceSource, type EvidenceSourceKind, type EvidenceSubmitter } from './evidence-source.js';

/**
 * A single compact musical FACT observed on a public page (or supplied by the
 * user / a system metadata provider). Deliberately sparse: chord tokens, a
 * bpm, a key — never full tabs, lyrics, or page contents.
 */
export const CLAIM_TYPES = [
  'IDENTITY',
  'KEY',
  'TEMPO',
  'METER',
  'CHORD_SET',
  'CHORD_PROGRESSION',
  'SECTION',
  'SECTION_STRUCTURE',
  'FORM',
  'DURATION',
  'CAPO',
  'SHORT_MOTIF',
] as const;
export type EvidenceClaimType = (typeof CLAIM_TYPES)[number];

export interface MusicalEvidence {
  id: string;
  claimType: EvidenceClaimType;
  value: unknown;
  source: EvidenceSource;
  context?: {
    section?: string;
    chordRepresentation?: 'SOUNDING_HARMONY' | 'PLAYED_GUITAR_SHAPES' | 'UNKNOWN';
    capo?: number;
  };
  submittedBy: EvidenceSubmitter;
  observedAt: string;
  confidence?: number;
}

/** Copyright-size safeguards: evidence payloads stay small on purpose. */
export const MAX_CHORD_TOKENS = 32;
export const MAX_VALUE_CHARS = 4_000;
export const MAX_TITLE_CHARS = 300;
export const MAX_MOTIF_NOTES = 16;
export const MAX_MOTIF_BARS = 4;
export const MAX_FORM_SECTIONS = 24;

let counter = 0;
export function newEvidenceId(): string {
  counter += 1;
  return `ev_${Date.now().toString(36)}_${counter.toString(36)}`;
}

const KNOWN_SOURCE_KINDS: EvidenceSourceKind[] = [
  'OFFICIAL_METADATA', 'MUSIC_DATABASE', 'CHORD_RESOURCE', 'MUSIC_ANALYSIS_RESOURCE', 'ARTICLE', 'OTHER',
];

function tooLarge(what: string): AppError {
  return new AppError('EVIDENCE_TOO_LARGE', `${what} exceeds the evidence size cap — submit compact musical facts only.`);
}

/**
 * Validate + normalize an incoming evidence payload. Throws EVIDENCE_TOO_LARGE
 * (never stores) for oversized content, DOMAIN_VALIDATION for malformed input.
 */
export function validateEvidence(raw: {
  claimType?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  sourceTitle?: unknown;
  sourceKind?: unknown;
  submittedBy?: unknown;
  section?: unknown;
  chordRepresentation?: unknown;
  capo?: unknown;
  confidence?: unknown;
  observedAt?: string;
}): MusicalEvidence {
  const claimType = raw.claimType;
  if (typeof claimType !== 'string' || !(CLAIM_TYPES as readonly string[]).includes(claimType)) {
    throw new AppError('DOMAIN_VALIDATION', `claimType must be one of ${CLAIM_TYPES.join(', ')}`);
  }
  const claim = claimType as EvidenceClaimType;
  const submittedBy: EvidenceSubmitter =
    raw.submittedBy === 'USER' || raw.submittedBy === 'SYSTEM_PROVIDER' ? raw.submittedBy : 'WEBMCP_AGENT';

  // source URL is mandatory except for direct USER statements
  let url = '';
  if (typeof raw.sourceUrl === 'string') url = raw.sourceUrl.trim();
  if (submittedBy !== 'USER' && url.length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'sourceUrl is required — evidence must cite where the fact was observed.');
  }
  if (url.length > 0) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    } catch {
      throw new AppError('DOMAIN_VALIDATION', `sourceUrl is not a valid http(s) URL: "${url}"`);
    }
  }

  const sourceTitle = typeof raw.sourceTitle === 'string' ? raw.sourceTitle.slice(0, MAX_TITLE_CHARS) : undefined;
  const sourceKind: EvidenceSourceKind =
    typeof raw.sourceKind === 'string' && KNOWN_SOURCE_KINDS.includes(raw.sourceKind as EvidenceSourceKind)
      ? (raw.sourceKind as EvidenceSourceKind)
      : 'OTHER';

  const value = validateValue(claim, raw.value);

  const context: MusicalEvidence['context'] = {
    ...(typeof raw.section === 'string' && raw.section.trim().length > 0 ? { section: raw.section.trim().slice(0, 60) } : {}),
    ...(raw.chordRepresentation === 'SOUNDING_HARMONY' ||
    raw.chordRepresentation === 'PLAYED_GUITAR_SHAPES' ||
    raw.chordRepresentation === 'UNKNOWN'
      ? { chordRepresentation: raw.chordRepresentation }
      : {}),
    ...(typeof raw.capo === 'number' && Number.isInteger(raw.capo) && raw.capo >= 0 && raw.capo <= 11
      ? { capo: raw.capo }
      : {}),
  };
  const hasContext = Object.keys(context).length > 0;

  return {
    id: newEvidenceId(),
    claimType: claim,
    value,
    source: {
      url,
      domain: url.length > 0 ? domainOf(url) : 'user',
      ...(sourceTitle !== undefined && { title: sourceTitle }),
      kind: sourceKind,
    },
    ...(hasContext && { context }),
    submittedBy,
    observedAt: raw.observedAt ?? new Date().toISOString(),
    ...(typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
      ? { confidence: raw.confidence }
      : {}),
  };
}

function validateValue(claimType: EvidenceClaimType, value: unknown): unknown {
  if (value === undefined || value === null) {
    throw new AppError('DOMAIN_VALIDATION', 'value is required');
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > MAX_VALUE_CHARS) {
    throw tooLarge('value');
  }
  const v = value as Record<string, unknown>;

  switch (claimType) {
    case 'IDENTITY': {
      const out: Record<string, unknown> = {};
      for (const key of ['title', 'artist', 'album', 'isrc', 'musicBrainzRecordingId'] as const) {
        if (typeof v[key] === 'string' && (v[key] as string).length > 0) out[key] = (v[key] as string).slice(0, MAX_TITLE_CHARS);
      }
      if (typeof v.durationSeconds === 'number' && v.durationSeconds > 0) out.durationSeconds = v.durationSeconds;
      if (Object.keys(out).length === 0) throw new AppError('DOMAIN_VALIDATION', 'IDENTITY value needs title/artist/durationSeconds/isrc');
      return out;
    }
    case 'KEY': {
      if (typeof v.key !== 'string' || v.key.trim().length === 0) throw new AppError('DOMAIN_VALIDATION', 'KEY value needs { key: "Ab major" }');
      return { key: v.key.trim().slice(0, 40) };
    }
    case 'TEMPO': {
      const bpm = typeof v.bpm === 'number' ? v.bpm : (typeof v === 'number' ? v : undefined);
      if (bpm === undefined || !(bpm > 10 && bpm < 400)) throw new AppError('DOMAIN_VALIDATION', 'TEMPO value needs { bpm: number (10-400) }');
      return { bpm };
    }
    case 'METER': {
      if (typeof value === 'string') {
        const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
        if (m) return { numerator: Number(m[1]), denominator: Number(m[2]) };
      }
      const n = typeof v.numerator === 'number' ? v.numerator : undefined;
      const d = typeof v.denominator === 'number' ? v.denominator : undefined;
      if (n === undefined || d === undefined || n < 1 || n > 12 || ![1, 2, 4, 8, 16].includes(d)) {
        throw new AppError('DOMAIN_VALIDATION', 'METER value needs { numerator, denominator } (e.g. { numerator: 6, denominator: 8 })');
      }
      return { numerator: n, denominator: d };
    }
    case 'CHORD_SET':
    case 'CHORD_PROGRESSION': {
      const chords = Array.isArray(v.chords) ? v.chords : undefined;
      if (chords === undefined || chords.length === 0 || !chords.every((c) => typeof c === 'string')) {
        throw new AppError('DOMAIN_VALIDATION', `${claimType} value needs { chords: ["Ab", "Fm", ...] }`);
      }
      if (chords.length > MAX_CHORD_TOKENS) {
        throw tooLarge(`more than ${MAX_CHORD_TOKENS} chord tokens`);
      }
      if (chords.some((c) => (c as string).length > 12)) {
        throw tooLarge('individual chord token longer than 12 characters');
      }
      return {
        chords: chords.map((c) => (c as string).trim()),
        ...(typeof v.section === 'string' && v.section.trim().length > 0 ? { section: v.section.trim().slice(0, 60) } : {}),
      };
    }
    case 'SECTION': {
      const name = typeof value === 'string' ? value : (v as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('DOMAIN_VALIDATION', 'SECTION value needs { name: "chorus" }');
      }
      return { name: name.trim().slice(0, 60) };
    }
    case 'SECTION_STRUCTURE':
    case 'FORM': {
      // ordered section labels, e.g. ["intro","verse","chorus",...] — a FORM outline,
      // never a transcription
      const sections = Array.isArray(v.sections)
        ? v.sections
        : Array.isArray(v.order)
          ? v.order
          : Array.isArray(value)
            ? (value as unknown[])
            : undefined;
      if (sections === undefined || sections.length === 0 || !sections.every((s) => typeof s === 'string' && s.trim().length > 0)) {
        throw new AppError('DOMAIN_VALIDATION', `${claimType} value needs { sections: ["intro", "verse", "chorus", ...] }`);
      }
      if (sections.length > MAX_FORM_SECTIONS) {
        throw tooLarge(`more than ${MAX_FORM_SECTIONS} sections`);
      }
      return { sections: (sections as string[]).map((s) => s.trim().slice(0, 40)) };
    }
    case 'SHORT_MOTIF': {
      // a SHORT signature phrase (intro riff / hook) — bounded well below
      // transcription size; full melodies are rejected
      const notes = Array.isArray(v.notes) ? v.notes : undefined;
      if (notes === undefined || notes.length === 0) {
        throw new AppError('DOMAIN_VALIDATION', 'SHORT_MOTIF value needs { notes: [{ pitchClass, octave?, relativeBeat?, durationBeats? }] }');
      }
      if (notes.length > MAX_MOTIF_NOTES) {
        throw tooLarge(`more than ${MAX_MOTIF_NOTES} notes — submit only a short signature phrase, not a melody`);
      }
      const clean = notes.map((n) => {
        const note = n as Record<string, unknown>;
        if (typeof note.pitchClass !== 'number' || !Number.isInteger(note.pitchClass)) return null;
        const out: Record<string, unknown> = { pitchClass: ((note.pitchClass % 12) + 12) % 12 };
        if (typeof note.octave === 'number') out.octave = Math.round(note.octave);
        if (typeof note.relativeBeat === 'number' && note.relativeBeat >= 0) out.relativeBeat = note.relativeBeat;
        if (typeof note.durationBeats === 'number' && note.durationBeats > 0) out.durationBeats = note.durationBeats;
        return out;
      });
      if (clean.some((n) => n === null)) {
        throw new AppError('DOMAIN_VALIDATION', 'each motif note needs at least { pitchClass: 0-11 }');
      }
      const totalBeats = clean.reduce((sum, n) => sum + ((n!.durationBeats as number | undefined) ?? 0), 0);
      const lastBeat = Math.max(0, ...clean.map((n) => (n!.relativeBeat as number | undefined) ?? 0));
      if (totalBeats > MAX_MOTIF_BARS * 4 || lastBeat > MAX_MOTIF_BARS * 4) {
        throw tooLarge(`motif longer than ${MAX_MOTIF_BARS} bars — submit only a short signature phrase`);
      }
      return { notes: clean };
    }
    case 'DURATION': {
      const seconds = typeof v.durationSeconds === 'number' ? v.durationSeconds : (typeof v === 'number' ? v : undefined);
      if (seconds === undefined || seconds <= 0) throw new AppError('DOMAIN_VALIDATION', 'DURATION value needs { durationSeconds: number }');
      return { durationSeconds: seconds };
    }
    case 'CAPO': {
      const capo = typeof v.capo === 'number' ? v.capo : (typeof v === 'number' ? v : undefined);
      if (capo === undefined || !Number.isInteger(capo) || capo < 0 || capo > 11) {
        throw new AppError('DOMAIN_VALIDATION', 'CAPO value needs { capo: 0-11 }');
      }
      return { capo };
    }
  }
}

/**
 * Duplicate suppression: the same fact from the same URL (same claim type,
 * same section context, same normalized chord tokens) must not inflate
 * confidence by being submitted twice.
 */
export function evidenceFingerprint(ev: MusicalEvidence): string {
  const v = ev.value as Record<string, unknown>;
  let valuePart: string;
  if (ev.claimType === 'CHORD_SET' || ev.claimType === 'CHORD_PROGRESSION') {
    valuePart = ((v.chords as string[]) ?? []).join('|');
  } else if (ev.claimType === 'IDENTITY') {
    // same recording = same fact, regardless of which fields each source filled in
    valuePart = String(v.musicBrainzRecordingId ?? v.isrc ?? `${v.title ?? ''}|${v.artist ?? ''}`);
  } else {
    valuePart = JSON.stringify(ev.value);
  }
  const section = ev.context?.section ?? '';
  return `${ev.claimType}::${ev.source.url}::${section.toLowerCase()}::${valuePart.toLowerCase()}`;
}

export function isDuplicate(existing: MusicalEvidence[], candidate: MusicalEvidence): boolean {
  const fp = evidenceFingerprint(candidate);
  return existing.some((ev) => evidenceFingerprint(ev) === fp);
}
