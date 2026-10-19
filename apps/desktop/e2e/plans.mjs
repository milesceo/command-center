// Business plans end to end: add a plan from an HTML file, read it in the sandboxed frame (its
// script runs, it cannot reach the app), rename it, and remove it. Only a harmless test document
// is used: the repository is public, so no real plan ever appears here.
//   E2E_CHROMIUM=<chrome> node e2e/plans.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const TITLE = 'E2E test plan';
const DOC =
  '<!doctype html><html lang="en"><head><title>E2E test plan</title></head><body>' +
  '<h1>Test plan</h1><p id="out">waiting</p>' +
  '<script>' +
  "document.getElementById('out').textContent = 'script ran';" +
  // The sandbox has an opaque origin: reading the app or its storage must fail.
  "try { void parent.document.title; document.body.dataset.parent = 'reachable'; }" +
  " catch { document.body.dataset.parent = 'blocked'; }" +
  "try { void localStorage.length; document.body.dataset.storage = 'reachable'; }" +
  " catch { document.body.dataset.storage = 'blocked'; }" +
  '</script></body></html>';

const h = await startHarness({ real: false });
h.db.exec('DELETE FROM business_plans');
let app;
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message.split('\n').slice(0, 6).join(' | ')}`);
    await app?.page
      .screenshot({ path: join(outDir, `plans-fail-${results.length}.png`) })
      .catch(() => {});
    process.exitCode = 1;
  }
};
const rows = () => h.db.prepare('select id, title, source from business_plans').all();

try {
  app = await h.launch({ theme: 'dark' });
  const { page } = app;
  const frame = () => page.frameLocator(`iframe[title="${TITLE}"]`);

  await step('opens Business plans on its empty state', async () => {
    await page
      .getByRole('navigation', { name: 'Library' })
      .getByRole('button', { name: 'Business plans' })
      .click();
    await page.getByTestId('business-plans').waitFor();
    await page.getByText('No plans yet').waitFor();
  });

  await step('adds a plan from an HTML file, named from its <title>', async () => {
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'e2e-test-plan.html',
      mimeType: 'text/html',
      buffer: Buffer.from(DOC),
    });
    await page
      .getByRole('navigation', { name: 'Plans' })
      .getByRole('button', { name: TITLE })
      .waitFor();
    const stored = rows();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].title, TITLE);
    assert.equal(stored[0].source, 'e2e-test-plan.html');
  });

  await step('reads the plan in an allow-scripts-only sandbox', async () => {
    const el = page.locator(`iframe[title="${TITLE}"]`);
    await el.waitFor();
    assert.equal(await el.getAttribute('sandbox'), 'allow-scripts');
    await frame().getByRole('heading', { name: 'Test plan' }).waitFor();
    await frame().getByText('script ran').waitFor();
    const body = frame().locator('body');
    assert.equal(await body.getAttribute('data-parent'), 'blocked');
    assert.equal(await body.getAttribute('data-storage'), 'blocked');
    await page.screenshot({ path: join(outDir, 'plans-reader.png') });
  });

  await step('renames the plan', async () => {
    await page.getByRole('button', { name: `Rename ${TITLE}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename plan' });
    await dialog.waitFor();
    await dialog.getByLabel('Name').fill('Renamed test plan');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page
      .getByRole('navigation', { name: 'Plans' })
      .getByRole('button', { name: 'Renamed test plan' })
      .waitFor();
    assert.equal(rows()[0].title, 'Renamed test plan');
  });

  await step('removes the plan after confirming', async () => {
    await page.getByRole('button', { name: 'Remove Renamed test plan' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor();
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await page.getByText('No plans yet').waitFor();
    assert.deepEqual(rows(), []);
  });

  await step('no unexpected console errors', async () => {
    const unexpected = h.consoleErrors.filter((e) => !/allow-same-origin/.test(e));
    assert.deepEqual(unexpected, []);
  });
} finally {
  await app?.close().catch(() => {});
  await h.stop();
}

console.log(results.join('\n'));
process.exit(process.exitCode ?? 0);
