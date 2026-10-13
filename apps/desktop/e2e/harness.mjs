// Browser-level end-to-end harness.
//
// Runs the real UI in headless Chromium and emulates the Tauri side in Node:
//   - `invoke('plugin:sql|…')` is served by a real SQLite file (node:sqlite) with
//     the real migrations applied, so data survives an app "restart" (new page).
//   - `invoke('bridge_start' | 'bridge_send')` drives the real bridge sidecar
//     process over stdio, exactly like src-tauri/src/bridge.rs does.
// By default the sidecar uses a fake SDK (deterministic, no login needed);
// set E2E_REAL=1 to talk to the real Claude runtime instead.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const bridgeEntry = join(desktop, '../../packages/bridge/dist/main.mjs');
const fakeSdk = join(desktop, '../../packages/bridge/test/fake-sdk.mjs');
export const outDir = process.env.E2E_OUT ?? join(here, 'out');
mkdirSync(outDir, { recursive: true });

function findChromium() {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  const candidate = dir && join(root, dir, 'chrome-linux', 'chrome');
  if (candidate && existsSync(candidate)) return candidate;
  throw new Error('Set E2E_CHROMIUM to a Chromium/Chrome executable.');
}

function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'conversations'").get();
  if (!has) {
    const dir = join(desktop, 'src-tauri/migrations');
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(join(dir, f), 'utf8'));
    }
  }
  return db;
}

/** Injected before the app loads: a minimal stand-in for window.__TAURI_INTERNALS__. */
function installTauriShim() {
  const callbacks = new Map();
  const listeners = new Map();
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb, once) {
      const id = Math.floor(Math.random() * 2 ** 31);
      callbacks.set(id, (d) => (once && callbacks.delete(id), cb(d)));
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (p) => p,
    async invoke(cmd, args) {
      if (cmd === 'plugin:event|listen') {
        const list = listeners.get(args.event) ?? [];
        list.push(args.handler);
        listeners.set(args.event, list);
        return args.handler;
      }
      if (cmd === 'plugin:event|unlisten') return null;
      return window.__e2e_invoke(cmd, args);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__e2e_emit = (event, payload) => {
    for (const handler of listeners.get(event) ?? [])
      callbacks.get(handler)?.({ event, id: handler, payload });
  };
}

export async function startHarness({ real = process.env.E2E_REAL === '1' } = {}) {
  const dbFile = join(mkdtempSync(join(tmpdir(), 'programish-e2e-')), 'programish.db');
  const db = openDatabase(dbFile);
  // E2E_PROD=1 serves the production build, which is what perf numbers should be taken from
  // (the dev server runs React's slower development build with StrictMode double rendering).
  let server;
  let url;
  if (process.env.E2E_PROD === '1') {
    const outDir = mkdtempSync(join(tmpdir(), 'programish-dist-'));
    await build({
      root: desktop,
      logLevel: 'error',
      build: { outDir, emptyOutDir: true, minify: process.env.E2E_MINIFY !== '0' },
    });
    server = await preview({
      root: desktop,
      logLevel: 'error',
      build: { outDir },
      preview: { port: 0 },
    });
    url = server.resolvedUrls.local[0];
  } else {
    server = await createServer({ root: desktop, logLevel: 'error', server: { port: 0 } });
    await server.listen();
    url = server.resolvedUrls.local[0];
  }
  const browser = await chromium.launch({ executablePath: findChromium() });
  const consoleErrors = [];

  /** Opens the app like a fresh launch: new page, new sidecar process, same database. */
  async function launch({ viewport = { width: 1200, height: 780 }, theme } = {}) {
    const context = await browser.newContext({
      viewport,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    let child = null;
    const emit = (event, payload) =>
      page.evaluate(([e, p]) => window.__e2e_emit(e, p), [event, payload]).catch(() => {});

    await page.exposeFunction('__e2e_invoke', async (cmd, args) => {
      switch (cmd) {
        case 'plugin:sql|load':
          return args.db;
        case 'plugin:sql|select': {
          const rows = db.prepare(args.query.replace(/\$\d+/g, '?')).all(...args.values);
          return rows;
        }
        case 'plugin:sql|execute': {
          const r = db.prepare(args.query.replace(/\$\d+/g, '?')).run(...args.values);
          return [Number(r.changes), Number(r.lastInsertRowid)];
        }
        case 'bridge_start': {
          if (child && child.exitCode === null) return null;
          child = spawn(process.execPath, [bridgeEntry], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: real ? process.env : { ...process.env, PROGRAMISH_QUERY_MODULE: fakeSdk },
          });
          // Writing to a killed sidecar raises EPIPE; the app learns of it from the exit event.
          child.stdin.on('error', () => {});
          let buf = '';
          child.stdout.on('data', (chunk) => {
            buf += chunk;
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
              void emit('bridge://line', buf.slice(0, nl));
              buf = buf.slice(nl + 1);
            }
          });
          child.on('exit', () => void emit('bridge://exit', null));
          return null;
        }
        case 'bridge_send':
          child?.stdin.write(`${args.line.replace(/\n$/, '')}\n`);
          return null;
        default:
          throw new Error(`Unhandled invoke: ${cmd}`);
      }
    });
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.addInitScript(installTauriShim);
    if (theme)
      await page.addInitScript(
        (t) =>
          localStorage.setItem(
            'programish-ui',
            JSON.stringify({
              state: { theme: t, sidebarOpen: true, rightPanelOpen: false },
              version: 0,
            }),
          ),
        theme,
      );
    await page.goto(url);
    await page.waitForSelector('aside >> text=/Bridge ready|pong \\d+ms/');
    return {
      page,
      killBridge: () => child?.kill('SIGKILL'),
      close: async () => {
        child?.kill();
        await context.close();
      },
    };
  }

  return {
    db,
    launch,
    consoleErrors,
    stop: async () => {
      await browser.close();
      await (server.close?.() ?? server.httpServer.close());
    },
  };
}
