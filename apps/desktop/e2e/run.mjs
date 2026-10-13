// pnpm e2e  (after `pnpm build` so the bridge bundle exists)
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const real = process.env.E2E_REAL === '1';
const h = await startHarness({ real });
const shot = (app, name) => app.page.screenshot({ path: join(outDir, `${name}.png`) });
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
};

const send = async (page, text) => {
  await page.fill('textarea[aria-label="Message"]', text);
  await page.press('textarea[aria-label="Message"]', 'Enter');
};
const lastReply = (page) => page.locator('[data-role="assistant"]').last();

let app = await h.launch({ theme: 'dark' });

await step('empty state renders and bridge pings', async () => {
  await app.page.waitForSelector('text=What are we building?');
  assert.match(await app.page.locator('aside').innerText(), /Bridge ready|pong/);
  await shot(app, '01-empty-dark');
});

await step('streams a markdown reply with highlighted code', async () => {
  await send(
    app.page,
    real
      ? 'Reply with a short sentence in bold, then a 2-line TypeScript code block.'
      : 'hello there',
  );
  await app.page.waitForSelector('[data-role="assistant"]:not([data-streaming])', {
    timeout: 60000,
  });
  if (!real) {
    assert.equal(await lastReply(app.page).locator('strong').innerText(), 'hello there');
    await app.page.waitForSelector('.code-block .hljs-keyword');
  } else {
    await app.page.waitForSelector('.code-block');
  }
  await shot(app, '02-reply-dark');
});

await step('Shift+Enter inserts a newline instead of sending', async () => {
  const box = app.page.locator('textarea[aria-label="Message"]');
  await box.fill('line one');
  await box.press('Shift+Enter');
  await box.type('line two');
  assert.equal(await box.inputValue(), 'line one\nline two');
  assert.equal(await app.page.locator('[data-role="user"]').count(), 1);
  await box.fill('');
});

if (!real) {
  await step('stop mid-response keeps the partial reply and chat resumes', async () => {
    await send(app.page, 'slow please');
    await app.page.waitForSelector('[data-streaming="true"] .md');
    await app.page.waitForFunction(() =>
      document.querySelector('[data-streaming="true"]')?.textContent.includes('word5'),
    );
    await shot(app, '03-streaming');
    await app.page.click('button[aria-label="Stop generating"]');
    await app.page.waitForSelector('text=Stopped');
    await app.page.waitForSelector('button[aria-label="Send"]');
    const partial = await lastReply(app.page).innerText();
    assert.ok(
      partial.includes('word0') && !partial.includes('word399'),
      'partial text kept, not complete',
    );
    await send(app.page, 'are you still there');
    await app.page.waitForFunction(() =>
      document.body.innerText.includes('Echo: are you still there'),
    );
  });

  await step('scrolling up pauses auto-follow; Jump to latest resumes', async () => {
    await send(app.page, 'slow again');
    const scroller = app.page.getByTestId('message-scroll');
    await app.page.waitForFunction(() =>
      document.querySelector('[data-streaming="true"]')?.textContent.includes('word3'),
    );
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await app.page.waitForTimeout(300);
    const top = await scroller.evaluate((el) => el.scrollTop);
    await app.page.waitForTimeout(600);
    assert.equal(
      await scroller.evaluate((el) => el.scrollTop),
      top,
      'view did not jump while streaming',
    );
    await app.page.click('text=Jump to latest');
    const atEnd = await scroller.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 100,
    );
    assert.ok(atEnd, 'jumped to bottom');
    await app.page.click('button[aria-label="Stop generating"]');
    await app.page.waitForSelector('button[aria-label="Send"]');
  });

  await step('auth failure shows a friendly message, not a stack trace', async () => {
    await send(app.page, 'login now');
    await app.page.waitForSelector('text=Not logged in to Claude');
    const alert = app.page.getByRole('alert').last();
    const text = await alert.innerText();
    assert.match(text, /Not logged in to Claude/);
    assert.match(text, /claude/);
    assert.doesNotMatch(text, /at .*\.(js|ts):\d+/);
    await shot(app, '04-auth-error');
  });

  await step('usage limit shows the window and reset time; retry works', async () => {
    await send(app.page, 'limit please');
    await app.page.waitForSelector('text=Usage limit reached');
    const alert = app.page.getByRole('alert').last();
    const text = await alert.innerText();
    assert.match(text, /5-hour/);
    assert.match(text, /resets at .*\(in (2h 5\d|3h 0)m\)/);
    await shot(app, '05-limit-error');
  });
}

await step('conversation persists across an app restart and is searchable', async () => {
  await app.close();
  app = await h.launch({ theme: 'dark' });
  await app.page.waitForSelector('nav[aria-label="Conversations"] li');
  assert.ok((await app.page.locator('nav li').count()) >= 1);
  await app.page.fill('input[aria-label="Search conversations"]', 'zzz-no-such-text');
  await app.page.waitForSelector('text=No chats match your search.');
  await app.page.fill('input[aria-label="Search conversations"]', real ? 'bold' : 'hello');
  await app.page.waitForSelector('nav li');
  await app.page.click('nav li button >> nth=0');
  await app.page.waitForSelector('[data-role="user"]');
  assert.ok((await app.page.locator('[data-role="assistant"]').count()) >= 1);
  await shot(app, '06-restored');
});

await step('rename, pin and delete (with confirm) from the sidebar', async () => {
  await app.page.fill('input[aria-label="Search conversations"]', '');
  await app.page.waitForSelector('nav li');
  const row = app.page.locator('nav li').first();
  await row.hover();
  await row.getByRole('button', { name: 'Rename' }).click();
  await app.page.fill('input[aria-label="Conversation title"]', 'Renamed chat');
  await app.page.press('input[aria-label="Conversation title"]', 'Enter');
  await app.page.waitForSelector('nav >> text=Renamed chat');
  await app.page.locator('nav li', { hasText: 'Renamed chat' }).hover();
  await app.page
    .locator('nav li', { hasText: 'Renamed chat' })
    .getByRole('button', { name: 'Pin' })
    .click();
  await app.page.waitForSelector('nav >> text=Pinned');
  await shot(app, '07-sidebar-pinned');
  await app.page.locator('nav li', { hasText: 'Renamed chat' }).hover();
  await app.page
    .locator('nav li', { hasText: 'Renamed chat' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await app.page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await app.page.locator('nav >> text=Renamed chat').count(), 1, 'cancel keeps it');
  await app.page.locator('nav li', { hasText: 'Renamed chat' }).hover();
  await app.page
    .locator('nav li', { hasText: 'Renamed chat' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await app.page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await app.page.waitForFunction(
    () => !document.querySelector('nav')?.textContent.includes('Renamed chat'),
  );
});

await step(
  'text file attachment: drag-in style via file input, sent with the message',
  async () => {
    await app.page.click('button[aria-label="New chat"], button:has-text("New chat")');
    await app.page.setInputFiles('[data-testid="file-input"]', {
      name: 'notes.ts',
      mimeType: 'text/plain',
      buffer: Buffer.from('export const answer = 42;\n'),
    });
    await app.page.waitForSelector('text=notes.ts');
    await send(
      app.page,
      real
        ? 'What number does the attached file export? Answer with just the number.'
        : 'review attachment',
    );
    await app.page.waitForSelector('[data-role="assistant"]:not([data-streaming])', {
      timeout: 60000,
    });
    const stored = h.db
      .prepare('SELECT attachments FROM messages WHERE attachments IS NOT NULL')
      .get();
    assert.match(stored.attachments, /answer = 42/);
    if (real) assert.match(await lastReply(app.page).innerText(), /42/);
    await app.page.setInputFiles('[data-testid="file-input"]', {
      name: 'img.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0, 1, 2]),
    });
    await app.page.waitForSelector('text=does not look like a text file');
  },
);

await step('long conversation is virtualized (few DOM rows, instant scroll)', async () => {
  const id = 'long-conv';
  h.db
    .prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, 1, 99999999999999)',
    )
    .run(id, 'Long chat');
  const insert = h.db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < 2000; i++) {
    insert.run(
      `m${i}`,
      id,
      i % 2 ? 'assistant' : 'user',
      i % 2
        ? `Reply ${i}\n\n\`\`\`ts\nconst n = ${i};\n\`\`\`\n\n` +
            'lorem ipsum dolor sit amet '.repeat(20)
        : `Question ${i}`,
      10 + i,
    );
  }
  await app.close();
  app = await h.launch({ theme: 'dark' });
  await app.page.click('nav >> text=Long chat');
  await app.page.waitForSelector('text=Question 1998');
  const mounted = await app.page.locator('[data-role]').count();
  assert.ok(mounted < 60, `only visible rows are mounted (got ${mounted} of 2000)`);
  const t0 = Date.now();
  await app.page
    .getByTestId('message-scroll')
    .evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  await app.page.waitForTimeout(100);
  assert.ok((await app.page.locator('[data-role]').count()) < 60);
  assert.ok(Date.now() - t0 < 1500, 'scrolling is responsive');
  await shot(app, '08-long-chat');
});

await step('light theme renders the chat', async () => {
  await app.page.click('button[aria-label="Switch to light theme"]');
  await app.page.waitForTimeout(150);
  await shot(app, '09-light');
});

await step('bridge crash: in-flight chat fails cleanly and the badge restarts it', async () => {
  if (real) return;
  await app.page.click('nav >> text=Long chat');
  await send(app.page, 'slow crash test');
  await app.page.waitForSelector('[data-streaming="true"]');
  app.killBridge();
  await app.page.waitForSelector('text=Something went wrong');
  await shot(app, '10-bridge-crash');
  await app.page.waitForSelector('aside >> text=Bridge error');
  await app.page.click('aside button:has-text("Bridge error")');
  await app.page.waitForSelector('aside >> text=/Bridge ready|pong \\d+ms/');
});

assert.deepEqual(
  // The ResizeObserver message is a benign browser notice from measuring virtualized rows.
  h.consoleErrors.filter((e) => !/Failed to load resource|favicon|ResizeObserver loop/.test(e)),
  [],
  'no console errors',
);
await app.close();
await h.stop();
console.log(results.join('\n'));
console.log(`screenshots: ${outDir}`);
