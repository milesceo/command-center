import { createInterface } from 'node:readline';
import { encodeMessage } from '@command-center/protocol';
import { Bridge } from './handler';
import { loadQuery } from './sdk';

// stdout carries protocol messages only; anything human-readable goes to stderr.
const bridge = new Bridge({
  getQuery: loadQuery,
  emit: (event) => process.stdout.write(encodeMessage(event)),
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  if (line.trim().length === 0) return;
  bridge.handleLine(line);
});

// The parent closing our stdin means the app is gone: stop any running chats
// (so no orphaned runtime processes keep burning usage) and exit.
rl.on('close', () => {
  bridge.abortAll();
  process.exit(0);
});

console.error('[bridge] ready');
