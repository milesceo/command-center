// Accessibility audit with axe-core over every view, in both themes.
//   node e2e/a11y.mjs         (prints violations; exits 1 on any serious or critical one)
import { createRequire } from 'node:module';
import { startHarness } from './harness.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const h = await startHarness({ real: false });
let failures = 0;

// The Model Lab reads the public Hugging Face API from the page; stub it so no network is used.
const HUB_REPO = 'a11y-org/Tiny-GGUF';
const stubHub = (context) =>
  context.route('https://huggingface.co/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === `/api/models/${HUB_REPO}/tree/main`
        ? [{ type: 'file', path: 'tiny-q4_k_m.gguf', size: 1, lfs: { size: 300_000_000 } }]
        : path === `/api/models/${HUB_REPO}`
          ? { id: HUB_REPO, pipeline_tag: 'text-generation', tags: ['gguf'] }
          : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });

const insertPlan = h.db.prepare(
  `INSERT INTO business_plans (id, title, html, source, position, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const seedPlan = () => {
  const now = Date.now();
  insertPlan.run(
    'a11y-plan',
    'A11y test plan',
    '<!doctype html><html lang="en"><head><title>A11y test plan</title></head>' +
      '<body><main><h1>Test plan</h1><p>Fixture text for the accessibility audit.</p></main></body></html>',
    'a11y-test-plan.html',
    0,
    now,
    now,
  );
};

// `iframes: false` audits the app around a sandboxed document without descending into it: a
// plan's own markup is the owner's, and axe cannot be injected into the opaque-origin frame.
async function audit(page, label, { iframes = true } = {}) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(
    (iframes) =>
      // eslint-disable-next-line no-undef
      axe.run(document, {
        iframes,
        resultTypes: ['violations'],
        runOnly: ['wcag2a', 'wcag2aa', 'best-practice'],
      }),
    iframes,
  );
  for (const v of result.violations) {
    const bad = v.impact === 'serious' || v.impact === 'critical';
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : 'warn'} [${label}] ${v.id} (${v.impact}): ${v.help}`);
    for (const n of v.nodes.slice(0, 4))
      console.log(`       ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`);
  }
  if (result.violations.length === 0) console.log(`ok   [${label}] no violations`);
}

for (const theme of ['dark', 'light']) {
  // Each theme starts with no Model Lab models and no business plans (the database is shared
  // between launches).
  h.db.exec('DELETE FROM custom_models');
  h.db.exec('DELETE FROM business_plans');
  const app = await h.launch({ theme, setup: stubHub });
  const { page } = app;
  const nav = (name) =>
    page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name });
  await audit(page, `${theme}: empty chat`);

  await page.fill('textarea[aria-label="Message"]', 'demo two');
  await page.press('textarea[aria-label="Message"]', 'Enter');
  await page.waitForSelector('[data-role="assistant"]:not([data-streaming])');
  await audit(page, `${theme}: conversation with code`);

  await nav('Usage').click();
  await page.getByTestId('usage-view').waitFor();
  await page.waitForTimeout(300);
  await audit(page, `${theme}: usage`);

  await nav('Prompts').click();
  await page.getByTestId('prompts-view').waitFor();
  await audit(page, `${theme}: prompts (empty)`);
  await page.getByRole('button', { name: 'New prompt' }).click();
  await audit(page, `${theme}: prompt editor`);
  await page.keyboard.press('Escape');

  await nav('Model Lab').click();
  await page.getByTestId('model-lab').waitFor();
  await page.getByText('No models yet').waitFor();
  await audit(page, `${theme}: models (empty)`);
  await page.getByRole('button', { name: 'Add a model' }).first().click();
  const addDialog = page.getByRole('dialog', { name: 'Add a model' });
  await addDialog.waitFor();
  await audit(page, `${theme}: add model dialog`);
  await addDialog.getByRole('button', { name: 'Paste a link' }).click();
  await addDialog.getByLabel('Model id or link').fill(HUB_REPO);
  await addDialog.getByRole('button', { name: 'Look up' }).click();
  await addDialog.getByRole('region', { name: 'Model details' }).waitFor();
  await audit(page, `${theme}: add model details`);
  await addDialog.getByRole('button', { name: /^Add / }).click();
  await addDialog.waitFor({ state: 'detached' });
  await page.getByRole('list', { name: 'Your models' }).waitFor();
  await audit(page, `${theme}: models (list)`);

  await nav('Business plans').click();
  await page.getByTestId('business-plans').waitFor();
  await page.getByText('No plans yet').waitFor();
  await audit(page, `${theme}: business plans (empty)`);
  // A harmless test plan (the repository is public: never a real plan), seeded through the
  // harness database. The plans store keeps its list in memory, so reload to read it.
  seedPlan();
  await page.reload();
  await nav('Business plans').waitFor();
  await nav('Business plans').click();
  await page.getByRole('navigation', { name: 'Plans' }).waitFor();
  await page
    .frameLocator('iframe[title="A11y test plan"]')
    .getByRole('heading', { name: 'Test plan' })
    .waitFor();
  await audit(page, `${theme}: business plans (one plan)`, { iframes: false });

  await nav('Settings').click();
  await page.getByTestId('settings-view').waitFor();
  await audit(page, `${theme}: settings`);

  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
  await audit(page, `${theme}: command palette`);
  await page.keyboard.press('Escape');
  await app.close();

  // First run: every onboarding step.
  const first = await h.launch({ theme, layout: 'ide', onboarding: true });
  const p = first.page;
  await audit(p, `${theme}: onboarding name`);
  await p.getByLabel('Your name').fill('Ada');
  await p.getByRole('button', { name: /^next/i }).click();
  await p.getByLabel(/^PIN/).waitFor();
  await audit(p, `${theme}: onboarding PIN`);
  await p.getByRole('button', { name: /skip for now/i }).click();
  await p.getByRole('heading', { name: /how should command center behave/i }).waitFor();
  await audit(p, `${theme}: onboarding system`);
  await p.getByRole('button', { name: /^next/i }).click();
  await p.getByRole('heading', { name: /performance and appearance/i }).waitFor();
  await audit(p, `${theme}: onboarding performance and appearance`);
  await p.getByRole('button', { name: /^next/i }).click();
  await p.getByRole('heading', { name: /connect your ai agents/i }).waitFor();
  await p.waitForTimeout(500);
  await audit(p, `${theme}: onboarding agents`);
  await first.close();

  // Home and the lock screen.
  const home = await h.launch({ theme, layout: 'ide', home: true });
  await home.page.getByTestId('landing-view').waitFor();
  // The launch message fades in; audit once it has settled.
  await home.page.waitForTimeout(1200);
  await audit(home.page, `${theme}: home`);
  await home.close();
}
await h.stop();
process.exit(failures ? 1 : 0);
