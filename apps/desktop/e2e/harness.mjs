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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const bridgeEntry =
  process.env.E2E_BRIDGE_ENTRY ?? join(desktop, '../../packages/bridge/dist/main.mjs');
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
  // Only the app's own frame gets the IPC bridge; previewed pages (iframes) must not see it.
  if (window.top !== window) return;
  const callbacks = new Map();
  const listeners = new Map();
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb, once) {
      const id = Math.floor(Math.random() * 2 ** 31);
      callbacks.set(id, (d) => (once && callbacks.delete(id), cb(d)));
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    // Windows form of custom-scheme URLs; the harness answers these requests itself (see launch()).
    convertFileSrc: (p, scheme = 'asset') => `http://${scheme}.localhost/${p}`,
    async invoke(cmd, args, options) {
      if (cmd === 'plugin:event|listen') {
        const list = listeners.get(args.event) ?? [];
        list.push(args.handler);
        listeners.set(args.event, list);
        return args.handler;
      }
      if (cmd === 'plugin:event|unlisten') return null;
      // Binary bodies (the fs plugin writes Uint8Array) cannot cross the exposed-function boundary as-is.
      return window.__e2e_invoke(
        cmd,
        args instanceof Uint8Array ? { __bytes: Array.from(args) } : args,
        options ? { headers: options.headers } : undefined,
      );
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__e2e_emit = (event, payload) => {
    for (const handler of listeners.get(event) ?? [])
      callbacks.get(handler)?.({ event, id: handler, payload });
  };
}

export async function startHarness({ real = process.env.E2E_REAL === '1' } = {}) {
  const dbFile = join(mkdtempSync(join(tmpdir(), 'command-center-e2e-')), 'command-center.db');
  const db = openDatabase(dbFile);
  // E2E_PROD=1 serves the production build, which is what perf numbers should be taken from
  // (the dev server runs React's slower development build with StrictMode double rendering).
  let server;
  let url;
  if (process.env.E2E_PROD === '1') {
    const outDir = mkdtempSync(join(tmpdir(), 'command-center-dist-'));
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
  const saved = new Map();
  const saveDir = mkdtempSync(join(tmpdir(), 'command-center-save-'));
  // The CSP the Rust protocol handler sends with every preview document: read from the source so the two cannot drift.
  const previewCsp = /const PREVIEW_CSP: &str = "([^"]+)"/.exec(
    readFileSync(join(desktop, 'src-tauri/src/preview.rs'), 'utf8'),
  )?.[1];
  if (!previewCsp) throw new Error('Could not read PREVIEW_CSP from preview.rs');
  const previewDocs = new Map();
  // Stand-ins for the Rust-side lock, credential store and autostart registration.
  const lockState = { pin: null, failures: 0 };
  const secretStore = new Map();
  const autostart = { enabled: false };

  /** Opens the app like a fresh launch: new page, new sidecar process, same database. */
  /**
   * `layout` is 'classic' (the original sidebar layout the older scripts drive) or 'ide'.
   * `lock` is 'skip' (no PIN, straight in) or 'setup' (the first-run PIN prompt).
   */
  async function launch({
    viewport = { width: 1200, height: 780 },
    theme,
    layout = 'classic',
    lock = 'skip',
    onboarding = false,
    home = false,
    video = undefined,
    splash = false,
    setup = undefined,
  } = {}) {
    const context = await browser.newContext({
      viewport,
      permissions: ['clipboard-read', 'clipboard-write'],
      // `video` is a directory: the page is recorded there as .webm.
      ...(video ? { recordVideo: { dir: video, size: viewport } } : {}),
    });
    // Lets a script stub extra network routes (the status feed) before the page loads.
    if (setup) await setup(context);
    // Stands in for src-tauri/src/preview.rs: same documents, same security headers.
    await context.route('http://preview.localhost/**', (route) => {
      const html = previewDocs.get(new URL(route.request().url()).pathname.slice(1));
      return html === undefined
        ? route.fulfill({ status: 404, body: 'Preview not found' })
        : route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            headers: {
              'content-security-policy': `${previewCsp}; sandbox allow-scripts`,
              'cache-control': 'no-store',
            },
            body: html,
          });
    });
    const page = await context.newPage();
    let child = null;
    const emit = (event, payload) =>
      page.evaluate(([e, p]) => window.__e2e_emit(e, p), [event, payload]).catch(() => {});

    await page.exposeFunction('__e2e_invoke', async (cmd, args, options) => {
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
            env: real ? process.env : { ...process.env, COMMAND_CENTER_QUERY_MODULE: fakeSdk },
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
        case 'lock_status':
          return { hasPin: lockState.pin !== null, failures: lockState.failures, lockedUntilMs: 0 };
        case 'lock_set_pin':
          lockState.pin = args.pin;
          lockState.failures = 0;
          return null;
        case 'lock_verify':
        case 'lock_change':
        case 'lock_remove': {
          const given = args.pin ?? args.current;
          if (lockState.pin === null) return { outcome: 'no_pin', failures: 0, lockedUntilMs: 0 };
          if (given !== lockState.pin) {
            lockState.failures += 1;
            return { outcome: 'wrong', failures: lockState.failures, lockedUntilMs: 0 };
          }
          lockState.failures = 0;
          if (cmd === 'lock_change') lockState.pin = args.next;
          if (cmd === 'lock_remove') lockState.pin = null;
          return { outcome: 'ok', failures: 0, lockedUntilMs: 0 };
        }
        case 'lock_wipe':
          lockState.pin = null;
          lockState.failures = 0;
          return null;
        case 'secret_set':
          secretStore.set(args.provider, args.key);
          return null;
        case 'secret_exists':
          return secretStore.has(args.provider);
        case 'secret_get':
          return secretStore.get(args.provider) ?? null;
        case 'secret_delete':
          secretStore.delete(args.provider);
          return null;
        case 'secret_wipe':
          secretStore.clear();
          return null;
        case 'system_set_close_behavior':
          return null;
        case 'plugin:autostart|is_enabled':
          return autostart.enabled;
        case 'plugin:autostart|enable':
          autostart.enabled = true;
          return null;
        case 'plugin:autostart|disable':
          autostart.enabled = false;
          return null;
        case 'data_location': {
          // Stands in for the Rust command: a representative Windows path, never touched.
          const dir = 'C:\\Users\\you\\AppData\\Roaming\\com.milesceo.commandcenter';
          return { dir, db_file: `${dir}\\command-center.db` };
        }
        case 'preview_set':
          previewDocs.set(args.id, args.html);
          return null;
        case 'plugin:dialog|save': {
          const path = join(saveDir, basename(args.options?.defaultPath ?? 'untitled'));
          return path;
        }
        case 'plugin:fs|write_text_file': {
          const path = decodeURIComponent(options.headers.path);
          const text = Buffer.from(args.__bytes).toString('utf8');
          writeFileSync(path, text);
          saved.set(path, text);
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
    await page.addInitScript(
      ([t, l]) => {
        localStorage.setItem(
          'command-center-ui',
          JSON.stringify({
            state: { theme: t, layout: l, sidebarOpen: true, rightPanelOpen: false },
            version: 0,
          }),
        );
      },
      [theme ?? 'dark', layout],
    );
    if (!onboarding) {
      await page.addInitScript(() => {
        // Only on the first load of a profile: reloads keep whatever the app saved since.
        if (localStorage.getItem('command-center-prefs') !== null) return;
        localStorage.setItem(
          'command-center-prefs',
          JSON.stringify({
            version: 1,
            profile: { name: 'Ada' },
            onboarding: { completed: true, step: 0 },
            security: { autoLockMinutes: 0 },
          }),
        );
      });
    }
    // The first load after a fresh build can be slow (virus scanners inspect new files).
    await page.goto(url, { timeout: 120_000 });
    if (splash) {
      // Hand back right away so the caller can look at the launch screen.
      return {
        page,
        killBridge: () => child?.kill('SIGKILL'),
        close: async () => {
          child?.kill();
          await context.close();
        },
      };
    }
    if (onboarding) await page.waitForSelector('[data-testid="onboarding"]');
    else if (lock === 'setup') await page.waitForSelector('[data-testid="lock-screen"]');
    else if (layout === 'ide') await page.waitForSelector('[data-testid="ide-shell"]');
    // The bridge starts on first use, so a fresh app shows it on standby.
    else await page.waitForSelector('aside >> text=/Bridge (ready|on standby)|pong \\d+ms/');
    // The app starts on Home; most scripts drive the chat, so open it unless Home was asked for.
    if (!onboarding && lock !== 'setup' && !home) {
      if (layout === 'ide') await page.keyboard.press('Control+t');
      else
        await page
          .getByRole('button', { name: /new chat/i })
          .first()
          .click();
      await page.waitForTimeout(100);
    }
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
    saved,
    launch,
    /** Forget the emulated PIN and keys (a clean machine for the next launch). */
    resetSecurity: () => {
      lockState.pin = null;
      lockState.failures = 0;
      secretStore.clear();
    },
    consoleErrors,
    stop: async () => {
      await browser.close();
      await (server.close?.() ?? server.httpServer.close());
    },
  };
}
