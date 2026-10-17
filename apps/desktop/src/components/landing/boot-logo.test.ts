import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { angleAt, renderSpin } from '../../lib/ascii3d';
import { LOGO_COLS, LOGO_ROWS, LOGO_WORD } from './AsciiLogo';

// index.html embeds the first frame as static text so it paints before any script runs. If it
// drifted from what the splash renders, the hand-off from the boot logo to the splash would jump.
describe('the static boot logo in index.html', () => {
  it('is the splash still frame of the current wordmark', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../../../index.html', import.meta.url)),
      'utf8',
    );
    const embedded = /<pre class="boot-logo" aria-hidden="true">\n([\s\S]*?)<\/pre>/.exec(
      html,
    )?.[1];
    expect(embedded).toBeDefined();
    const trim = (lines: string[]) => lines.map((l) => l.trimEnd()).join('\n');
    expect(trim((embedded ?? '').split('\n'))).toBe(
      trim(renderSpin(LOGO_WORD, angleAt(0, true), LOGO_COLS, LOGO_ROWS)),
    );
  });
});
