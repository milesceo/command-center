// Regenerates the README screenshots from the production build with the fake SDK, so they are
// reproducible. Usage numbers are sample data seeded into the throwaway database.
//   pnpm build && E2E_PROD=1 E2E_OUT=../../docs/screenshots node e2e/screenshots.mjs
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const h = await startHarness({ real: false });
const size = { width: 1280, height: 800 };
let app = await h.launch({ viewport: size, theme: 'dark' });
let page = app.page;
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const send = async (text) => {
  await page.fill('textarea[aria-label="Message"]', text);
  await page.press('textarea[aria-label="Message"]', 'Enter');
  await page.waitForSelector('[data-role="assistant"]:not([data-streaming])', { timeout: 30000 });
};
const newChat = async () => {
  await page.click('aside button:has-text("New chat")');
  await page.waitForSelector('text=What are we building?');
};
const view = (name) =>
  page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name }).click();

// A few conversations so the sidebar looks lived in.
await send('demo diff');
await newChat();
await send('demo mermaid');
await newChat();
await send('demo svg');
await newChat();
await send('demo html');

// Sample usage spread over the last month, so the charts have something to show.
const insert = h.db.prepare(
  'insert into usage_log (id, created_at, conversation_id, message_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd) values (?,?,?,?,?,?,?,?,?,?)',
);
// Older sample conversations to carry the usage, so the chat being shown keeps only its own numbers.
const titles = [
  'Refactor the auth middleware',
  'Why is this test flaky?',
  'Port the build script to Node',
  'Explain this regex',
  'Write a migration for tags',
  'Review my diff',
];
const convs = titles.map((title, i) => {
  const id = `sample-${i}`;
  const at = Date.now() - (i + 2) * 86400000;
  h.db
    .prepare('insert into conversations (id, title, created_at, updated_at) values (?,?,?,?)')
    .run(id, title, at, at);
  return id;
});
let n = 0;
for (let d = 29; d >= 0; d--) {
  const replies = [3, 5, 2, 8, 6, 0, 1][d % 7] + (d % 4);
  for (let r = 0; r < replies; r++) {
    const opus = (d + r) % 5 === 0;
    const out = 400 + ((d * 37 + r * 91) % 1800);
    const cacheRead = 8000 + ((d * 211 + r * 53) % 40000);
    const cost = (out * (opus ? 25 : 15) + cacheRead * (opus ? 1.5 : 0.3) + 3 * 5) / 1e6;
    insert.run(
      `s${n++}`,
      Date.now() - d * 86400000 - r * 3600000,
      convs[(d * 3 + r) % convs.length],
      null,
      opus ? 'claude-opus-5-5' : 'claude-sonnet-5-5',
      3,
      out,
      cacheRead,
      r === 0 ? 2400 : 0,
      cost,
    );
  }
}

// Reload so the sidebar and stores read the seeded rows.
await app.close();
app = await h.launch({ viewport: size, theme: 'dark' });
page = app.page;
await page.waitForSelector('nav[aria-label="Conversations"] li');
await page.click('nav[aria-label="Conversations"] li > button >> nth=0');
await page.waitForSelector('[data-role="assistant"]');
await page
  .getByRole('button', { name: /Open in preview/ })
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(1200);
await shot('chat-preview-dark');

await newChat();
await send('demo diff');
await page.keyboard.press('Control+Shift+P'); // close the preview panel for a clean diff shot
await page.waitForTimeout(400);
await shot('diff-dark');

await view('Usage');
await page.getByTestId('usage-view').waitFor();
await page.waitForTimeout(800);
await shot('usage-dark');

await view('Prompts');
await page.getByRole('button', { name: 'New prompt' }).click();
await page.getByLabel('Title').fill('Code review');
await page.getByLabel('Tags').fill('review, code');
await page
  .getByLabel(/^Body/)
  .fill('Review this {{language}} code for bugs and unclear names:\n\n{{code}}');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByRole('button', { name: 'New prompt' }).click();
await page
  .getByRole('dialog', { name: 'New prompt' })
  .getByText('System prompt', { exact: true })
  .click();
await page.getByLabel('Title').fill('Terse reviewer');
await page
  .getByLabel(/^Body/)
  .fill('You review code. Answer in short bullet points and quote the line you mean.');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText('Terse reviewer').waitFor();
await shot('prompts-dark');

await view('Settings');
await page.getByTestId('settings-view').waitFor();
await page.waitForTimeout(300);
await shot('settings-dark');

await view('Settings'); // back to chat
await page.keyboard.press('Control+k');
await page.getByRole('combobox', { name: /Search commands/ }).waitFor();
await page.waitForTimeout(300);
await shot('palette-dark');
await page.keyboard.press('Escape');

await app.close();
app = await h.launch({ viewport: size, theme: 'light' });
page = app.page;
await page.waitForSelector('nav[aria-label="Conversations"] li');
await page.click('nav[aria-label="Conversations"] li > button >> nth=1');
await page.waitForSelector('[data-role="assistant"]');
await page.waitForTimeout(500);
await shot('chat-light');

await app.close();
await h.stop();
console.log(`screenshots written to ${outDir}`);
