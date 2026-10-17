/**
 * Frame generator for the lock screen's animated ASCII. Pure and deterministic: the same
 * (size, time) always gives the same text, so it is tested without a DOM and the component
 * only decides when to draw.
 */

/** Dark to light. Plain ASCII so every font renders it at the same width. */
export const RAMP = ' .:-=+*#%@';

const rampChar = (value: number): string => {
  const clamped = Math.min(0.999, Math.max(0, value));
  return RAMP.charAt(Math.floor(clamped * RAMP.length));
};

/** Smooth interference pattern in 0..1. */
export function plasma(x: number, y: number, t: number): number {
  const v =
    Math.sin(x * 0.11 + t * 0.9) +
    Math.sin(y * 0.23 - t * 0.6) +
    Math.sin((x + y) * 0.07 + t * 0.4) +
    Math.sin(Math.hypot(x - 40, (y - 12) * 2) * 0.12 - t * 0.8);
  return (v + 4) / 8;
}

/** The background: a quiet field that only uses the darker half of the ramp. */
export function fieldFrame(cols: number, rows: number, t: number): string {
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) line += rampChar(plasma(x, y, t) * 0.55);
    lines.push(line);
  }
  return lines.join('\n');
}

// 5x5 pixel font for the wordmark.
const GLYPHS: Record<string, readonly string[]> = {
  P: ['####.', '#...#', '####.', '#....', '#....'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  G: ['.####', '#....', '#.###', '#...#', '.###.'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....'],
};

/** Rows of `#` and space spelling `text`, each pixel `scale` columns wide. */
export function bannerRows(text: string, scale = 1): string[] {
  const letters = [...text.toUpperCase()].map((ch) => GLYPHS[ch] ?? GLYPHS.O!);
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    const parts = letters.map((glyph) =>
      [...(glyph[r] ?? '')].map((c) => (c === '#' ? '#' : ' ').repeat(scale)).join(''),
    );
    rows.push(parts.join(' '.repeat(scale)));
  }
  return rows;
}

/** Width in columns of the wordmark at a given scale. */
export const bannerWidth = (text: string, scale = 1): number =>
  text.length * 5 * scale + (text.length - 1) * scale;

/**
 * The wordmark with a light sweeping across it: lit pixels take characters from the bright
 * end of the ramp, offset by a travelling wave.
 */
export function bannerFrame(rows: readonly string[], t: number): string {
  return rows
    .map((row, y) =>
      [...row]
        .map((c, x) => {
          if (c !== '#') return ' ';
          const wave = (Math.sin(x * 0.18 - t * 2.2 + y * 0.6) + 1) / 2;
          return rampChar(0.62 + wave * 0.38);
        })
        .join(''),
    )
    .join('\n');
}
