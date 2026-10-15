/**
 * A spinning, extruded wordmark rendered as ASCII: the same idea as the classic ASCII donut.
 *
 * The word is built as voxel geometry (each lit pixel of the 5x5 font becomes a cube of
 * `DEPTH` units), reduced to its visible surface (front and back faces plus any side face with
 * an empty neighbour), sampled into points that carry their face normal, rotated around the Y
 * axis, perspective-projected onto a character grid with a depth buffer, and shaded by a
 * Lambert term mapped onto a luminance ramp.
 *
 * Pure and deterministic: `renderSpin(word, angle, ...)` always returns the same frame, so the
 * animation loop is just `angle = t * speed`.
 */

import { bannerRows } from './ascii-field';

/** Dark to bright. The leading space is "nothing here". */
export const SHADE_RAMP = ' .,-~:;=!*#$@';

/** Extrusion depth in voxel units (a pixel of the font is 1 x 1). */
const DEPTH = 2.5;
/** Surface samples per voxel edge; enough that projected points leave no holes. */
const SAMPLES = 4;
/** Camera distance from the centre of the word, in voxel units. */
const CAMERA = 110;
/** Fixed downward tilt (radians) so top faces show and the solid reads as 3D. */
const TILT = 0.1;
/** Terminal cells are about twice as tall as wide. */
const CELL_ASPECT = 0.5;

interface Point {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

const geometryCache = new Map<string, Point[]>();

/** Surface points of the extruded word, centred on the origin. Cached per word. */
export function buildGeometry(word: string): Point[] {
  const cached = geometryCache.get(word);
  if (cached) return cached;

  const rows = bannerRows(word, 1);
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const filled = (x: number, y: number) => rows[y]?.[x] === '#';
  const points: Point[] = [];
  const half = DEPTH / 2;
  const step = 1 / SAMPLES;

  // Positions are cell-local offsets, then shifted so the word is centred; y points up.
  const cx = width / 2;
  const cy = height / 2;
  const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number) =>
    points.push({ x: x - cx, y: cy - y, z, nx, ny, nz });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      for (let a = 0; a < SAMPLES; a++) {
        for (let b = 0; b < SAMPLES; b++) {
          const u = x + (a + 0.5) * step;
          const v = y + (b + 0.5) * step;
          // Front (toward the viewer, -z) and back faces.
          add(u, v, -half, 0, 0, -1);
          add(u, v, half, 0, 0, 1);
        }
        // Side faces, only where the neighbour is empty. `a` runs along the face.
        for (let d = 0; d < DEPTH * SAMPLES; d++) {
          const z = -half + (d + 0.5) * step;
          const t = x + (a + 0.5) * step;
          const w = y + (a + 0.5) * step;
          if (!filled(x - 1, y)) add(x, w, z, -1, 0, 0);
          if (!filled(x + 1, y)) add(x + 1, w, z, 1, 0, 0);
          if (!filled(x, y - 1)) add(t, y, z, 0, 1, 0);
          if (!filled(x, y + 1)) add(t, y + 1, z, 0, -1, 0);
        }
      }
    }
  }
  geometryCache.set(word, points);
  return points;
}

// Light from the upper left, in front of the word.
const LIGHT = (() => {
  const v = [-0.35, 0.55, -1];
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / len, v[1]! / len, v[2]! / len] as const;
})();

export interface SpinOptions {
  /** Horizontal characters per voxel unit; default fits the word to the grid width. */
  scale?: number;
}

/**
 * One frame of the spinning word, as `rows` strings of `cols` characters.
 * `angle` is the rotation around the vertical axis in radians (0 faces the viewer).
 */
export function renderSpin(
  word: string,
  angle: number,
  cols: number,
  rows: number,
  options: SpinOptions = {},
): string[] {
  const points = buildGeometry(word);
  const wordRows = bannerRows(word, 1);
  const wordWidth = wordRows[0]?.length ?? 1;
  const wordHeight = wordRows.length;
  // Fit the unrotated word (with a little margin) inside the grid.
  const fit = Math.min((cols * 0.86) / wordWidth, (rows * 0.86) / (wordHeight * CELL_ASPECT));
  const sx = options.scale ?? fit;
  const sy = sx * CELL_ASPECT;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tc = Math.cos(TILT);
  const ts = Math.sin(TILT);
  const size = cols * rows;
  const depth = new Float32Array(size).fill(Number.POSITIVE_INFINITY);
  const shade = new Float32Array(size).fill(-1);

  for (const p of points) {
    // Rotate around Y, then tilt around X.
    const ry = p.ny;
    const rnx = p.nx * cos + p.nz * sin;
    const rnz = -p.nx * sin + p.nz * cos;
    const nyT = ry * tc - rnz * ts;
    const nzT = ry * ts + rnz * tc;
    if (nzT >= 0) continue; // faces away from the camera
    const rx = p.x * cos + p.z * sin;
    const rz = -p.x * sin + p.z * cos;
    const y = p.y * tc - rz * ts;
    const z = p.y * ts + rz * tc;
    const perspective = CAMERA / (CAMERA + z);
    const col = Math.round(cols / 2 + rx * sx * perspective);
    const row = Math.round(rows / 2 - y * sy * perspective);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    const index = row * cols + col;
    if (z >= (depth[index] ?? Number.POSITIVE_INFINITY)) continue;
    depth[index] = z;
    const lambert = Math.max(0, rnx * LIGHT[0] + nyT * LIGHT[1] + nzT * LIGHT[2]);
    // A touch of depth cueing: nearer points are slightly brighter.
    const cue = Math.min(1, Math.max(0, 0.5 - z / 40));
    shade[index] = Math.min(1, lambert * 0.85 + cue * 0.15);
  }

  const top = SHADE_RAMP.length - 1;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const value = shade[r * cols + c] ?? -1;
      // Any covered cell gets at least the first visible character.
      line += value < 0 ? ' ' : SHADE_RAMP[1 + Math.min(top - 1, Math.floor(value * (top - 1)))];
    }
    lines.push(line);
  }
  return lines;
}

/** Radians per second for a comfortable turn: one revolution every ~9 seconds. */
export const SPIN_SPEED = (Math.PI * 2) / 9;

/** The angle for a point in time; a fixed three-quarter view when `still`. */
export function angleAt(seconds: number, still = false): number {
  return still ? -0.5 : seconds * SPIN_SPEED;
}
