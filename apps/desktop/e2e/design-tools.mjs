// Screenshots of the in-app QA panel and of Storybook (built statically and served locally).
//   pnpm --filter @command-center/bridge build
//   pnpm --filter @command-center/desktop build-storybook
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/design-tools node e2e/design-tools.mjs
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir, startHarness } from './harness.mjs';

const desktop = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const storybookDir = join(desktop, 'storybook-static');
assert.ok(
  existsSync(storybookDir),
  'Build Storybook first: pnpm --filter @command-center/desktop build-storybook',
);

const h = await startHarness({ real: false });
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });

// ---- QA panel -------------------------------------------------------------------------------
const app = await h.launch({
  viewport: { width: 1280, height: 820 },
  theme: 'dark',
  layout: 'ide',
  home: true,
  setup: async (context) => {
    await context.addInitScript(() => {
      localStorage.setItem('command-center-qa', JSON.stringify({ enabled: true, results: {} }));
    });
  },
});
let page = app.page;
await page.waitForSelector('[data-testid="splash"]', { state: 'detached' });
await page.keyboard.press('Control+Shift+Q');
await page.getByTestId('qa-panel').waitFor();

// Open one item, run its setup, and fail another with a note.
await page
  .getByTestId('qa-item-STATUS-03')
  .getByRole('button', { name: /new-model notice/i })
  .click();
await page.getByRole('button', { name: /Set up: Simulate a new Claude model/ }).click();
await page.waitForSelector('[data-testid="model-notices"]');
await page
  .getByTestId('qa-item-STATUS-04')
  .getByRole('button', { name: /degraded provider/i })
  .click();
await page.getByTestId('qa-item-STATUS-04').getByRole('button', { name: 'Fail' }).click();
await page
  .getByTestId('qa-item-STATUS-04')
  .getByLabel(/What did you see/)
  .fill('The dot stayed green after the simulated incident.');
await page.waitForTimeout(300);
await shot(page, '01-qa-panel');
await app.close();

// ---- Storybook ------------------------------------------------------------------------------
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(
    /^([/\\])+/,
    '',
  );
  let file = join(storybookDir, path === '' ? 'index.html' : path);
  if (!file.startsWith(storybookDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  if (statSync(file).isDirectory()) file = join(file, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = app.page.context().browser();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
page = await context.newPage();
await page.goto(`${base}/?path=/story/pin-pincircles--revealed&globals=theme:light;palette:forest`);
await page.waitForSelector('iframe#storybook-preview-iframe');
await page.waitForTimeout(2500);
await shot(page, '02-storybook-pin-revealed-light-forest');

await page.goto(`${base}/?path=/story/status-statusdot--degraded-with-incident`);
await page.waitForSelector('iframe#storybook-preview-iframe');
await page.waitForTimeout(2500);
await shot(page, '03-storybook-status-dot');
await context.close();
server.close();
await h.stop();
console.log('wrote screenshots to', outDir);
