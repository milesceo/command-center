import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeMessage, parseEvent } from '@programish/protocol';

// Runs the built sidecar for real: this is the same wiring Tauri uses.
const entry = fileURLToPath(new URL('../dist/main.mjs', import.meta.url));

describe('bridge process', () => {
  it('completes a ping/pong round trip over stdio', async () => {
    const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
    const line = await new Promise<string>((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) resolve(buf.slice(0, nl));
      });
      child.on('error', reject);
      child.stdin.write(encodeMessage({ type: 'ping', id: 'e2e', sentAt: Date.now() }));
    });
    child.stdin.end();

    const parsed = parseEvent(line);
    expect(parsed).toMatchObject({ ok: true, value: { type: 'pong', id: 'e2e' } });
  });
});
