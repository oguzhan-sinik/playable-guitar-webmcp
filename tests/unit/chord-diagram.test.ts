import { describe, expect, it } from 'vitest';
import { buildChordDiagram } from '../../src/presentation/guitar/chord-diagram.js';
import { chordDiagramSvg } from '../../src/presentation/guitar/chord-diagram-svg.js';
import { findShape } from '../../src/domain/guitar/chord-shape.js';

const D = findShape('D')!;
const F = findShape('F')!;
const Em = findShape('Em')!;
const Bm = findShape('Bm')!;

describe('chord diagram model', () => {
  it('marks open, fretted and muted strings', () => {
    const diagram = buildChordDiagram('D', D);
    const byString = new Map(diagram.strings.map((s) => [s.string, s]));
    // D: high E fret 2, A fret 3, muted low E+A strings (5,6 null)
    expect(byString.get(1)?.fret).toBe(2);
    expect(byString.get(2)?.fret).toBe(3);
    expect(byString.get(5)?.muted).toBe(true);
    expect(byString.get(6)?.muted).toBe(true);
  });

  it('marks open strings (fret 0)', () => {
    const diagram = buildChordDiagram('Em', Em);
    const byString = new Map(diagram.strings.map((s) => [s.string, s]));
    expect(byString.get(1)?.open).toBe(true);
    expect(byString.get(6)?.open).toBe(true);
  });

  it('represents a barre', () => {
    const diagram = buildChordDiagram('F', F);
    expect(diagram.barre).toEqual({ fret: 1, fromString: 1, toString: 6 });
    // barre finger covers the fret-1 strings (1, 2, 6); 3+4 are fretted higher
    expect(diagram.strings.filter((s) => s.barre).map((s) => s.string)).toEqual([1, 2, 6]);
  });

  it('shows capo context without changing shape positions', () => {
    const diagram = buildChordDiagram('Bm', Bm, 6);
    expect(diagram.capo).toBe(6);
    expect(diagram.strings.map((s) => s.absoluteFret)).toEqual([2, 3, 4, 4, 2, 0]);
  });

  it('shifts the fret window for high positions', () => {
    const bb = findShape('Bb')!;
    const diagram = buildChordDiagram('Bb', bb, 0, 4);
    expect(diagram.baseFret).toBe(6);
    // lowest fretted fret maps to row 1
    expect(diagram.strings.every((s) => s.fret >= 0 && s.fret <= 4)).toBe(true);
  });
});

describe('chord diagram svg', () => {
  it('renders synchronous, self-contained svg', () => {
    const svg = chordDiagramSvg(buildChordDiagram('D', D, 6));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('aria-label="D chord diagram, capo 6"');
    expect(svg).toContain('capo 6');
  });

  it('draws dots, open circles, muted crosses and a barre bar', () => {
    const open = chordDiagramSvg(buildChordDiagram('Em', Em));
    expect((open.match(/circle/g) ?? []).length).toBeGreaterThanOrEqual(2); // open strings
    const barred = chordDiagramSvg(buildChordDiagram('F', F));
    expect(barred).toContain('<rect'); // barre bar
    const muted = chordDiagramSvg(buildChordDiagram('D', D));
    expect(muted).toContain('×');
    expect((muted.match(/circle cx/g) ?? []).length).toBeGreaterThanOrEqual(2); // fret dots
  });
});
