// Screenshots of the circle PIN input (reveal off and on), the lock screen, and the splash.
//   pnpm --filter @geeked/bridge build
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/pin-splash node e2e/pin-splash.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const h = await startHarness({ real: false });
const PIN = 'k3#Zp9';

// ---- onboarding PIN step ---------------------------------------------------------------
let app = await h.launch({
  viewport: { width: 1100, height: 760 },
  theme: 'dark',
  layout: 'ide',
  onboarding: true,
});
let page = app.page;
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });

await page.getByLabel('Your name').fill('Ada');
await page.getByRole('button', { name: /^next/i }).click();
await page.getByRole('heading', { name: /lock geeked with a pin/i }).waitFor();

// No visible text field: the only inputs are visually hidden.
const visibleInputs = await page.evaluate(
  () =>
    [...document.querySelectorAll('input')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
    }).length,
);
assert.equal(visibleInputs, 0, 'the PIN step shows no visible text field');

await page.keyboard.type(PIN);
await page.keyboard.press('Enter'); // moves to the confirmation row
await page.keyboard.type(PIN);
await page.waitForTimeout(150);
await shot('01-onboarding-pin-hidden');
await page.getByRole('button', { name: 'Show PIN' }).click();
await page.waitForTimeout(150);
await shot('02-onboarding-pin-revealed');
await page.keyboard.press('Enter'); // confirm row: Enter continues
await page.getByRole('heading', { name: /how should geeked behave/i }).waitFor();
await app.close();

// ---- lock screen ------------------------------------------------------------------------
h.resetSecurity();
app = await h.launch({
  viewport: { width: 1100, height: 760 },
  theme: 'dark',
  layout: 'ide',
  home: true,
});
page = app.page;
await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.getByRole('button', { name: 'Set a PIN' }).click();
await page.keyboard.type(PIN);
await page.keyboard.press('Enter');
await page.keyboard.type(PIN);
await page.getByRole('button', { name: 'Set PIN' }).click();
await page.waitForSelector('text=Lock now');
await page.reload();
await page.waitForSelector('[data-testid="lock-screen"]');
await page.waitForTimeout(1200);

// Typing is captured without clicking anything, and Unlock is disabled below 4 characters.
await page.keyboard.type('k3#');
const unlock = page.getByRole('button', { name: 'Unlock' });
assert.equal(await unlock.isDisabled(), true, 'Unlock is disabled below four characters');
await page.keyboard.type('Z');
assert.equal(await unlock.isDisabled(), false);
await page.waitForTimeout(150);
await shot('03-lock-hidden');
await page.getByRole('button', { name: 'Show PIN' }).click();
await page.waitForTimeout(150);
await shot('04-lock-revealed');

// Wrong PIN: circles clear and the message appears.
await page.getByRole('button', { name: 'Hide PIN' }).click();
await page.keyboard.press('Enter'); // "k3#Z" is wrong
await page.waitForSelector('text=Wrong PIN.');
const left = await page.evaluate(
  () => document.querySelectorAll('[data-slot][data-filled="true"]').length,
);
assert.equal(left, 0, 'a wrong PIN clears the circles');
await shot('05-lock-wrong');

// The right PIN gets in; the reveal toggle starts off again on the next lock.
await page.keyboard.type(PIN);
await page.keyboard.press('Enter');
await page.waitForSelector('[data-testid="ide-shell"]');
await page.keyboard.press('Control+l');
await page.waitForSelector('[data-testid="lock-screen"]');
assert.equal(
  await page.getByRole('button', { name: 'Show PIN' }).count(),
  1,
  'reveal is off again',
);
await app.close();

// ---- splash -----------------------------------------------------------------------------
app = await h.launch({
  viewport: { width: 1100, height: 700 },
  theme: 'dark',
  layout: 'ide',
  splash: true,
});
page = app.page;
await page.waitForSelector('[data-testid="splash"]');
await page.waitForTimeout(350);
await shot('06-splash');
await page.waitForTimeout(250);
await shot('07-splash-turned');
// It hands off to the PIN lock (a PIN is set) without any intermediate screen.
await page.waitForSelector('[data-testid="lock-screen"]');
await page.waitForSelector('[data-testid="splash"]', { state: 'detached' });
await app.close();

const unexpected = h.consoleErrors.filter((e) => !/boom|allow-same-origin/.test(e));
console.log('unexpected console errors:', unexpected.length ? unexpected : 'none');
await h.stop();
