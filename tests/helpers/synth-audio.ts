import { writeFile } from 'node:fs/promises';

/** Deterministic synthetic WAV generation for analysis tests. PCM s16le mono. */
export async function writeWav(filePath: string, samples: Float32Array, sampleRate = 44100): Promise<void> {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  await writeFile(filePath, buffer);
}

/** Sharp click impulses at the given BPM. */
export function clickTrack(bpm: number, durationSeconds: number, sampleRate = 44100): Float32Array {
  const samples = new Float32Array(Math.round(durationSeconds * sampleRate));
  const clickLength = Math.round(sampleRate * 0.01);
  const interval = (60 / bpm) * sampleRate;
  for (let t = 0; t < samples.length; t += interval) {
    const start = Math.round(t);
    for (let i = 0; i < clickLength && start + i < samples.length; i++) {
      samples[start + i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * Math.exp(-i / 100);
    }
  }
  return samples;
}

const PITCH_CLASS_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** Additive synth chord: root triad + two octaves of the root for stability. */
function synthChord(
  out: Float32Array,
  startSample: number,
  lengthSamples: number,
  midiNotes: number[],
  sampleRate: number,
): void {
  const fade = Math.max(1, Math.min(Math.round(sampleRate * 0.02), Math.floor(lengthSamples / 4)));
  for (let i = 0; i < lengthSamples; i++) {
    const idx = startSample + i;
    if (idx >= out.length) break;
    const edge = Math.min(1, Math.min(i, lengthSamples - 1 - i) / fade);
    let v = 0;
    for (const midi of midiNotes) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      v += Math.sin((2 * Math.PI * f * i) / sampleRate) / midiNotes.length;
      // first harmonic adds spectral realism for HPCP/key detection
      v += Math.sin((2 * Math.PI * f * 2 * i) / sampleRate) / (midiNotes.length * 4);
    }
    out[idx] = (out[idx] ?? 0) + v * edge * 0.6;
  }
}

function triadMidi(rootPc: number, minor: boolean): number[] {
  const third = minor ? 3 : 4;
  const root = 48 + rootPc; // C3-ish
  return [root, root + third, root + 7];
}

/** Sustained chord progression, one chord after another. */
export function chordProgressionTrack(
  chords: Array<{ root: string; minor: boolean }>,
  secondsPerChord: number,
  sampleRate = 44100,
): Float32Array {
  const total = Math.round(chords.length * secondsPerChord * sampleRate);
  const out = new Float32Array(total);
  const chordSamples = Math.round(secondsPerChord * sampleRate);
  chords.forEach((c, i) => {
    synthChord(out, i * chordSamples, chordSamples, triadMidi(PITCH_CLASS_SEMITONES[c.root]!, c.minor), sampleRate);
  });
  return out;
}

/** Percussive tick (short noise burst with pitch). */
function tick(out: Float32Array, startSample: number, strength: number, sampleRate: number): void {
  const length = Math.round(sampleRate * 0.03);
  for (let i = 0; i < length && startSample + i < out.length; i++) {
    const env = Math.exp(-i / (length / 5));
    out[startSample + i]! += strength * env * Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.8;
  }
}

/**
 * Drum-pattern track: pulses at `pulsesPerBar` per bar with accent strengths,
 * e.g. 4/4 = [1, 0.3, 0.5, 0.3]; 6/8 = [1, 0.25, 0.25, 0.6, 0.25, 0.25].
 */
export function accentPatternTrack(
  accents: number[],
  barCount: number,
  secondsPerBar: number,
  sampleRate = 44100,
): Float32Array {
  const total = Math.round(barCount * secondsPerBar * sampleRate);
  const out = new Float32Array(total);
  const step = secondsPerBar / accents.length;
  for (let bar = 0; bar < barCount; bar++) {
    accents.forEach((strength, i) => {
      if (strength > 0) {
        tick(out, Math.round((bar * secondsPerBar + i * step) * sampleRate), strength, sampleRate);
      }
    });
  }
  return out;
}
