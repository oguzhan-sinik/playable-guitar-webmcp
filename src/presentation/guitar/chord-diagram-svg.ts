import type { ChordDiagram } from './chord-diagram.js';

export interface DiagramSvgOptions {
  width?: number;
  height?: number;
  /** CSS class hooks for theming; colors inherit from currentColor where possible. */
  className?: string;
  showCapo?: boolean;
}

const FRET_ROWS = 4;

/**
 * Render a chord diagram as an SVG string. Synchronous and cheap — safe to
 * regenerate inline; cache per shape+capo upstream if profiling ever cares.
 *
 * Layout: vertical grid, string 1 (high E) on the LEFT per the repo's
 * GuitarChordShape convention, frets top to bottom. Dots for fretted
 * strings, ○ above the nut for open, × for muted, one rounded bar for barre.
 */
export function chordDiagramSvg(diagram: ChordDiagram, options: DiagramSvgOptions = {}): string {
  const width = options.width ?? 92;
  const height = options.height ?? 128;
  const showCapo = options.showCapo ?? true;
  const className = options.className ?? 'chord-diagram';

  const nameH = 20;
  const gridTop = nameH + 10;
  const gridH = height - gridTop - 8;
  const gridW = width - 20;
  const left = 10;
  const stringGap = gridW / 5;
  const fretGap = gridH / FRET_ROWS;

  const stringX = (s: number): number => left + (s - 1) * stringGap;
  const fretY = (f: number): number => gridTop + f * fretGap;

  const stroke = 'currentColor';
  const parts: string[] = [];

  parts.push(
    `<svg class="${className}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(diagram.name)} chord diagram${diagram.capo > 0 ? `, capo ${diagram.capo}` : ''}">`,
  );

  parts.push(
    `<text x="${width / 2}" y="14" text-anchor="middle" font-size="14" font-weight="700" fill="${stroke}">${esc(diagram.name)}</text>`,
  );

  // frets
  for (let f = 0; f <= FRET_ROWS; f++) {
    const y = fretY(f);
    const nut = f === 0 && diagram.baseFret === 1;
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${left + gridW}" y2="${y}" stroke="${stroke}" stroke-width="${nut ? 2.5 : 1}" opacity="${nut ? 1 : 0.35}"/>`,
    );
  }
  // strings
  for (let s = 1; s <= 6; s++) {
    parts.push(
      `<line x1="${stringX(s)}" y1="${gridTop}" x2="${stringX(s)}" y2="${gridTop + gridH}" stroke="${stroke}" stroke-width="1" opacity="0.35"/>`,
    );
  }
  // base-fret label for shifted windows
  if (diagram.baseFret > 1) {
    parts.push(
      `<text x="${left - 2}" y="${gridTop + fretGap * 0.7}" font-size="9" fill="${stroke}" opacity="0.7" text-anchor="start">${diagram.baseFret}</text>`,
    );
  }

  // barre bar
  if (diagram.barre !== undefined && diagram.barre.fret >= 1) {
    const y = fretY(diagram.barre.fret) - fretGap / 2;
    const x1 = stringX(diagram.barre.fromString);
    const x2 = stringX(diagram.barre.toString);
    parts.push(
      `<rect x="${Math.min(x1, x2) - 4}" y="${y - 4.5}" width="${Math.abs(x2 - x1) + 8}" height="9" rx="4.5" fill="${stroke}" opacity="0.85"/>`,
    );
  }

  // string markers
  for (const s of diagram.strings) {
    const x = stringX(s.string);
    if (s.muted) {
      parts.push(
        `<text x="${x}" y="${gridTop - 4}" text-anchor="middle" font-size="10" fill="${stroke}" opacity="0.75">×</text>`,
      );
    } else if (s.open) {
      parts.push(
        `<circle cx="${x}" cy="${gridTop - 7}" r="4" fill="none" stroke="${stroke}" stroke-width="1.4" opacity="0.85"/>`,
      );
    } else if (s.fret >= 1 && !s.barre) {
      const y = fretY(s.fret) - fretGap / 2;
      parts.push(`<circle cx="${x}" cy="${y}" r="5.5" fill="${stroke}"/>`);
    }
  }

  if (showCapo && diagram.capo > 0) {
    parts.push(
      `<text x="${width / 2}" y="${height - 1}" text-anchor="middle" font-size="9.5" fill="${stroke}" opacity="0.75">capo ${diagram.capo}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
