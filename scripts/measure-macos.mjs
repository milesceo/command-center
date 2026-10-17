#!/usr/bin/env node
// Measures a built macOS app, for the before/after table of performance work:
//   node scripts/measure-macos.mjs "<path to Command Center.app>" [dmg] [--idle-seconds 60]
//
// Reports the .app and dmg sizes, cold start to "bridge ready" (the bridge prints it on stderr once
// it accepts requests; with a lazy bridge this is measured to the window instead), idle memory of
// the app, its webview processes and its bridge, and their CPU use over an idle period.
//
// Method notes, so numbers stay comparable:
// - "Cold start" is from spawning the app binary to the first of: `[bridge] ready` on stderr, or,
//   when no bridge starts, the first WebKit WebContent process appearing plus 1 s (page load).
// - WebKit runs the page in XPC services (com.apple.WebKit.WebContent/Networking/GPU) that are not
//   children of the app; those started within 10 s after launch are counted as the app's.
// - Memory is resident set size (RSS) summed over those processes, after a 10 s settle.
// - CPU is the processes' total CPU time over the idle window divided by its length (100% = one core).
// - Run it on an otherwise idle machine, several times, and compare medians: one run is noisy.
import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const app = args[0];
if (!app) {
  console.error('usage: measure-macos.mjs <App.app> [file.dmg] [--idle-seconds N]');
  process.exit(2);
}
const dmg = args[1] && !args[1].startsWith('--') ? args[1] : null;
const idleIndex = args.indexOf('--idle-seconds');
const IDLE_SECONDS = idleIndex >= 0 ? Number(args[idleIndex + 1]) || 60 : 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;
const duBytes = (path) =>
  Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0]) * 1024;

/** pid, ppid, start (epoch s), rss (KiB), cpu time (s), command for every process. */
function processes() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,rss=,time=,comm='], {
    encoding: 'utf8',
  });
  return out
    .trim()
    .split('\n')
    .map((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\w+ \w+ +\d+ [\d:]+ \d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/.exec(
        line,
      );
      if (!m) return null;
      const [, pid, ppid, lstart, rss, time, comm] = m;
      const parts = time.split(':').map(Number);
      const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        start: Date.parse(lstart) / 1000,
        rss: Number(rss) * 1024,
        cpu: seconds,
        comm,
      };
    })
    .filter(Boolean);
}

function ownProcesses(appPid, launchedAt) {
  const all = processes();
  const mine = new Set([appPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) {
      if (!mine.has(p.pid) && mine.has(p.ppid)) {
        mine.add(p.pid);
        grew = true;
      }
    }
  }
  return all.filter(
    (p) =>
      mine.has(p.pid) ||
      (/com\.apple\.WebKit\./.test(p.comm) &&
        p.start >= Math.floor(launchedAt / 1000) - 1 &&
        p.start <= launchedAt / 1000 + 10),
  );
}

const label = (p) => {
  if (/com\.apple\.WebKit\./.test(p.comm)) return 'webview';
  if (/\/node$|^node$/.test(p.comm)) return 'bridge';
  if (/claude$/.test(p.comm)) return 'runtime';
  return 'app';
};

const results = { app: mib(duBytes(app)) };
if (dmg) results.dmg = mib(statSync(dmg).size);

const exe = join(app, 'Contents/MacOS/command-center');
const launchedAt = Date.now();
const child = spawn(exe, [], { stdio: ['ignore', 'ignore', 'pipe'] });
let readyAt = null;
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  if (readyAt === null && d.includes('[bridge] ready')) readyAt = Date.now();
});

// Never leave the app running, whatever goes wrong below.
process.on('exit', () => child.kill('SIGTERM'));
let firstWebContent = null;
for (let i = 0; i < 200 && readyAt === null; i++) {
  await sleep(100);
  if (firstWebContent === null) {
    const web = ownProcesses(child.pid, launchedAt).find((p) => /WebContent/.test(p.comm));
    if (web) firstWebContent = Date.now();
  }
  if (readyAt === null && firstWebContent !== null && Date.now() - firstWebContent > 4000) break;
}
results.coldStart =
  readyAt !== null
    ? `${readyAt - launchedAt} ms to bridge ready`
    : firstWebContent !== null
      ? `${firstWebContent + 1000 - launchedAt} ms to window, estimate (no bridge started)`
      : 'unknown';

await sleep(10_000);
const before = ownProcesses(child.pid, launchedAt);
const memory = {};
for (const p of before) memory[label(p)] = (memory[label(p)] ?? 0) + p.rss;
results.idleMemory = Object.fromEntries(Object.entries(memory).map(([k, v]) => [k, mib(v)]));
results.idleMemoryTotal = mib(Object.values(memory).reduce((a, b) => a + b, 0));

await sleep(IDLE_SECONDS * 1000);
const after = new Map(ownProcesses(child.pid, launchedAt).map((p) => [p.pid, p]));
let cpu = 0;
for (const p of before) cpu += Math.max(0, (after.get(p.pid)?.cpu ?? p.cpu) - p.cpu);
results.idleCpu = `${((cpu / IDLE_SECONDS) * 100).toFixed(2)}% of one core over ${IDLE_SECONDS} s`;
results.bridgeRunningWhenIdle = [...after.values()].some((p) => label(p) === 'bridge');

child.kill('SIGTERM');
console.log(JSON.stringify(results, null, 2));
