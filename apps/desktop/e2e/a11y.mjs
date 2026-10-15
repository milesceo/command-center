// Accessibility audit with axe-core over every view, in both themes.
//   node e2e/a11y.mjs         (prints violations; exits 1 on any serious or critical one)
import { createRequire } from 'node:module';
import { startHarness } from './harness.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const h = await startHarness({ real: false });
let failures = 0;

async function audit(page, label) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    axe.run(document, {
      resultTypes: ['violations'],
      runOnly: ['wcag2a', 'wcag2aa', 'best-practice'],
    }),
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
  const app = await h.launch({ theme });
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
  await p.getByRole('heading', { name: /how should geeked behave/i }).waitFor();
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
