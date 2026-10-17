// Screenshots of the AI status dots (picker and Settings), the incident popover, and a
// new-model notice, with the feed stubbed at its raw.githubusercontent.com URL. Also checks
// that the app keeps working from its cache when the feed is unreachable.
//   pnpm --filter @command-center/bridge build
//   E2E_CHROMIUM=<chrome> E2E_OUT=../../docs/ai-status node e2e/status-feed.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const FEED_URL = 'https://raw.githubusercontent.com/engineerlish/geeked-ai-status/main/latest.json';

const model = (id, name) => ({
  id,
  display_name: name,
  created_at: '2026-10-15T00:00:00Z',
  first_seen: '2026-10-15',
});
const provider = (id, name, appId, models, overall, summary, incidents = [], components = []) => ({
  id,
  name,
  vendor: name,
  geeked_provider: appId,
  models: { state: 'ok', source: '', error: null, items: models },
  status: {
    state: 'ok',
    source: '',
    page_url: null,
    error: null,
    overall,
    summary,
    incidents,
    affected_components: components,
  },
});
const feed = (claudeModels) => ({
  schema_version: 1,
  checked_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  scheduled_for: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  run: { trigger: 'schedule', late: false, late_seconds: 0, missed_slots: [], missed_count: 0 },
  providers: {
    anthropic: provider(
      'anthropic',
      'Claude',
      'claude',
      claudeModels,
      'degraded',
      'Minor Service Outage',
      [
        {
          id: 'i1',
          title: 'Elevated errors on Claude Code',
          status: 'investigating',
          impact: 'minor',
          url: 'https://status.claude.com/incidents/i1',
          started_at: '2026-10-15T17:40:00Z',
          updated_at: '2026-10-15T17:55:00Z',
        },
      ],
      [{ name: 'Claude Code', status: 'degraded_performance' }],
    ),
    openai: provider(
      'openai',
      'ChatGPT',
      'openai',
      [model('gpt-5', 'gpt-5')],
      'operational',
      'All Systems Operational',
    ),
    xai: provider(
      'xai',
      'Grok',
      'xai',
      [model('grok-4.7', 'grok-4.7')],
      'major_outage',
      '1 active incident(s)',
      [
        {
          id: 'x1',
          title: '[grok.com] grok.com',
          status: 'investigating',
          impact: 'critical',
          url: 'https://status.x.ai/grok-com/x1',
          started_at: '2026-10-15T17:40:00Z',
          updated_at: '2026-10-15T17:40:00Z',
        },
      ],
    ),
  },
});

let current = feed([model('claude-opus-5', 'Claude Opus 5')]);
let offline = false;
const stub = async (context) => {
  await context.route(FEED_URL, (route) =>
    offline
      ? route.abort('internetdisconnected')
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(current),
        }),
  );
};

const h = await startHarness({ real: false });
const size = { width: 1280, height: 800 };
let app = await h.launch({ viewport: size, theme: 'dark', layout: 'ide', setup: stub });
let page = app.page;
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });

// Enable all three providers so the picker lists them.
await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.getByTestId('status-dot-claude').first().waitFor();
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="status-dot-claude"]')?.getAttribute('data-status') ===
    'degraded',
);
assert.equal(
  await page.getByTestId('status-dot-xai').first().getAttribute('data-status'),
  'major_outage',
);
await page.getByRole('heading', { name: 'AI agents' }).scrollIntoViewIfNeeded();
await page.waitForSelector('[data-testid="splash"]', { state: 'detached' });
await page.waitForTimeout(400);
await shot('01-settings-ai-agents');

// The assistant header's picker has a dot too; open its details.
await page
  .getByRole('navigation', { name: 'Activity' })
  .getByRole('button', { name: 'Settings' })
  .click();
await page.keyboard.press('Control+t');
const pickerDot = page.getByTestId('provider-model-picker').getByTestId('status-dot-claude');
await pickerDot.waitFor();
await pickerDot.click();
await page.getByRole('dialog', { name: /Claude status details/ }).waitFor();
await shot('02-picker-incident-details');
await page.keyboard.press('Escape');

// A new Claude model appears: notice + it is offered in the picker.
current = feed([
  model('claude-opus-5', 'Claude Opus 5'),
  model('claude-sonnet-6', 'Claude Sonnet 6'),
]);
await page.reload();
await page.waitForSelector('[data-testid="ide-shell"]');
await page.waitForSelector('[data-testid="model-notices"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="splash"]', { state: 'detached' });
await page.waitForTimeout(300);
await shot('03-new-model-notice');
const options = await page
  .getByTestId('provider-model-picker')
  .getByLabel('Model')
  .locator('option')
  .allTextContents();
assert.ok(options.includes('Claude Sonnet 6'), 'the new model is in the picker');
await page.getByRole('button', { name: /Dismiss the Claude Sonnet 6 notice/ }).click();
assert.equal(await page.getByTestId('model-notices').count(), 0);

// Offline: the cached copy is still used.
offline = true;
await page.reload();
await page.waitForSelector('[data-testid="ide-shell"]');
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="status-dot-claude"]')?.getAttribute('data-status') ===
    'degraded',
);
await page.getByTestId('provider-model-picker').getByTestId('status-dot-claude').click();
await page.waitForFunction(() =>
  document.body.textContent.includes('Offline: showing the copy from'),
);
await page.waitForSelector('[data-testid="splash"]', { state: 'detached' });
await shot('04-offline-cached');

const unexpected = h.consoleErrors.filter(
  (e) => !/boom|allow-same-origin|Failed to load resource|ERR_/.test(e),
);
console.log('unexpected console errors:', unexpected.length ? unexpected : 'none');
await app.close();
await h.stop();
