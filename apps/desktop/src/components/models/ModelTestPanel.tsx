import type { BridgeEvent } from '@command-center/protocol';
import { Play, Save, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getBridgeClient } from '../../lib/bridge-client';
import type { ChatHandle } from '../../lib/bridge';
import { getDb } from '../../lib/db';
import { describeError } from '../../lib/errors';
import { formatTokens } from '../../lib/format';
import {
  applyEvent,
  newRun,
  testRequest,
  tokensPerSecond,
  type TestRun,
} from '../../lib/model-test';
import * as repo from '../../lib/repo';
import type { CustomModel } from '../../lib/repo-models';
import { secrets } from '../../lib/secrets';
import { DEFAULT_SETTINGS, type Message } from '../../lib/types';
import { ensureBridge } from '../../stores/bridge';
import { conversationsStore } from '../../stores/conversations';
import { customModelRef } from '../../stores/custom-models';
import { usePrefs } from '../../stores/prefs';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';

const ms = (n: number | null) =>
  n === null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;

/** Keeps a test reply as a normal conversation (the prompt and the reply) and opens it. */
async function saveRun(model: CustomModel, result: TestRun): Promise<void> {
  try {
    const db = await getDb();
    const conversation = await repo.createConversation(db, {
      ...DEFAULT_SETTINGS,
      provider: model.provider,
      model: customModelRef(model.id),
    });
    const now = Date.now();
    const base = {
      conversationId: conversation.id,
      attachments: [],
      error: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
    };
    const user: Message = {
      ...base,
      id: crypto.randomUUID(),
      role: 'user',
      content: result.prompt,
      status: 'complete',
      model: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: now,
    };
    const reply: Message = {
      ...base,
      id: crypto.randomUUID(),
      role: 'assistant',
      content: result.text,
      status: result.status === 'done' ? 'complete' : 'stopped',
      model: model.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      createdAt: now + 1,
    };
    await repo.insertMessage(db, user);
    await repo.insertMessage(db, reply);
    const store = conversationsStore.getState();
    await store.rename(conversation.id, `Test: ${model.displayName}`);
    store.select(conversation.id);
    useUiStore.getState().setView('chat');
  } catch (err) {
    toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface Props {
  models: CustomModel[];
}

/**
 * Sends one prompt to every chosen model at once and shows the replies side by side with what
 * each took: time to first text, tokens per second and tokens, all from the servers' own reports
 * (a dash when a server reports nothing). A reply can be kept as a normal conversation.
 */
export function ModelTestPanel({ models }: Props) {
  const [prompt, setPrompt] = useState('');
  const [runs, setRuns] = useState<Record<string, TestRun>>({});
  const handles = useRef<ChatHandle[]>([]);
  // Each Run (and each Stop) gets a new number; work and events from an older one are dropped,
  // because a cancelled chat still sends events until its terminal one.
  const runSeq = useRef(0);
  // Streamed events are applied once per frame, not once per token.
  const queued = useRef<{ id: string; event: BridgeEvent; elapsed: number }[]>([]);
  const frame = useRef<number | null>(null);
  const flush = () => {
    frame.current = null;
    const batch = queued.current;
    queued.current = [];
    if (batch.length === 0) return;
    setRuns((all) => {
      const next = { ...all };
      for (const { id, event, elapsed } of batch) {
        const current = next[id];
        if (current) next[id] = applyEvent(current, event, elapsed);
      }
      return next;
    });
  };
  const running = Object.values(runs).some((r) => r.status === 'running');

  // Leaving the Lab stops whatever is still answering.
  useEffect(
    () => () => {
      runSeq.current++;
      handles.current.forEach((h) => h.cancel());
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const run = async () => {
    const text = prompt.trim();
    if (!text || models.length === 0) return;
    const seq = ++runSeq.current;
    handles.current = [];
    setRuns(Object.fromEntries(models.map((m) => [m.id, newRun(m.id, text)])));
    try {
      await ensureBridge();
    } catch (err) {
      if (seq !== runSeq.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setRuns(
        Object.fromEntries(
          models.map((m) => [
            m.id,
            { ...newRun(m.id, text), status: 'error', error: { code: 'internal', message } },
          ]),
        ),
      );
      return;
    }
    // The key is read for this run only and handed straight to the bridge.
    const apiKey = models.some((m) => m.provider === 'huggingface')
      ? await secrets.get('huggingface').catch(() => null)
      : null;
    const allowRemote = usePrefs.getState().prefs.models.allowRemoteServers;
    // Stopped, run again or left while the bridge started: start nothing.
    if (seq !== runSeq.current) return;
    handles.current = models.map((m) => {
      const started = performance.now();
      return getBridgeClient().chat(testRequest(m, text, { apiKey, allowRemote }), (event) => {
        if (seq !== runSeq.current) return;
        queued.current.push({ id: m.id, event, elapsed: performance.now() - started });
        frame.current ??= requestAnimationFrame(flush);
      });
    });
  };

  const stop = () => {
    runSeq.current++;
    queued.current = [];
    handles.current.forEach((h) => h.cancel());
    handles.current = [];
    setRuns((all) =>
      Object.fromEntries(
        Object.entries(all).map(([id, r]) => [
          id,
          r.status === 'running' ? { ...r, status: 'stopped' as const } : r,
        ]),
      ),
    );
  };

  return (
    <section aria-labelledby="test-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="test-title" className="text-sm font-semibold">
          Test side by side
        </h2>
        <span className="text-[11px] text-fg-subtle">
          {models.length === 0
            ? 'Tick models above to compare them.'
            : `${models.length} model${models.length === 1 ? '' : 's'} chosen`}
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (running) stop();
          else void run();
        }}
      >
        <textarea
          aria-label="Test prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!running) void run();
            }
          }}
          placeholder="One prompt for every chosen model"
          className="min-h-16 flex-1 rounded-control border border-border bg-bg p-2 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong"
        />
        <Button
          type="submit"
          variant={running ? 'secondary' : 'primary'}
          className="self-end"
          disabled={!running && (models.length === 0 || prompt.trim() === '')}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? 'Stop' : 'Run'}
        </Button>
      </form>

      {models.length > 0 && Object.keys(runs).length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))` }}
        >
          {models.map((m) => {
            const r = runs[m.id];
            if (!r) return null;
            const speed = tokensPerSecond(r);
            const friendly = r.error ? describeError(r.error, undefined, m.provider) : null;
            return (
              <article
                key={m.id}
                aria-label={m.displayName}
                aria-busy={r.status === 'running'}
                className="flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-elevated p-3"
              >
                <header className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-xs font-medium">{m.displayName}</h3>
                  <span className="text-[11px] text-fg-subtle">
                    {r.status === 'running'
                      ? 'Answering…'
                      : r.status === 'stopped'
                        ? 'Stopped'
                        : ''}
                  </span>
                </header>
                <dl className="grid grid-cols-4 gap-1 text-[11px]">
                  {(
                    [
                      ['First text', ms(r.ttftMs)],
                      ['Tokens/s', speed === null ? '–' : speed.toFixed(1)],
                      [
                        'Tokens',
                        r.outputTokens === null
                          ? '–'
                          : formatTokens((r.inputTokens ?? 0) + r.outputTokens),
                      ],
                      ['Total', ms(r.totalMs)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-fg-subtle">{label}</dt>
                      <dd className="font-mono tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                {friendly ? (
                  <div role="alert" className="text-xs">
                    <p className="font-medium text-danger">{friendly.title}</p>
                    <p className="text-fg-muted">{friendly.body}</p>
                  </div>
                ) : (
                  <p className="max-h-64 overflow-y-auto text-[13px] whitespace-pre-wrap break-words">
                    {r.text || (r.status === 'running' ? '' : 'No text came back.')}
                  </p>
                )}
                {(r.status === 'done' || r.status === 'stopped') && r.text && (
                  <Button size="sm" className="self-start" onClick={() => void saveRun(m, r)}>
                    <Save size={12} />
                    Save to conversation
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
