// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
vi.mock('../../lib/external', () => ({
  openExternal: (url: string) => {
    opened.push(url);
    return Promise.resolve();
  },
}));

const { StatusDot } = await import('./StatusDot');
const { ModelNotices } = await import('./ModelNotices');
const { StatusFeedRow } = await import('./StatusFeedRow');
const { useStatus } = await import('../../stores/status');
const { usePrefs } = await import('../../stores/prefs');
const { defaultPrefs } = await import('../../lib/prefs');
const { saveCachedFeed } = await import('../../lib/status-feed');
const { ProviderModelPicker } = await import('../chat/ProviderModelPicker');

const claudeEntry = (overrides: Record<string, unknown> = {}, ids = ['claude-opus-5']) => ({
  id: 'anthropic',
  name: 'Claude',
  vendor: 'Anthropic',
  geeked_provider: 'claude',
  models: {
    state: 'ok',
    source: '',
    error: null,
    items: ids.map((id) => ({ id, display_name: id, created_at: null, first_seen: '2026-10-15' })),
  },
  status: {
    state: 'ok',
    source: '',
    page_url: 'https://status.claude.com',
    error: null,
    overall: 'degraded',
    summary: 'Minor Service Outage',
    incidents: [
      {
        id: 'i1',
        title: 'Elevated errors on Claude Code',
        status: 'investigating',
        impact: 'minor',
        url: 'https://stspg.io/abc',
        started_at: null,
        updated_at: null,
      },
    ],
    affected_components: [{ name: 'Claude Code', status: 'degraded_performance' }],
    ...overrides,
  },
});

const body = (ids?: string[], status: Record<string, unknown> = {}) => ({
  schema_version: 1,
  checked_at: '2026-10-15T18:00:00Z',
  scheduled_for: '2026-10-15T18:00:00Z',
  run: { trigger: 'schedule', late: false, late_seconds: 0, missed_slots: [], missed_count: 0 },
  providers: { anthropic: claudeEntry(status, ids) },
});

const respond = (value: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(value), { status })));

beforeEach(() => {
  localStorage.clear();
  opened.length = 0;
  useStatus.getState().stop();
  useStatus.setState({
    feed: null,
    fetchedAt: null,
    source: 'none',
    error: null,
    refreshing: false,
    notices: [],
    added: {},
  });
  usePrefs.setState({ prefs: defaultPrefs() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('status store', () => {
  it('fetches, validates and caches the feed', async () => {
    vi.stubGlobal('fetch', respond(body()));
    await useStatus.getState().refresh();
    const state = useStatus.getState();
    expect(state.source).toBe('network');
    expect(state.feed?.providers.anthropic?.status.overall).toBe('degraded');
    expect(localStorage.getItem('geeked-status-feed')).toContain('"schema_version":1');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/engineerlish/geeked-ai-status/main/latest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('works offline from the cache and says it is the cached copy', async () => {
    vi.stubGlobal('fetch', respond(body()));
    await useStatus.getState().refresh();
    useStatus.setState({ feed: null, fetchedAt: null, source: 'none' });

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    useStatus.getState().start();
    expect(useStatus.getState().source).toBe('cache');
    expect(useStatus.getState().feed).not.toBeNull();
    await waitFor(() => expect(useStatus.getState().error).toContain('Could not reach'));
    // The cached copy stays in use after the failed refresh.
    expect(useStatus.getState().feed?.providers.anthropic).toBeTruthy();
    expect(useStatus.getState().source).toBe('cache');
    useStatus.getState().stop();
  });

  it('keeps the last good copy when the feed turns out to be invalid', async () => {
    vi.stubGlobal('fetch', respond(body()));
    await useStatus.getState().refresh();
    vi.stubGlobal('fetch', respond({ ...body(), schema_version: 2 }));
    await useStatus.getState().refresh();
    expect(useStatus.getState().error).toContain('Unsupported feed version 2');
    expect(useStatus.getState().feed?.schema_version).toBe(1);
  });

  it('announces a new model once for a connected provider, then lets it be dismissed', async () => {
    vi.stubGlobal('fetch', respond(body(['claude-opus-5'])));
    await useStatus.getState().refresh(); // baseline, silent
    expect(useStatus.getState().notices).toEqual([]);

    vi.stubGlobal('fetch', respond(body(['claude-opus-5', 'claude-sonnet-6'])));
    await useStatus.getState().refresh();
    expect(useStatus.getState().notices.map((n) => n.model.id)).toEqual(['claude-sonnet-6']);
    expect(useStatus.getState().added.claude?.map((m) => m.id)).toEqual(['claude-sonnet-6']);

    // The same feed again does not repeat the notice.
    await useStatus.getState().refresh();
    expect(useStatus.getState().notices).toHaveLength(1);

    useStatus.getState().dismiss('claude', 'claude-sonnet-6');
    expect(useStatus.getState().notices).toEqual([]);
    // ...and the model stays in the picker.
    expect(useStatus.getState().added.claude).toHaveLength(1);
  });

  it('does not announce models for a provider the user switched off', async () => {
    usePrefs.getState().setConnection('claude', { enabled: false });
    vi.stubGlobal('fetch', respond(body(['claude-opus-5'])));
    await useStatus.getState().refresh();
    vi.stubGlobal('fetch', respond(body(['claude-opus-5', 'claude-sonnet-6'])));
    await useStatus.getState().refresh();
    expect(useStatus.getState().notices).toEqual([]);
  });
});

describe('StatusDot', () => {
  const withFeed = async () => {
    vi.stubGlobal('fetch', respond(body()));
    await act(async () => void (await useStatus.getState().refresh()));
  };

  it('is grey with no feed, then shows the provider state with details on click', async () => {
    render(<StatusDot provider="claude" />);
    expect(screen.getByTestId('status-dot-claude').getAttribute('data-status')).toBe('unknown');

    await withFeed();
    const dot = screen.getByTestId('status-dot-claude');
    expect(dot.getAttribute('data-status')).toBe('degraded');
    expect(dot.getAttribute('aria-label')).toBe('Claude status: Degraded');
    expect(dot.getAttribute('title')).toContain('Minor Service Outage');

    fireEvent.click(dot);
    const dialog = screen.getByRole('dialog', { name: /Claude status details/ });
    expect(dialog.textContent).toContain('Elevated errors on Claude Code');
    expect(dialog.textContent).toContain('Affected: Claude Code');

    fireEvent.click(screen.getByRole('button', { name: /Incident details/ }));
    fireEvent.click(screen.getByRole('button', { name: /View status history/ }));
    expect(opened).toEqual([
      'https://stspg.io/abc',
      'https://github.com/engineerlish/geeked-ai-status',
    ]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tells the user when it is showing a cached copy while offline', async () => {
    const parsed = (await import('@geeked/protocol')).parseStatusFeed(body());
    if (!parsed.ok) throw new Error('fixture invalid');
    saveCachedFeed({ fetchedAt: Date.now() - 2 * 3_600_000, feed: parsed.value });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    useStatus.getState().start();
    await waitFor(() => expect(useStatus.getState().error).toBeTruthy());
    useStatus.getState().stop();

    render(<StatusDot provider="claude" />);
    fireEvent.click(screen.getByTestId('status-dot-claude'));
    expect(screen.getByRole('dialog').textContent).toContain(
      'Offline: showing the copy from 2 h ago',
    );
  });
});

describe('notices and settings row', () => {
  it('renders a dismissible notice naming the model', () => {
    useStatus.setState({
      notices: [
        {
          provider: 'claude',
          model: {
            id: 'claude-sonnet-6',
            display_name: 'Claude Sonnet 6',
            created_at: null,
            first_seen: '2026-10-15',
          },
        },
      ],
    });
    render(<ModelNotices />);
    expect(screen.getByText('New Claude model')).toBeTruthy();
    expect(screen.getByText('Claude Sonnet 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss the Claude Sonnet 6 notice/ }));
    expect(useStatus.getState().notices).toEqual([]);
  });

  it('links to the status history from Settings', () => {
    render(<StatusFeedRow />);
    expect(screen.getByText(/Waiting for the first status check/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /View status history/ }));
    expect(opened).toEqual(['https://github.com/engineerlish/geeked-ai-status']);
  });
});

describe('model picker', () => {
  it('offers announced models and shows the provider status dot', () => {
    useStatus.setState({
      added: {
        claude: [
          {
            id: 'claude-sonnet-6',
            display_name: 'Claude Sonnet 6',
            created_at: null,
            first_seen: '2026-10-15',
          },
        ],
      },
    });
    render(<ProviderModelPicker />);
    expect(screen.getByTestId('status-dot-claude')).toBeTruthy();
    const options = [...screen.getByLabelText('Model').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    expect(options).toContain('Claude Sonnet 6');
    expect(options).toContain('Opus');
  });
});
