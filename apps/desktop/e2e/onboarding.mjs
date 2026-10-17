// Walks the first-run flow in the real UI (fake SDK, emulated Tauri IPC) and records:
//   - a screenshot of every onboarding step, Home, the lock screen and the new Settings sections
//   - the CPU cost of the Home screen's spinning ASCII logo at every performance tier
//
//   pnpm --filter @command-center/bridge build
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/onboarding node e2e/onboarding.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const h = await startHarness({ real: false });
const PIN = 'k3#Zp9!x';
const TIERS = ['lightest', 'light', 'balanced', 'enhanced', 'accelerated'];

// A tall viewport so each step fits without scrolling inside the card.
const tall = { width: 1280, height: 1500 };
let app = await h.launch({ viewport: tall, theme: 'dark', layout: 'ide', onboarding: true });
let page = app.page;
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const next = () => page.getByRole('button', { name: /^(next|finish)/i }).click();

// 1. Name
await page.waitForTimeout(600);
await shot('01-name');
await page.getByLabel('Your name').fill('Elijah');
await shot('01-name-filled');
await next();

// 2. PIN
await page.getByLabel(/^PIN/).waitFor();
await shot('02-pin');
await page.getByLabel(/^PIN/).fill(PIN);
await page.getByLabel('Confirm PIN').fill(PIN);
await page.getByRole('button', { name: 'Show PIN' }).click();
await shot('02-pin-filled');
await next();

// 3. System behavior
await page.getByRole('heading', { name: /how should command center behave/i }).waitFor();
await page.getByRole('button', { name: 'Minimize to tray' }).click();
await shot('03-system');
await next();

// 4. Performance and appearance
await page.getByRole('heading', { name: /performance and appearance/i }).waitFor();
await page.getByLabel('Performance tier').fill('3');
await page.getByRole('radio', { name: /Midnight/ }).click();
await page.getByRole('button', { name: 'Accent #22d3ee' }).click();
await shot('04-performance-appearance');
await next();

// 5. AI agents
await page.getByRole('heading', { name: /connect your ai agents/i }).waitFor();
await page.waitForTimeout(800);
await shot('05-agents');
await next();

// Home
await page.waitForSelector('[data-testid="landing-view"]');
await page.waitForTimeout(1500);
await shot('06-home');
await page.close();
await app.close();

// ---- CPU of the animated logo at each tier ----------------------------------------------
/** Total CPU seconds of every browser process, from the DevTools SystemInfo domain. */
async function cpuSeconds(client) {
  const { processInfo } = await client.send('SystemInfo.getProcessInfo');
  return processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
}

const measurements = [];
h.resetSecurity();
for (const tier of TIERS) {
  const run = await h.launch({
    viewport: { width: 1280, height: 800 },
    theme: 'dark',
    layout: 'ide',
    home: true,
  });
  const p = run.page;
  await p.evaluate((t) => {
    const prefs = JSON.parse(localStorage.getItem('command-center-prefs'));
    prefs.performance = { tier: t };
    localStorage.setItem('command-center-prefs', JSON.stringify(prefs));
  }, tier);
  await p.reload();
  await p.waitForSelector('[data-testid="landing-view"]');
  const fps = await p.getAttribute('[data-testid="ascii-logo"]', 'data-fps');
  await p.waitForTimeout(1500); // settle: first paint, fonts, bridge ping

  // Three 6-second samples; the machine is shared with other work, so keep the median and the
  // quietest sample rather than a single reading.
  const browserClient = await p.context().browser().newBrowserCDPSession();
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const before = await cpuSeconds(browserClient);
    const t0 = Date.now();
    await p.waitForTimeout(6_000);
    const after = await cpuSeconds(browserClient);
    samples.push(((after - before) / ((Date.now() - t0) / 1000)) * 100);
  }
  samples.sort((x, y) => x - y);
  measurements.push({
    tier,
    fps: Number(fps),
    medianPercentOfOneCore: Number(samples[1].toFixed(2)),
    minPercentOfOneCore: Number(samples[0].toFixed(2)),
  });
  await run.close();
}
writeFileSync(join(outDir, 'cpu.json'), JSON.stringify(measurements, null, 2));
console.log('ASCII logo CPU (all browser processes, % of one core):');
console.table(measurements);

// ---- Settings, lock screen, forgot PIN ------------------------------------------------------
app = await h.launch({
  viewport: { width: 1440, height: 1500 },
  theme: 'dark',
  layout: 'ide',
  home: true,
});
page = app.page;
await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.waitForSelector('text=Security');
await page.waitForTimeout(500);
await shot('07-settings');
await page.getByRole('button', { name: 'Set a PIN' }).click();
await page.getByLabel(/^PIN/).fill(PIN);
await page.getByLabel('Confirm PIN').fill(PIN);
await page.getByRole('button', { name: 'Set PIN' }).click();
await page.waitForSelector('text=Lock now');
await page.getByRole('button', { name: 'Lock now' }).click();
await page.waitForSelector('[data-testid="lock-screen"]');
await page.waitForTimeout(1200);
await shot('08-lock');
await page.fill('input[aria-labelledby="pin-prompt"]', 'wrong1');
await page.keyboard.press('Enter');
await page.waitForSelector('text=Wrong PIN.');
await shot('08-lock-wrong');
await page.getByRole('button', { name: /forgot PIN/i }).click();
await page.waitForSelector('[role="alertdialog"]');
await shot('09-forgot-pin');

const unexpected = h.consoleErrors.filter((e) => !/boom|allow-same-origin/.test(e));
console.log('unexpected console errors:', unexpected.length ? unexpected : 'none');
await app.close();
await h.stop();
