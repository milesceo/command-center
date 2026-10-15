// Captures the editor-style shell and the PIN lock screen with the fake SDK and a few seeded threads.
//   pnpm --filter @geeked/bridge build
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/ide node e2e/ide.mjs
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const h = await startHarness({ real: false });
const size = { width: 1440, height: 860 };
const PIN = '4821';

let app = await h.launch({ viewport: size, theme: 'dark', layout: 'ide' });
let page = app.page;
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const typePin = async (pin) => {
  await page.fill('input[aria-labelledby="pin-prompt"]', pin);
  await page.keyboard.press('Enter');
};
const input = 'textarea[aria-label="Message"]';

let expected = 0;
const send = async (text) => {
  await page.fill(input, text);
  await page.press(input, 'Enter');
  expected += 1;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const { n } = h.db.prepare("select count(*) as n from messages where role = 'assistant'").get();
    if (n >= expected) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(250);
};
const newThread = async () => {
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(200);
};

await send('demo two');
await send('demo v1');
await send('demo v2');
await send('demo html');
await newThread();
await send('demo svg');
await newThread();
await send('demo long');
await newThread();
await send('demo diff');

const now = Date.now();
const addProject = h.db.prepare(
  'insert into projects (id, name, created_at, updated_at) values (?,?,?,?)',
);
addProject.run('proj-api', 'billing-api', now, now);
addProject.run('proj-web', 'marketing-site', now, now);
const assign = h.db.prepare('update conversations set project_id = ? where title = ?');
assign.run('proj-api', 'demo two');
assign.run('proj-api', 'demo diff');
assign.run('proj-web', 'demo svg');
assign.run('proj-web', 'demo long');

// Set a PIN in Settings, then restart: the PIN is asked for before anything is shown.
await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.getByRole('button', { name: 'Set a PIN' }).click();
await page.getByLabel(/^PIN/).fill(PIN);
await page.getByLabel('Confirm PIN').fill(PIN);
await page.getByRole('button', { name: 'Set PIN' }).click();
await page.waitForSelector('text=Lock now');
await page.reload();
await page.waitForSelector('[data-testid="lock-screen"]');
await page.waitForTimeout(800);
await page.fill('input[aria-labelledby="pin-prompt"]', PIN.slice(0, 2));
await page.waitForTimeout(300);
await shot('lock-unlock');
await typePin(PIN);
await page.waitForSelector('[data-testid="ide-shell"]');

await page.click('aside[aria-label="Explorer"] >> text=demo two');
await page.waitForTimeout(900);
await shot('ide');

// Step a file back one version and look at the diff.
await page.click('aside[aria-label="Explorer"] button:has-text("ts"):has-text("v2")');
await page
  .locator('[data-testid="file-viewer"]')
  .getByRole('button', { name: 'Diff', exact: true })
  .click();
await page.waitForTimeout(600);
await shot('ide-diff');

await page.keyboard.press('Control+j');
await page.waitForTimeout(400);
await shot('ide-activity');
await page.keyboard.press('Control+j');

await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.waitForSelector('text=Security');
await page.waitForTimeout(500);
await shot('ide-settings');

// Wrong PIN on the lock screen.
await page.keyboard.press('Control+l');
await page.waitForSelector('[data-testid="lock-screen"]');
await typePin('0000');
await page.waitForSelector('text=Wrong PIN.');
await page.waitForTimeout(500);
await shot('lock-wrong');

const unexpected = h.consoleErrors.filter((e) => !/boom|allow-same-origin/.test(e));
console.log('unexpected console errors:', unexpected.length ? unexpected : 'none');
await app.close();
await h.stop();
