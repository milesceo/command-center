// A stand-in for @anthropic-ai/claude-agent-sdk used by process-level tests and
// the e2e harness (via PROGRAMISH_QUERY_MODULE). Behavior is chosen by the prompt:
//   "slow ..."  streams words forever-ish (until aborted), to exercise Stop
//   "login ..." behaves like a logged-out runtime
//   "limit ..." behaves like an exhausted 5-hour window
//   "stress ..." streams ~6 KB of mixed markdown at ~500 tokens/s (perf checks)
//   anything else echoes back a short markdown reply.
export function query({ prompt, options }) {
  const signal = options?.abortController?.signal;
  const sleep = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  const last = prompt.split('[user]\n').pop() ?? prompt;

  return (async function* () {
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
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5,
        usage: { input_tokens: 10, output_tokens: body.length },
      };
      return;
    }
    const text = last.startsWith('slow')
      ? Array.from({ length: 400 }, (_, i) => `word${i} `).join('')
      : `Echo: **${last.trim().slice(0, 60)}**\n\n\`\`\`ts\nconst answer = 42;\n\`\`\`\n`;
    for (const word of text.split(/(?<= )/)) {
      if (signal?.aborted) return;
      yield {
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } },
      };
      await sleep(last.startsWith('slow') ? 25 : 8);
    }
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 5,
      usage: { input_tokens: 10, output_tokens: text.length },
    };
  })();
}
