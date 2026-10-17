// A stand-in for @anthropic-ai/claude-agent-sdk used by process-level tests and
// the e2e harness (via COMMAND_CENTER_QUERY_MODULE). Behavior is chosen by the prompt:
//   "slow ..."  streams words forever-ish (until aborted), to exercise Stop
//   "login ..." behaves like a logged-out runtime
//   "limit ..." behaves like an exhausted 5-hour window
//   "demo <kind> ..." replies with a ready-made code block for the preview/diff/code-block e2e checks
//   "stress ..." streams ~6 KB of mixed markdown at ~500 tokens/s (perf checks)
//   anything else echoes back a short markdown reply, ending with the system prompt it received.

const fence = (lang, body, meta = '') =>
  '```' + lang + (meta ? ' ' + meta : '') + '\n' + body + '\n```';
const V1 =
  'export function sum(a, b) {\n  return a + b;\n}\n\nexport function mul(a, b) {\n  return a * b;\n}\n\nexport const VERSION = 1;';
const V2 =
  'export function sum(a: number, b: number): number {\n  return a + b;\n}\n\nexport function mul(a, b) {\n  return a * b;\n}\n\nexport const VERSION = 2;';
const DEMOS = {
  html:
    'Here is a page:\n\n' +
    fence(
      'html',
      "<h1 id=\"t\">Hello preview</h1>\n<script>\nconsole.log('hello from preview');\nconsole.warn('careful');\nsetTimeout(function () { throw new Error('boom'); }, 20);\n</script>",
    ),
  isolation:
    'Probe:\n\n' +
    fence(
      'html',
      "<p id=\"p\">probe</p>\n<script>\nvar r = {};\ntry { void parent.document.title; r.parent = 'LEAK'; } catch (e) { r.parent = 'blocked'; }\ntry { void localStorage.getItem('x'); r.storage = 'LEAK'; } catch (e) { r.storage = 'blocked'; }\nr.tauri = typeof window.__TAURI_INTERNALS__ === 'undefined' ? 'absent' : 'LEAK';\nfetch('/').then(function () { r.fetch = 'LEAK'; done(); }, function () { r.fetch = 'blocked'; done(); });\nfunction done() { console.log('RESULT parent=' + r.parent + ' storage=' + r.storage + ' tauri=' + r.tauri + ' fetch=' + r.fetch); }\n</script>",
    ),
  svg:
    'A logo:\n\n' +
    fence(
      'svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle id="c" cx="50" cy="50" r="40" fill="tomato"/></svg>',
    ),
  mermaid:
    'A flow:\n\n' +
    fence('mermaid', 'graph TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]\n  B -->|no| A'),
  md:
    'Notes:\n\n' +
    fence('markdown', '# Release notes\n\n- fast\n- **small**\n\n| a | b |\n|---|---|\n| 1 | 2 |'),
  diff:
    'Apply this:\n\n' +
    fence(
      'diff',
      'diff --git a/src/total.ts b/src/total.ts\n--- a/src/total.ts\n+++ b/src/total.ts\n@@ -1,5 +1,6 @@\n export function total(items: number[]) {\n-  const sum = items.reduce((a, b) => a + b, 0);\n-  return sum;\n+  const sum = items.reduce((a, b) => a + b, 0) * 1.2;\n+  return Math.round(sum);\n }\n export const X = 1;',
    ),
  two:
    'Two options:\n\n' +
    fence('ts', 'const mode = "fast";\nconst retries = 1;', 'title="a.ts"') +
    '\n\nand\n\n' +
    fence('ts', 'const mode = "safe";\nconst retries = 3;', 'title="b.ts"'),
  v1: 'First version:\n\n' + fence('ts', V1),
  v2: 'Updated:\n\n' + fence('ts', V2),
  long:
    'A long file:\n\n' +
    fence(
      'ts',
      Array.from(
        { length: 60 },
        (_, i) => 'export const value' + i + ' = ' + i + '; // line ' + (i + 1),
      ).join('\n'),
      'title="long.ts"',
    ),
  'stream-html':
    'Building it:\n\n' +
    fence(
      'html',
      '<h1>Part 1</h1>\n<p>Part 2</p>\n<p>Part 3</p>\n<p>Part 4</p>\n<p id="last">Part 5</p>',
    ) +
    '\n\nDone.',
};

// Deterministic usage so end-to-end checks can assert exact numbers:
//   input = prompt length, output = ceil(reply length / 4), cache read 1000, cache write 200.
export const fakeUsage = (prompt, text) => ({
  inputTokens: prompt.length,
  outputTokens: Math.ceil(text.length / 4),
  cacheReadInputTokens: 1000,
  cacheCreationInputTokens: 200,
  webSearchRequests: 0,
  costUSD: (prompt.length + Math.ceil(text.length / 4) * 5 + 1000 * 0.1 + 200 * 1.25) / 1e6,
  contextWindow: 200000,
  maxOutputTokens: 64000,
  costBasis: 'list',
});

const finish = (prompt, text) => {
  const u = fakeUsage(prompt, text);
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 5,
    total_cost_usd: u.costUSD,
    usage: {
      input_tokens: u.inputTokens,
      output_tokens: u.outputTokens,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 200,
    },
    modelUsage: { 'fake-model': u },
  };
};

// Plan windows as the runtime attaches them to rate-limit events (fractions, unix seconds).
const windowsEvent = () => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    unifiedWindows: {
      five_hour: { utilization: 0.37, resetsAt: Math.floor(Date.now() / 1000) + 2 * 3600 },
      seven_day: { utilization: 0.12, resetsAt: Math.floor(Date.now() / 1000) + 3 * 86400 },
    },
  },
});

// The experimental /usage control request, as a logged-in subscription would answer it.
const usageResponse = () => ({
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 1,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {},
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 41, resets_at: new Date(Date.now() + 2 * 3600e3).toISOString() },
    seven_day: { utilization: 18, resets_at: new Date(Date.now() + 3 * 86400e3).toISOString() },
    seven_day_opus: null,
    model_scoped: [
      {
        display_name: 'Opus',
        utilization: 63,
        resets_at: new Date(Date.now() + 3 * 86400e3).toISOString(),
      },
    ],
    extra_usage: null,
  },
  behaviors: null,
});

export function query({ prompt, options }) {
  const signal = options?.abortController?.signal;
  const sleep = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  // A non-string prompt is the streaming-input form the bridge uses for control requests like /usage.
  const last = typeof prompt === 'string' ? (prompt.split('[user]\n').pop() ?? prompt) : '';

  const run = (async function* () {
    yield { type: 'system', subtype: 'init', model: 'fake-model' };
    if (last.startsWith('login')) {
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'authentication_failed',
        message: {
          id: 'm',
          content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in',
        errors: [],
        usage: {},
        duration_ms: 1,
      };
      return;
    }
    if (last.startsWith('limit')) {
      yield {
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          rateLimitType: 'five_hour',
          resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600,
        },
      };
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'rate_limit',
        message: { id: 'm', content: [{ type: 'text', text: 'limit' }] },
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'limit',
        errors: [],
        usage: {},
        duration_ms: 1,
      };
      return;
    }
    yield {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'm' } },
    };
    if (last.startsWith('demo ')) {
      const kind = last.slice(5).trim().split(/\s+/)[0];
      const body = DEMOS[kind] ?? 'unknown demo';
      const slow = kind === 'stream-html';
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'message_start', message: { id: 'm' } },
      };
      for (let i = 0; i < body.length; i += slow ? 4 : 24) {
        if (signal?.aborted) return;
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: body.slice(i, i + (slow ? 4 : 24)) },
          },
        };
        await sleep(slow ? 70 : 3);
      }
      yield windowsEvent();
      yield finish(last, body);
      return;
    }
    if (last.startsWith('stress')) {
      const section = (i) =>
        `## Section ${i}\n\nSome **bold** text, \`inline code\` and a [link](https://example.com/${i}).\n\n- item one\n- item two\n\n\`\`\`ts\nexport function f${i}(x: number): number {\n  // comment ${i}\n  return x * ${i};\n}\n\`\`\`\n\n`;
      const body = Array.from({ length: 24 }, (_, i) => section(i)).join('');
      for (let i = 0; i < body.length; i += 5) {
        if (signal?.aborted) return;
        yield {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: body.slice(i, i + 5) },
          },
        };
        if (i % 50 === 0) await sleep(1);
      }
      yield windowsEvent();
      yield finish(last, body);
      return;
    }
    const text = last.startsWith('slow')
      ? Array.from({ length: 400 }, (_, i) => `word${i} `).join('')
      : `Echo: **${last.trim().slice(0, 60)}**\n\n\`\`\`ts\nconst answer = 42;\n\`\`\`\n\nsystem: ${String(options?.systemPrompt ?? '').slice(0, 80)}\n`;
    for (const word of text.split(/(?<= )/)) {
      if (signal?.aborted) return;
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } },
      };
      await sleep(last.startsWith('slow') ? 25 : 8);
    }
    yield windowsEvent();
    yield finish(last, text);
  })();
  // The experimental /usage control request (used by the bridge's `usage` request).
  return Object.assign(run, {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
      Promise.resolve(usageResponse()),
  });
}
