import { stringLabel } from './tuning.js';
import type { GuitarPosition } from './guitar-position.js';

/**
 * Monophonic tab: one note per column, columns in playback order.
 * Rows keyed by string number 1-6.
 */
export interface Tablature {
  /** strings 1-6 rows; null = nothing at that column. */
  columns: Array<Partial<Record<number, number>>>;
}

export function tablatureFromPositions(positions: GuitarPosition[]): Tablature {
  return {
    columns: positions.map((p) => ({ [p.string]: p.fret })),
  };
}

const CELL_WIDTH = 4;

/** ASCII tab, string 1 (e) on top. Not pretty-printed; for CLI inspection. */
export function formatTablature(tab: Tablature): string {
  const width = Math.max(1, tab.columns.length) * CELL_WIDTH + 1;
  const rows: string[] = [];
  for (let string = 1; string <= 6; string++) {
    let line = `${stringLabel(string)}|`;
    for (const col of tab.columns) {
      const fret = col[string];
      const cell = fret === undefined ? '--' : `-${fret}-`;
      line += cell.padEnd(CELL_WIDTH, '-');
    }
    rows.push(line.slice(0, width).padEnd(width, '-') + '|');
  }
  return rows.join('\n');
}
