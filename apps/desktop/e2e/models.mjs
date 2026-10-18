// Model Lab end to end: open the Lab, add a model from a pasted Hugging Face link (the Hub is
// stubbed), point it at a scripted OpenAI-compatible server on 127.0.0.1, test it side by side,
// keep the reply, and chat with it. No real network, no real runtime, no login.
//   pnpm --filter @command-center/bridge build
//   E2E_CHROMIUM=<chrome> node e2e/models.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { outDir, startHarness } from './harness.mjs';

const REPO = 'e2e-org/Tiny-Chat-GGUF';
const SERVED = 'e2e-tiny';

// The Hub's public API, as the app reads it (lib/hf-hub.ts). CORS like the real Hub.
const hubBody = (path) => {
  if (path === `/api/models/${REPO}/tree/main`) {
    return [
      { type: 'file', path: 'tiny-q4_k_m.gguf', size: 1, lfs: { size: 300_000_000 } },
      { type: 'file', path: 'tiny-q8_0.gguf', size: 1, lfs: { size: 600_000_000 } },
      { type: 'file', path: 'README.md', size: 2000 },
    ];
  }
  if (path === `/api/models/${REPO}`) {
    return {
      id: REPO,
      pipeline_tag: 'text-generation',
      tags: ['gguf', 'conversational'],
      downloads: 12,
      likes: 3,
      cardData: { license: 'apache-2.0' },
    };
  }
  if (path === '/api/models') return [{ id: REPO, downloads: 12, likes: 3, tags: ['gguf'] }];
  return null;
};
const hubRequests = [];
const stubHub = async (context) => {
  await context.route('https://huggingface.co/**', (route) => {
    const url = new URL(route.request().url());
    hubRequests.push(url.pathname);
    const body = hubBody(url.pathname);
    return route.fulfill({
      status: body === null ? 404 : 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body ?? { error: 'not found' }),
    });
  });
};

// A scripted OpenAI-compatible server: lists one model and streams a fixed reply with usage.
const chatRequests = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: SERVED }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(raw || '{}');
      chatRequests.push(body);
      const last = body.messages?.at(-1)?.content ?? '';
      const reply = /side by side/.test(String(last))
        ? 'Side by side reply from the scripted server.'
        : 'Chat reply from the scripted server.';
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const words = reply.split(/(?<= )/);
      let i = 0;
      const tick = () => {
        if (i < words.length) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`,
          );
          setTimeout(tick, 15);
          return;
        }
        res.write(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: words.length } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      };
      tick();
      return;
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const BASE_URL = `http://127.0.0.1:${port}/v1`;

const h = await startHarness({ real: false });
const results = [];
let app;
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message.split('\n').slice(0, 6).join(' | ')}`);
    await app?.page
      .screenshot({ path: join(outDir, `models-fail-${results.length}.png`) })
      .catch(() => {});
    process.exitCode = 1;
  }
};
const until = async (fn, what, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

try {
  app = await h.launch({ theme: 'dark', setup: stubHub });
  const { page } = app;

  await step('opens the Model Lab on its empty state', async () => {
    await page
      .getByRole('navigation', { name: 'Library' })
      .getByRole('button', { name: 'Model Lab' })
      .click();
    await page.getByTestId('model-lab').waitFor();
    await page.getByText('No models yet').waitFor();
  });

  await step('adds a model from a pasted Hugging Face link', async () => {
    await page.getByRole('button', { name: 'Add a model' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a model' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Paste a link' }).click();
    await dialog.getByLabel('Model id or link').fill(`https://huggingface.co/${REPO}/tree/main`);
    await dialog.getByRole('button', { name: 'Look up' }).click();
    const details = dialog.getByRole('region', { name: 'Model details' });
    await details.waitFor();
    await details.getByText(/License apache-2\.0/).waitFor();
    // Q4_K_M is preselected and the exact command is shown before anything runs.
    await details.getByText(`ollama run hf.co/${REPO}:Q4_K_M`).waitFor();
    assert.ok(hubRequests.includes(`/api/models/${REPO}`), 'model info read from the Hub');
    await details.getByRole('button', { name: /^Add / }).click();
    await dialog.waitFor({ state: 'detached' });
    const row = h.db.prepare('select * from custom_models').get();
    assert.equal(row.provider, 'local');
    assert.equal(row.model, `hf.co/${REPO}:Q4_K_M`);
    await page.getByRole('list', { name: 'Your models' }).getByText('Tiny-Chat Q4_K_M').waitFor();
  });

  await step('points the model at the scripted local server', async () => {
    await page.getByRole('button', { name: /^Settings for / }).click();
    const form = page.getByRole('dialog', { name: /^Model settings:/ });
    await form.waitFor();
    await form.getByLabel('Name', { exact: true }).fill('Tiny E2E');
    await form.getByLabel('Model name the server knows').fill(SERVED);
    await form.getByLabel('Server address').fill(BASE_URL);
    await form.getByRole('button', { name: 'Save' }).click();
    await form.waitFor({ state: 'detached' });
    const row = h.db.prepare('select * from custom_models').get();
    assert.equal(row.model, SERVED);
    assert.equal(row.base_url, BASE_URL);
  });

  await step('tests it side by side with the server’s own numbers', async () => {
    await page.getByLabel('Include Tiny E2E in the test').check();
    await page.getByLabel('Test prompt').fill('Answer side by side please');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const card = page.getByRole('article', { name: 'Tiny E2E' });
    await card
      .getByText('Side by side reply from the scripted server.')
      .waitFor({ timeout: 20000 });
    await until(async () => (await card.getAttribute('aria-busy')) === 'false', 'run to finish');
    const sent = chatRequests.at(-1);
    assert.equal(sent.model, SERVED);
    assert.equal(sent.stream, true);
    // Tokens come from the server's usage: 11 in + 7 out.
    await card.getByText('18', { exact: true }).waitFor();
    await page.screenshot({ path: join(outDir, 'models-test.png') });
  });

  await step('keeps the test reply as a conversation', async () => {
    await page
      .getByRole('article', { name: 'Tiny E2E' })
      .getByRole('button', { name: 'Save to conversation' })
      .click();
    await until(
      () =>
        h.db.prepare("select count(*) as n from conversations where title = 'Test: Tiny E2E'").get()
          .n === 1,
      'the saved conversation',
    );
    const conv = h.db.prepare("select id from conversations where title = 'Test: Tiny E2E'").get();
    const messages = h.db
      .prepare('select role, content from messages where conversation_id = ? order by created_at')
      .all(conv.id);
    assert.deepEqual(
      messages.map((m) => [m.role, m.content]),
      [
        ['user', 'Answer side by side please'],
        ['assistant', 'Side by side reply from the scripted server.'],
      ],
    );
  });

  await step('chats with the model from its card', async () => {
    await page
      .getByRole('navigation', { name: 'Library' })
      .getByRole('button', { name: 'Model Lab' })
      .click();
    await page.getByTestId('model-lab').waitFor();
    await page.getByRole('button', { name: 'Chat with Tiny E2E' }).click();
    const input = page.locator('textarea[aria-label="Message"]');
    await input.waitFor();
    const { id } = h.db.prepare('select id from custom_models').get();
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), `cm:${id}`);
    const before = chatRequests.length;
    await input.fill('Hello local model');
    await input.press('Enter');
    await page
      .locator('[data-role="assistant"]:not([data-streaming])')
      .last()
      .getByText('Chat reply from the scripted server.')
      .waitFor({ timeout: 20000 });
    assert.equal(chatRequests.length, before + 1);
    const sent = chatRequests.at(-1);
    assert.equal(sent.model, SERVED);
    assert.equal(sent.messages.at(-1).content, 'Hello local model');
    const reply = h.db
      .prepare("select * from messages where role = 'assistant' order by created_at desc limit 1")
      .get();
    assert.equal(reply.content, 'Chat reply from the scripted server.');
    assert.equal(reply.status, 'complete');
    await page.screenshot({ path: join(outDir, 'models-chat.png') });
  });

  await step('no unexpected console errors', async () => {
    const unexpected = h.consoleErrors.filter((e) => !/allow-same-origin/.test(e));
    assert.deepEqual(unexpected, []);
  });
} finally {
  await app?.close().catch(() => {});
  await h.stop();
  server.close();
}

console.log(results.join('\n'));
process.exit(process.exitCode ?? 0);
