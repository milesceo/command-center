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
    results.push(`FAIL ${name}: ${err.message.split('\n').slice(0, 6).join(' | ')}`);
    await app.page.screenshot({ path: join(outDir, `fail-${results.length}.png`) }).catch(() => {});
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
    await app.page.waitForSelector('.code-lc span[style*="shiki-token-keyword"]');
  } else {
    await app.page.waitForSelector('.code-block');
  }
  await shot(app, '02-reply-dark');
});

await step('the first reply is recorded in the usage ledger and shown in the header', async () => {
  await app.page.waitForSelector('[data-testid="conversation-usage"]', { timeout: 15000 });
  const row = h.db.prepare('select * from usage_log order by created_at desc limit 1').get();
  assert.ok(row.model, 'a model name was recorded');
  assert.ok(row.output_tokens > 0, 'output tokens recorded');
  assert.ok(
    row.input_tokens + row.cache_read_tokens + row.cache_creation_tokens > 0,
    'input recorded',
  );
  if (real) console.log('real usage row:', JSON.stringify(row));
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
    // Wait for the reply to finish, or the next Enter is ignored while it still streams.
    await app.page.waitForSelector('button[aria-label="Send"]');
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
  // The search is debounced (150 ms) and reloads the list: let that settle before editing a row.
  await app.page.waitForTimeout(500);
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

if (!real) {
  const newChat = async () => {
    await app.page.click('aside button:has-text("New chat")');
    await app.page.waitForSelector('text=What are we building?');
  };
  const demo = async (kind) => {
    await send(app.page, `demo ${kind}`);
    await app.page.waitForSelector('[data-role="assistant"]:not([data-streaming])', {
      timeout: 30000,
    });
  };
  const frame = () => app.page.frameLocator('iframe[title^="Preview"]');
  const panel = () => app.page.getByLabel('Preview', { exact: true });
  const openConsole = async () => {
    const toggle = app.page.getByRole('button', { name: 'Toggle console' });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  };
  const openPreview = async (n = 'last') => {
    const btns = app.page.getByRole('button', { name: 'Open in preview' });
    await (n === 'last' ? btns.last() : btns.nth(n)).click();
    await panel().waitFor();
  };

  await app.page.evaluate(() => localStorage.removeItem('programish-ui'));
  await app.close();
  app = await h.launch({ theme: 'dark' });
  await newChat();

  await step('code block: header, line numbers, collapse, wrap, theme-matched colors', async () => {
    await demo('long');
    const block = app.page.getByTestId('code-block');
    assert.match(await block.locator('header, div').first().innerText(), /ts\s+long\.ts/);
    assert.equal(await block.locator('.code-line').count(), 16, 'collapsed to 16 lines');
    await app.page.click('text=Show 44 more lines');
    assert.equal(await block.locator('.code-line').count(), 60);
    assert.equal(await block.locator('.code-ln').first().innerText(), '1');
    await app.page.waitForFunction(() =>
      [...document.querySelectorAll('.code-lc span')].some((s) =>
        s.style.color.includes('--shiki-token-keyword'),
      ),
    );
    const color = () =>
      app.page.evaluate(() => {
        const el = [...document.querySelectorAll('.code-lc span')].find((s) =>
          s.style.color.includes('keyword'),
        );
        return getComputedStyle(el).color;
      });
    const dark = await color();
    await shot(app, '11-code-block-dark');
    await app.page.click('button[aria-label="Switch to light theme"]');
    const light = await color();
    assert.notEqual(dark, light, 'token colors follow the theme');
    await shot(app, '12-code-block-light');
    await app.page.click('button[aria-label="Switch to dark theme"]');
    await app.page.click('button[aria-label="Toggle line wrap"]');
    assert.ok((await block.locator('.code-wrap').count()) > 0);
    await app.page.click('button[aria-label="Toggle line wrap"]');
  });

  await step('code block: copy and save as file', async () => {
    await app.page.getByRole('button', { name: 'Copy code' }).click();
    const copied = await app.page.evaluate(() => navigator.clipboard.readText());
    assert.ok(
      copied.startsWith('export const value0 = 0;') &&
        !copied.includes(' ') &&
        !/^\d+\s/.test(copied),
      'raw code, no line numbers',
    );
    assert.equal(copied.split('\n').length, 60);
    // The harness plays the native save dialog and the fs plugin, so this exercises the desktop save path.
    await app.page.getByRole('button', { name: 'Save as file' }).click();
    await app.page.waitForSelector('text=Saved');
    const [[path, text]] = [...h.saved.entries()];
    assert.ok(path.endsWith('long.ts'), `saved as ${path}`);
    assert.equal(text, copied);
  });

  await step('HTML preview: sandboxed iframe, console output, errors', async () => {
    await newChat();
    await demo('html');
    await openPreview();
    await frame().locator('#t').waitFor();
    assert.equal(
      await app.page.locator('iframe[title^="Preview"]').getAttribute('sandbox'),
      'allow-scripts',
    );
    await openConsole();
    const log = app.page.getByRole('log');
    await app.page.waitForFunction(() =>
      document.querySelector('[role="log"]')?.textContent.includes('boom'),
    );
    const text = await log.innerText();
    assert.match(text, /hello from preview/);
    assert.match(text, /warn: careful/);
    assert.match(text, /error: .*boom/);
    await shot(app, '13-html-preview-console');
  });

  await step('previewed code cannot reach the app, storage, IPC or network', async () => {
    await newChat();
    await demo('isolation');
    await openPreview();
    await openConsole();
    await app.page.waitForFunction(
      () => document.querySelector('[role="log"]')?.textContent.includes('RESULT'),
      null,
      { timeout: 15000 },
    );
    const text = await app.page.getByRole('log').innerText();
    assert.match(text, /RESULT parent=blocked storage=blocked tauri=absent fetch=blocked/);
  });

  await step('viewport toggle, refresh, tabs', async () => {
    const stageWidth = () =>
      app.page
        .getByTestId('preview-stage')
        .locator('> div')
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await app.page.getByRole('button', { name: /^Mobile/ }).click();
    assert.equal(await stageWidth(), 375);
    await app.page.getByRole('button', { name: /^Tablet/ }).click();
    assert.equal(
      await stageWidth(),
      768 > (await app.page.getByTestId('preview-stage').boundingBox()).width
        ? await stageWidth()
        : 768,
    );
    await app.page.getByRole('button', { name: /^Desktop/ }).click();
    await app.page.getByRole('button', { name: 'Refresh preview' }).click();
    await frame().locator('#p').waitFor();
    assert.ok(
      (await app.page.getByRole('tab', { selected: true }).count()) === 1,
      'one active tab',
    );
  });

  await step('SVG, Mermaid and Markdown previews', async () => {
    await newChat();
    await demo('svg');
    await openPreview();
    await frame().locator('circle#c').waitFor();
    await shot(app, '14-svg-preview');
    await newChat();
    await demo('mermaid');
    await openPreview();
    await frame().locator('svg .node').first().waitFor({ timeout: 60000 });
    await shot(app, '15-mermaid-preview');
    await newChat();
    await demo('md');
    await openPreview();
    await panel().getByRole('heading', { name: 'Release notes' }).waitFor();
    assert.equal(await panel().locator('table').count(), 1);
    assert.ok((await app.page.getByRole('tab').count()) >= 3, 'previews accumulate as tabs');
  });

  await step('preview follows a reply that is still streaming', async () => {
    await newChat();
    await send(app.page, 'demo stream-html');
    await app.page.getByRole('button', { name: 'Open in preview' }).waitFor();
    await openPreview();
    assert.equal(
      await app.page.locator('[data-streaming="true"]').count(),
      1,
      'still streaming when the preview opened',
    );
    await frame().getByText('Part 2').waitFor();
    await frame().locator('#last').waitFor({ timeout: 15000 });
    await app.page.waitForSelector('[data-role="assistant"]:not([data-streaming])');
    assert.equal(await frame().locator('#last').innerText(), 'Part 5');
  });

  await step('diff in a reply: side-by-side and inline, changed words highlighted', async () => {
    await newChat();
    await demo('diff');
    const diff = app.page.getByTestId('diff-block');
    await diff.waitFor();
    // With the preview panel open the chat column is narrower than the side-by-side minimum, so it falls back to inline.
    assert.equal(
      await diff.locator('[data-requested="split"]').getAttribute('data-mode'),
      'inline',
    );
    await app.page.keyboard.press('Control+Shift+P');
    await app.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="diff-block"] [data-mode]')
          ?.getAttribute('data-mode') === 'split',
    );
    assert.equal(await diff.locator('[data-mode="split"]').count(), 1);
    assert.ok((await diff.locator('mark').count()) > 0, 'changed words are highlighted');
    await shot(app, '16-diff-split');
    await diff.getByRole('button', { name: 'Inline diff' }).click();
    assert.equal(await diff.locator('[data-mode="inline"]').count(), 1);
    await shot(app, '17-diff-inline');
    await diff.getByRole('button', { name: 'Side-by-side diff' }).click();
  });

  await step('compare two code blocks, and a block against its earlier version', async () => {
    await newChat();
    await demo('two');
    const compare = app.page.getByRole('button', { name: /compare with/i });
    await compare.first().click();
    await app.page.getByRole('button', { name: /^Compare with a\.ts/ }).waitFor();
    await compare.last().click();
    await panel().getByTestId('diff-file').waitFor();
    assert.ok((await panel().locator('mark').count()) > 0);
    await shot(app, '18-compare-blocks');
    await newChat();
    await demo('v1');
    await demo('v2');
    await app.page.getByRole('button', { name: 'Diff against earlier version' }).click();
    await panel().getByText('VERSION').first().waitFor();
    assert.match(await panel().innerText(), /\+1.*−1|\+2.*−2/s);
  });

  await step('keyboard shortcuts and the shortcuts dialog', async () => {
    const mod = 'Control';
    const panelOpen = async () => (await panel().count()) > 0;
    const before = await panelOpen();
    await app.page.keyboard.press(`${mod}+Shift+P`);
    assert.notEqual(await panelOpen(), before);
    await app.page.keyboard.press(`${mod}+Shift+P`);
    assert.equal(await panelOpen(), before);
    await newChat();
    await demo('two');
    await app.page.evaluate(() => navigator.clipboard.writeText('x'));
    await app.page.keyboard.press(`${mod}+Shift+C`);
    await app.page.waitForSelector('text=Copied last code block');
    assert.equal(
      await app.page.evaluate(() => navigator.clipboard.readText()),
      'const mode = "safe";\nconst retries = 3;',
    );
    await app.page.keyboard.press(`${mod}+/`);
    await app.page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
    await shot(app, '19-shortcuts');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(), 0);
  });
}

if (!real) {
  const page = app.page;
  const dialog = (name) => page.getByRole('dialog', { name });
  const newChatFresh = async () => {
    await page.click('aside button:has-text("New chat")');
    await page.waitForSelector('text=What are we building?');
  };
  const finished = () =>
    page.waitForSelector('[data-role="assistant"]:not([data-streaming])', { timeout: 30000 });
  const openView = async (name) => {
    await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name }).click();
  };

  await step('usage: each reply is recorded exactly and shown in the chat header', async () => {
    await newChatFresh();
    await send(page, 'demo v1');
    await finished();
    // The ledger row is written right after the done event.
    await page.waitForSelector('[data-testid="conversation-usage"]');
    const reply = h.db
      .prepare(
        "select content from messages where role = 'assistant' order by created_at desc limit 1",
      )
      .get();
    const row = h.db.prepare('select * from usage_log order by created_at desc limit 1').get();
    assert.equal(row.model, 'fake-model');
    assert.equal(row.input_tokens, 'demo v1'.length);
    assert.equal(row.output_tokens, Math.ceil(reply.content.length / 4));
    assert.equal(row.cache_read_tokens, 1000);
    assert.equal(row.cache_creation_tokens, 200);
    const cost = (row.input_tokens + row.output_tokens * 5 + 1000 * 0.1 + 200 * 1.25) / 1e6;
    assert.ok(Math.abs(row.cost_usd - cost) < 1e-12, `cost ${row.cost_usd} vs ${cost}`);
    const total = row.input_tokens + row.output_tokens + 1000 + 200;
    const header = await page.getByTestId('conversation-usage').getAttribute('title');
    assert.match(header, /1 reply/);
    assert.match(header, /API-equivalent cost/);
    assert.match(header, /informational, not a bill/);
    const shown = (await page.getByTestId('conversation-usage').innerText()).match(
      /([\d.]+)(k?) tokens/,
    );
    assert.ok(shown, 'header shows a token count');
    const shownTotal = Number(shown[1]) * (shown[2] ? 1000 : 1);
    assert.ok(Math.abs(shownTotal - total) <= 50, `header ${shownTotal} vs ledger ${total}`);
    await shot(app, '20-chat-header-usage');
  });

  await step('usage view: totals match the ledger, charts, table view, plan headroom', async () => {
    await openView('Usage');
    await page.getByTestId('usage-view').waitFor();
    const replies = h.db.prepare('select count(*) as n from usage_log').get().n;
    const tile = page
      .getByTestId('usage-totals')
      .locator('div', { hasText: /^Replies/ })
      .first();
    await page.waitForFunction(
      (n) =>
        document.querySelector('[data-testid="usage-totals"]')?.textContent.includes(`Replies${n}`),
      replies,
    );
    assert.ok(await tile.count());
    await page.getByRole('figure', { name: 'Tokens per day' }).waitFor();
    await page.getByRole('figure', { name: 'Tokens per week' }).waitFor();
    await page
      .getByRole('group', { name: 'Metric' })
      .getByRole('button', { name: 'API-equivalent cost' })
      .click();
    await page.getByRole('figure', { name: 'API-equivalent cost per day' }).waitFor();
    await page
      .getByRole('group', { name: 'Metric' })
      .getByRole('button', { name: 'Tokens' })
      .click();
    const fig = page.getByRole('figure', { name: 'Tokens per day' });
    await fig.getByRole('button', { name: 'Table' }).click();
    assert.ok((await fig.locator('table tbody tr').count()) >= 1, 'table view lists the days');
    await fig.getByRole('button', { name: 'Chart' }).click();
    // Headroom: the usage report answers 41% / 18% used (5-hour / weekly) and an Opus-only window at 63%.
    const five = page.locator('[data-window="five_hour"]');
    await five.waitFor();
    await page.waitForFunction(() =>
      document.querySelector('[data-window="five_hour"]')?.textContent.includes('59% left'),
    );
    assert.match(await five.innerText(), /41% used/);
    assert.match(await page.locator('[data-window="seven_day"]').innerText(), /82% left/);
    assert.match(await page.getByLabel('Plan headroom').innerText(), /Opus/);
    assert.match(await five.innerText(), /resets/i);
    await shot(app, '21-usage-view');
  });

  await step('prompt library: create, search, filter, edit', async () => {
    await openView('Prompts');
    await page.getByTestId('prompts-view').waitFor();
    await page.getByRole('button', { name: 'New prompt' }).click();
    await page.getByLabel('Title').fill('Code review');
    await page.getByLabel('Tags').fill('review, code');
    await page.getByLabel('Body').fill('Review this {{language}} code:\n\n{{code}}');
    assert.match(
      await page.getByLabel('Variables', { exact: true }).innerText(),
      /language[\s\S]*code/,
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'New prompt' }).click();
    await dialog('New prompt').getByText('System prompt', { exact: true }).click();
    await page.getByLabel('Title').fill('Pirate');
    await page.getByLabel('Body').fill('Always answer like a {{creature}}.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await page.getByTestId('prompt-item').count(), 2);
    await page.getByLabel('Search prompts').fill('pira');
    assert.equal(await page.getByTestId('prompt-item').count(), 1);
    await page.getByLabel('Search prompts').fill('');
    await page.getByRole('button', { name: '#review' }).click();
    assert.equal(await page.getByTestId('prompt-item').count(), 1);
    await page.getByRole('button', { name: '#review' }).click();
    await page.getByRole('button', { name: 'Edit Code review' }).click();
    await page.getByLabel('Title').fill('Code review v2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Code review v2').waitFor();
    await shot(app, '22-prompts');
  });

  await step('prompt with variables: Insert opens a form and fills the composer', async () => {
    await page
      .getByTestId('prompt-item')
      .filter({ hasText: 'Code review v2' })
      .getByRole('button', { name: 'Insert' })
      .click();
    const form = dialog('Code review v2');
    await form.getByLabel('language').fill('Rust');
    await form.getByLabel('code').fill('fn main() {}');
    assert.match(await form.getByTestId('variables-preview').innerText(), /Review this Rust code/);
    await form.getByRole('button', { name: 'Insert' }).click();
    assert.equal(
      await page.locator('textarea[aria-label="Message"]').inputValue(),
      'Review this Rust code:\n\nfn main() {}',
    );
    await page.locator('textarea[aria-label="Message"]').fill('');
  });

  await step('slash command searches the library and inserts', async () => {
    const box = page.locator('textarea[aria-label="Message"]');
    await box.fill('/rev');
    await page.getByRole('listbox', { name: 'Saved prompts' }).waitFor();
    assert.equal(
      await page.getByRole('listbox', { name: 'Saved prompts' }).getByRole('option').count(),
      1,
    );
    await box.press('Enter');
    const form = dialog('Code review v2');
    await form.getByLabel('language').fill('Go');
    await form.getByLabel('code').fill('x := 1');
    await form.getByRole('button', { name: 'Insert' }).click();
    assert.equal(await box.inputValue(), 'Review this Go code:\n\nx := 1');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await box.fill('/zzzz');
    assert.equal(
      await page.getByRole('listbox', { name: 'Saved prompts' }).getByRole('option').count(),
      0,
    );
    await box.press('Escape');
    await box.fill('');
  });

  await step('export and import round-trip the library as JSON', async () => {
    await openView('Prompts');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.waitForSelector('text=Library exported');
    const file = [...h.saved.entries()].find(([path]) => path.endsWith('programish-prompts.json'));
    assert.ok(file, 'export wrote the file');
    const exported = JSON.parse(file[1]);
    assert.equal(exported.format, 'programish-prompts');
    assert.equal(exported.prompts.length, 2);

    await page.getByRole('button', { name: 'Delete Pirate' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(await page.getByTestId('prompt-item').count(), 1);

    await page.getByTestId('import-input').setInputFiles({
      name: 'programish-prompts.json',
      mimeType: 'application/json',
      buffer: Buffer.from(file[1]),
    });
    await page.waitForSelector('text=/Imported: 1 added, 0 updated, 1 skipped/');
    assert.equal(await page.getByTestId('prompt-item').count(), 2);

    await page.getByTestId('import-input').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"nope":true}'),
    });
    await page.waitForSelector('[role="status"], [data-toast]', { timeout: 3000 }).catch(() => {});
    assert.equal(await page.getByTestId('prompt-item').count(), 2, 'a bad file changes nothing');
  });

  await step('projects: group chats, default system prompt, per-chat override', async () => {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Project name').fill('Alpha');
    await page.getByLabel('Project name').press('Enter');
    await page.getByRole('region', { name: 'Project Alpha' }).waitFor();

    await page.getByRole('region', { name: 'Project Alpha' }).hover();
    await page.getByRole('button', { name: 'Settings for Alpha' }).click();
    const settings = dialog('Project: Alpha');
    await settings.getByLabel('Default system prompt').selectOption({ label: 'Pirate' });
    await settings.getByLabel('creature').fill('parrot');
    await settings.getByRole('button', { name: 'Save' }).click();

    await page.getByRole('region', { name: 'Project Alpha' }).hover();
    await page.getByRole('button', { name: 'New chat in Alpha' }).click();
    await page.waitForSelector('text=What are we building?');
    await send(page, 'in the project');
    await finished();
    assert.match(await lastReply(page).innerText(), /system: Always answer like a parrot\./);
    assert.equal(
      await page.getByRole('region', { name: 'Project Alpha' }).getByText('in the project').count(),
      1,
      'the chat sits under its project',
    );

    await page.getByRole('button', { name: 'Chat settings' }).click();
    assert.match(
      await page.getByTestId('system-prompt-source').innerText(),
      /“Pirate”, the project default/,
    );
    await page.getByLabel('Custom system prompt').fill('Be terse.');
    await page.getByLabel('Custom system prompt').blur();
    await page.keyboard.press('Escape');
    await send(page, 'second');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-role="assistant"]')]
        .at(-1)
        ?.textContent.includes('Be terse.'),
    );

    // Move the chat out of the project and back with the row menu.
    await page.getByRole('button', { name: 'Chat settings' }).click();
    await page.getByLabel('Project', { exact: true }).selectOption({ label: 'No project' });
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[aria-label="Project Alpha"]')
          ?.textContent.includes('in the project'),
    );
    await shot(app, '23-projects');
  });

  await step('library system prompt attaches to one chat and keeps its variables', async () => {
    await newChatFresh();
    await openView('Prompts');
    await page
      .getByTestId('prompt-item')
      .filter({ hasText: 'Pirate' })
      .getByRole('button', { name: 'Use in this chat' })
      .click();
    const form = dialog('Pirate');
    await form.getByLabel('creature').fill('kraken');
    await form.getByRole('button', { name: 'Use as system prompt' }).click();
    await openView('Prompts'); // toggles back to the chat
    await send(page, 'attach test');
    await finished();
    assert.match(await lastReply(page).innerText(), /system: Always answer like a kraken\./);
  });
}

console.log(results.join('\n'));
console.log(`screenshots: ${outDir}`);
assert.deepEqual(
  // The ResizeObserver message is a benign browser notice from measuring virtualized rows; the sandbox/CSP
  // and `boom` lines come from the previewed test pages themselves (probing isolation, throwing on purpose).
  h.consoleErrors.filter(
    (e) =>
      !/Failed to load resource|favicon|ResizeObserver loop|sandboxed and lacks|Refused to connect|Fetch API cannot load|Error: boom/.test(
        e,
      ),
  ),
  [],
  'no console errors',
);
await app.close();
await h.stop();
