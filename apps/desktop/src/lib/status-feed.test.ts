// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { StatusFeed } from '@command-center/protocol';
import {
  STATUS_DOT,
  ago,
  detectNewModels,
  emptyKnown,
  fetchFeed,
  isChatModelId,
  loadCachedFeed,
  mergeModels,
  saveCachedFeed,
  statusFor,
} from './status-feed';

const model = (id: string, name = id) => ({
  id,
  display_name: name,
  created_at: null,
  first_seen: '2026-10-15',
});

const entry = (appId: string, ids: string[], overall = 'operational', state = 'ok') => ({
  id: appId,
  name: appId,
  vendor: appId,
  geeked_provider: appId,
  models: { state, source: '', error: null, items: ids.map((id) => model(id)) },
  status: {
    state: 'ok',
    source: '',
    page_url: null,
    error: null,
    overall,
    summary: '',
    incidents: [],
    affected_components: [],
  },
});

const feed = (providers: Record<string, ReturnType<typeof entry>>): StatusFeed =>
  ({
    schema_version: 1,
    checked_at: '2026-10-15T18:00:00Z',
    scheduled_for: '2026-10-15T18:00:00Z',
    run: { trigger: 'schedule', late: false, late_seconds: 0, missed_count: 0, missed_slots: [] },
    providers,
  }) as unknown as StatusFeed;

const ALL = new Set(['claude', 'openai', 'xai'] as const);

beforeEach(() => localStorage.clear());

describe('detectNewModels', () => {
  it('records a silent baseline the first time a provider is seen', () => {
    const result = detectNewModels(feed({ a: entry('claude', ['c1', 'c2']) }), emptyKnown(), ALL);
    expect(result.announced).toEqual([]);
    expect(result.known.seen.claude).toEqual(['c1', 'c2']);
    expect(result.changed).toBe(true);
  });

  it('announces a model that appears for a connected provider and adds it to the picker', () => {
    const baseline = detectNewModels(feed({ a: entry('claude', ['c1']) }), emptyKnown(), ALL).known;
    const next = detectNewModels(feed({ a: entry('claude', ['c1', 'c2']) }), baseline, ALL);
    expect(next.announced.map((n) => n.model.id)).toEqual(['c2']);
    expect(next.known.added.claude?.map((m) => m.id)).toEqual(['c2']);
    // The same feed again is quiet.
    const again = detectNewModels(feed({ a: entry('claude', ['c1', 'c2']) }), next.known, ALL);
    expect(again.announced).toEqual([]);
    expect(again.changed).toBe(false);
  });

  it('only advances the baseline for a provider that is not connected', () => {
    const baseline = detectNewModels(feed({ x: entry('xai', ['g1']) }), emptyKnown(), ALL).known;
    const next = detectNewModels(
      feed({ x: entry('xai', ['g1', 'g2']) }),
      baseline,
      new Set(['claude'] as const),
    );
    expect(next.announced).toEqual([]);
    expect(next.known.added.xai).toBeUndefined();
    expect(next.known.seen.xai).toEqual(['g1', 'g2']);
  });

  it('does not announce embeddings, speech or image models', () => {
    const baseline = detectNewModels(
      feed({ o: entry('openai', ['gpt-5']) }),
      emptyKnown(),
      ALL,
    ).known;
    const next = detectNewModels(
      feed({ o: entry('openai', ['gpt-5', 'text-embedding-4', 'whisper-2', 'gpt-5.1']) }),
      baseline,
      ALL,
    );
    expect(next.announced.map((n) => n.model.id)).toEqual(['gpt-5.1']);
    expect(isChatModelId('gpt-image-2')).toBe(false);
    expect(isChatModelId('claude-sonnet-6')).toBe(true);
  });

  it('ignores a models list that failed (carried-over stale data)', () => {
    const baseline = detectNewModels(feed({ a: entry('claude', ['c1']) }), emptyKnown(), ALL).known;
    const next = detectNewModels(
      feed({ a: entry('claude', [], 'operational', 'error') }),
      baseline,
      ALL,
    );
    expect(next.announced).toEqual([]);
    expect(next.known.seen.claude).toEqual(['c1']);
  });

  it('does not re-announce a dismissed model if the baseline is rebuilt', () => {
    const known = { ...emptyKnown(), seen: { claude: ['c1'] }, dismissed: ['claude:c2'] };
    const next = detectNewModels(feed({ a: entry('claude', ['c1', 'c2']) }), known, ALL);
    expect(next.announced).toEqual([]);
    expect(next.known.added.claude?.map((m) => m.id)).toEqual(['c2']);
  });
});

describe('helpers', () => {
  it('merges announced models into the picker without duplicates', () => {
    const merged = mergeModels(
      [
        { id: 'default', label: 'Default' },
        { id: 'opus', label: 'Opus' },
      ],
      [model('opus'), model('claude-sonnet-6', 'Claude Sonnet 6')],
    );
    expect(merged.map((m) => m.id)).toEqual(['default', 'opus', 'claude-sonnet-6']);
    expect(merged.at(-1)?.label).toBe('Claude Sonnet 6');
    expect(mergeModels([{ id: 'a', label: 'A' }], undefined)).toEqual([{ id: 'a', label: 'A' }]);
  });

  it('reads one provider status, and unknown when there is no feed or entry', () => {
    const f = feed({ a: entry('claude', ['c1'], 'degraded') });
    expect(statusFor(f, 'claude')).toBe('degraded');
    expect(statusFor(f, 'xai')).toBe('unknown');
    expect(statusFor(null, 'claude')).toBe('unknown');
    expect(STATUS_DOT.major_outage.className).toBe('bg-danger');
  });

  it('describes ages', () => {
    const now = 10_000_000_000;
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});

describe('cache and fetch', () => {
  const body = {
    schema_version: 1,
    checked_at: '2026-10-15T18:00:00Z',
    scheduled_for: '2026-10-15T18:00:00Z',
    run: { trigger: 'schedule', late: false, late_seconds: 0, missed_slots: [], missed_count: 0 },
    providers: { a: entry('claude', ['c1']) },
  };

  it('round-trips the last good copy and ignores a damaged one', () => {
    expect(loadCachedFeed()).toBeNull();
    const parsed = feed({ a: entry('claude', ['c1']) });
    saveCachedFeed({ fetchedAt: 1234, feed: parsed });
    expect(loadCachedFeed()).toMatchObject({ fetchedAt: 1234 });
    localStorage.setItem('command-center-status-feed', '{not json');
    expect(loadCachedFeed()).toBeNull();
    localStorage.setItem(
      'command-center-status-feed',
      JSON.stringify({ fetchedAt: 1, feed: { schema_version: 9 } }),
    );
    expect(loadCachedFeed()).toBeNull();
  });

  it('fetches, validates, and explains failures', async () => {
    const ok = await fetchFeed(() => Promise.resolve(new Response(JSON.stringify(body))));
    expect(ok.ok).toBe(true);

    const http = await fetchFeed(() => Promise.resolve(new Response('no', { status: 503 })));
    expect(http).toEqual({ ok: false, error: 'The status feed returned HTTP 503.' });

    const newer = await fetchFeed(() =>
      Promise.resolve(new Response(JSON.stringify({ ...body, schema_version: 2 }))),
    );
    expect(newer.ok).toBe(false);

    const offline = await fetchFeed(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(offline).toMatchObject({ ok: false });
    expect(offline.ok === false && offline.error).toContain('Could not reach the status feed');
  });
});
