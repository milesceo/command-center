import { describe, expect, it } from 'vitest';
import { STATUS_FEED_URL, feedProviderFor, parseStatusFeed, type StatusFeed } from './status-feed';

const provider = (over: Record<string, unknown> = {}) => ({
  id: 'anthropic',
  name: 'Claude',
  vendor: 'Anthropic',
  geeked_provider: 'claude',
  models: {
    state: 'ok',
    source: 'https://api.anthropic.com/v1/models',
    error: null,
    items: [
      {
        id: 'claude-opus-5',
        display_name: 'Claude Opus 5',
        created_at: '2026-09-01T00:00:00Z',
        first_seen: '2026-10-15',
      },
    ],
  },
  status: {
    state: 'ok',
    source: 'https://status.claude.com/api/v2/summary.json',
    page_url: 'https://status.claude.com',
    error: null,
    overall: 'degraded',
    summary: 'Minor Service Outage',
    incidents: [
      {
        id: 'i1',
        title: 'Elevated errors',
        status: 'investigating',
        impact: 'minor',
        url: 'https://stspg.io/abc',
        started_at: '2026-10-15T17:00:00Z',
        updated_at: '2026-10-15T17:30:00Z',
      },
    ],
    affected_components: [{ name: 'Claude Code', status: 'degraded_performance' }],
  },
  ...over,
});

const feed = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  checked_at: '2026-10-15T18:00:12Z',
  scheduled_for: '2026-10-15T18:00:00Z',
  run: {
    trigger: 'schedule',
    late: false,
    late_seconds: 12,
    missed_slots: [],
    missed_count: 0,
    collector_version: '1.0.0',
  },
  providers: { anthropic: provider() },
  changes: { any: false, summary: 'no changes', providers: {} },
  ...over,
});

describe('status feed', () => {
  it('points at the raw main branch of the status repository', () => {
    expect(STATUS_FEED_URL).toBe(
      'https://raw.githubusercontent.com/engineerlish/geeked-ai-status/main/latest.json',
    );
  });

  it('parses a snapshot and finds a provider by its Geeked id', () => {
    const result = parseStatusFeed(feed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claude = feedProviderFor(result.value, 'claude');
    expect(claude?.status.overall).toBe('degraded');
    expect(claude?.status.incidents[0]).toMatchObject({
      title: 'Elevated errors',
      impact: 'minor',
    });
    expect(claude?.models.items[0]?.id).toBe('claude-opus-5');
    expect(feedProviderFor(result.value, 'xai')).toBeNull();
  });

  it('refuses things that are not a feed, and newer versions', () => {
    expect(parseStatusFeed(null).ok).toBe(false);
    expect(parseStatusFeed([]).ok).toBe(false);
    expect(parseStatusFeed(feed({ schema_version: 2 }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unsupported feed version 2'),
    });
    expect(parseStatusFeed(feed({ checked_at: 'yesterday' })).ok).toBe(false);
    expect(parseStatusFeed(feed({ providers: {} })).ok).toBe(false);
  });

  it('drops a malformed provider but keeps the readable ones', () => {
    const result = parseStatusFeed(
      feed({
        providers: {
          anthropic: provider(),
          broken: provider({ status: { state: 'ok', overall: 'on_fire', incidents: [] } }),
          junk: 7,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value.providers)).toEqual(['anthropic']);
  });

  it('only keeps http(s) links and tolerates missing optional fields', () => {
    const risky = provider();
    risky.status.incidents[0]!.url = 'javascript:alert(1)';
    risky.status.page_url = 'file:///etc/passwd';
    const result = parseStatusFeed(feed({ providers: { anthropic: risky }, run: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value: StatusFeed = result.value;
    expect(value.providers.anthropic?.status.incidents[0]?.url).toBeNull();
    expect(value.providers.anthropic?.status.page_url).toBeNull();
    expect(value.run).toMatchObject({ trigger: 'local', late: false, missed_count: 0 });
  });

  it('keeps the stale marker on carried-over models', () => {
    const stale = provider();
    (stale.models.items[0] as Record<string, unknown>).stale = true;
    stale.models.state = 'error';
    const result = parseStatusFeed(feed({ providers: { anthropic: stale } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.providers.anthropic?.models.items[0]?.stale).toBe(true);
      expect(result.value.providers.anthropic?.models.state).toBe('error');
    }
  });
});
