import { createInterface } from 'node:readline';
import { encodeMessage } from '@programish/protocol';
import { handleLine } from './handler';

// stdout carries protocol messages only; anything human-readable goes to stderr.
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  if (line.trim().length === 0) return;
  for (const event of handleLine(line)) process.stdout.write(encodeMessage(event));
});

// The parent closing our stdin means the app is gone; exit instead of lingering.
rl.on('close', () => process.exit(0));

console.error('[bridge] ready');
