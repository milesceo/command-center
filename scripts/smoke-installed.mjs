#!/usr/bin/env node
// Checks an installed (or extracted) copy of the app, or a macOS .app bundle, without a display:
// the bundled Node starts the bundled bridge, the bridge answers a ping, and the bundled Claude
// runtime starts. It cannot check the login; that comes from the user's own profile.
//   node scripts/smoke-installed.mjs <install-dir>
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const win = process.platform === 'win32';
const exe = (name) => (win ? `${name}.exe` : name);

/** First file called `name` anywhere under `dir` (installers differ in how they nest resources). */
function find(dir, name, depth = 4) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === name && statSync(path).isFile()) return path;
    if (depth > 0 && statSync(path).isDirectory()) {
      const found = find(path, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function need(dir, name) {
  const found = find(dir, name);
  // An empty file is a lite or placeholder stand-in: never acceptable in a release.
  if (found && statSync(found).size === 0) {
    console.error(`FAIL ${name} at ${found} is an empty stand-in (lite or placeholder build)`);
    process.exit(1);
  }
  if (!found) {
    console.error(`FAIL ${name} not found under ${dir}`);
    process.exit(1);
  }
  console.log(`ok   found ${found}`);
  return found;
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: smoke-installed.mjs <install-dir>');
  process.exit(2);
}

const node = need(dir, exe('node'));
const main = need(dir, 'main.mjs');
const claude = need(dir, exe('claude'));

// On macOS an invalid signature gets a bundled binary killed on launch; check both are signed.
if (process.platform === 'darwin') {
  for (const bin of [node, claude]) {
    execFileSync('codesign', ['--verify', '--strict', bin], { stdio: 'pipe' });
    console.log(`ok   signature valid: ${bin}`);
  }
}

const version = execFileSync(claude, ['--version'], { encoding: 'utf8', timeout: 60_000 }).trim();
console.log(`ok   claude runtime: ${version}`);

// Environment kept minimal on purpose: the installed app has no dev setup.
const child = spawn(node, [main], {
  env: {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    COMMAND_CENTER_CLAUDE_EXECUTABLE: claude,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const answer = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no pong within 15 s')), 15_000);
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    const line = buf.split('\n').find((l) => l.includes('"pong"'));
    if (line) {
      clearTimeout(timer);
      resolve(JSON.parse(line));
    }
  });
  child.on('exit', (code) => reject(new Error(`bridge exited early (${code})`)));
  child.stdin.write(`${JSON.stringify({ type: 'ping', id: 'smoke', sentAt: Date.now() })}\n`);
}).finally(() => child.kill());
console.log(`ok   bridge answered: ${JSON.stringify(answer)}`);
