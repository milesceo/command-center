// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opened: string[] = [];
vi.mock('../lib/external', () => ({
  openExternal: (url: string) => {
    opened.push(url);
    return Promise.resolve();
  },
}));
vi.mock('../lib/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../lib/data-location', () => ({
  appVersion: () => Promise.resolve('1.2.3'),
  getDataLocation: () => Promise.reject(new Error('n/a')),
  revealDataFile: () => Promise.resolve(),
}));

const { QA_ITEMS, QA_AREAS, SCENARIO_IDS, CHECKLIST_VERSION } = await import('./checklist');
const { currentResult, environmentText, issueUrl, resultsMarkdown, summarize } =
  await import('./report');
const { SCENARIOS } = await import('./scenarios');
const { QaPanel } = await import('./QaPanel');
const { useQa } = await import('../stores/qa');
const { useStatus } = await import('../stores/status');
const { usePrefs } = await import('../stores/prefs');
const { useUiStore } = await import('../stores/ui');
const { defaultPrefs } = await import('../lib/prefs');
const { copyText } = await import('../lib/clipboard');

const ENV = {
  appVersion: '1.2.3',
  bridge: '0.4.0 (protocol 4)',
  platform: 'Win32',
  tier: 'balanced',
  theme: 'dark',
  motion: 'system',
  desktop: true,
};

beforeEach(() => {
  localStorage.clear();
  opened.length = 0;
  useQa.setState({ enabled: true, open: true, results: {} });
  usePrefs.setState({ prefs: defaultPrefs() });
  useStatus.setState({ feed: null, notices: [], added: {} });
});
afterEach(cleanup);

describe('the checklist data', () => {
  it('has unique, well-formed ids that match their area', () => {
    const ids = QA_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of QA_ITEMS) {
      expect(item.id).toMatch(/^[A-Z]+-\d{2}$/);
      expect(QA_AREAS).toContain(item.area);
      expect(item.steps.length).toBeGreaterThan(0);
      expect(item.expected.length).toBeGreaterThan(10);
      expect(item.rev).toBeGreaterThanOrEqual(1);
      if (item.setup) expect(SCENARIO_IDS).toContain(item.setup);
    }
    expect(CHECKLIST_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('has a scenario for every id', () => {
    for (const id of SCENARIO_IDS) expect(SCENARIOS[id].label.length).toBeGreaterThan(0);
  });
});

describe('report helpers', () => {
  const item = QA_ITEMS.find((i) => i.id === 'LOCK-03')!;

  it('summarizes and ignores answers to an older version of a question', () => {
    const results = {
      'LOCK-03': { status: 'fail' as const, note: 'no shake', at: 1, rev: item.rev },
      'LOCK-01': { status: 'pass' as const, note: '', at: 1, rev: 99 },
    };
    const s = summarize(QA_ITEMS, results);
    expect(s.fail).toBe(1);
    expect(s.pass).toBe(0);
    expect(s.untested).toBe(QA_ITEMS.length - 1);
    expect(
      currentResult(
        QA_ITEMS.find((i) => i.id === 'LOCK-01')!,
        results,
      ),
    ).toBeNull();
  });

  it('builds a prefilled GitHub issue link for a failure', () => {
    const url = new URL(issueUrl(item, 'Circles did not clear', ENV));
    expect(url.origin + url.pathname).toBe('https://github.com/engineerlish/geeked/issues/new');
    expect(url.searchParams.get('template')).toBe('qa-failure.yml');
    expect(url.searchParams.get('title')).toBe(`QA LOCK-03: ${item.title}`);
    expect(url.searchParams.get('item')).toBe('LOCK-03');
    expect(url.searchParams.get('actual')).toBe('Circles did not clear');
    expect(url.searchParams.get('labels')).toContain('area:lock');
    expect(url.searchParams.get('build')).toContain('Geeked 1.2.3');
    expect(url.searchParams.get('expected')).toBe(item.expected);
  });

  it('writes a Markdown report grouped by area', () => {
    const md = resultsMarkdown(
      { 'LOCK-03': { status: 'fail', note: 'no\nshake', at: 1, rev: item.rev } },
      ENV,
    );
    expect(md).toContain('# Geeked manual test results');
    expect(md).toContain('## PIN and lock');
    expect(md).toContain('`FAIL` **LOCK-03**');
    expect(md).toContain('no shake');
    expect(md).toContain('`----` **LOCK-01**');
    expect(environmentText(ENV)).toContain('Tier: balanced');
  });
});

describe('scenarios', () => {
  it('restarts onboarding and switches tiers without touching anything destructive', () => {
    usePrefs.getState().completeOnboarding();
    SCENARIOS['restart-onboarding'].run();
    expect(usePrefs.getState().prefs.onboarding.completed).toBe(false);
    SCENARIOS['tier-lightest'].run();
    expect(usePrefs.getState().prefs.performance.tier).toBe('lightest');
  });

  it('simulates a new model and a degraded provider in memory only', () => {
    SCENARIOS['simulate-new-model'].run();
    expect(useStatus.getState().notices.map((n) => n.model.id)).toEqual(['claude-qa-preview-1']);
    expect(useStatus.getState().added.claude?.[0]?.id).toBe('claude-qa-preview-1');
    expect(localStorage.getItem('geeked-status-known-models')).toBeNull();

    SCENARIOS['simulate-claude-degraded'].run();
    const feed = useStatus.getState().feed;
    const claude = Object.values(feed?.providers ?? {}).find((p) => p.geeked_provider === 'claude');
    expect(claude?.status.overall).toBe('degraded');
    expect(localStorage.getItem('geeked-status-feed')).toBeNull();
  });

  it('opens Home and a Settings section', () => {
    useUiStore.setState({ view: 'chat' });
    SCENARIOS['go-home'].run();
    expect(useUiStore.getState().view).toBe('landing');
    SCENARIOS['open-settings-agents'].run();
    expect(useUiStore.getState().view).toBe('settings');
  });
});

describe('QaPanel', () => {
  it('renders nothing unless it is enabled and open', () => {
    useQa.setState({ enabled: false, open: true });
    const { container } = render(<QaPanel />);
    expect(container.textContent).toBe('');
    act(() => useQa.setState({ enabled: true, open: false }));
    expect(screen.queryByTestId('qa-panel')).toBeNull();
  });

  it('shows untested items first and records pass, fail and skip', () => {
    render(<QaPanel />);
    const summary = screen.getByTestId('qa-summary');
    expect(summary.textContent).toBe(`0/${QA_ITEMS.length} pass · 0 fail`);

    const row = screen.getByTestId('qa-item-SPLASH-01');
    fireEvent.click(within(row).getByRole('button', { name: /Splash appears at once/ }));
    expect(within(row).getByText(/Quit Geeked completely/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Pass' }));
    expect(useQa.getState().results['SPLASH-01']?.status).toBe('pass');
    expect(summary.textContent).toBe(`1/${QA_ITEMS.length} pass · 0 fail`);
    // The row stays until another item is touched, then answered items leave "not tested".
    expect(screen.getByTestId('qa-item-SPLASH-01')).toBeTruthy();
    const other = screen.getByTestId('qa-item-SPLASH-02');
    fireEvent.click(within(other).getByRole('button', { name: /Logo frame rate/ }));
    fireEvent.click(within(other).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('qa-item-SPLASH-01')).toBeNull();
  });

  it('runs a setup scenario and reports a failure to GitHub with the note', () => {
    render(<QaPanel />);
    const row = screen.getByTestId('qa-item-STATUS-03');
    fireEvent.click(within(row).getByRole('button', { name: /A new-model notice appears/ }));
    fireEvent.click(
      within(row).getByRole('button', { name: /Set up: Simulate a new Claude model/ }),
    );
    expect(useStatus.getState().notices).toHaveLength(1);
    expect(within(row).getByText(/A notice appeared/)).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Fail' }));
    fireEvent.change(within(row).getByLabelText(/What did you see/), {
      target: { value: 'No notice appeared' },
    });
    fireEvent.click(within(row).getByRole('button', { name: /Report on GitHub/ }));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.searchParams.get('item')).toBe('STATUS-03');
    expect(url.searchParams.get('actual')).toBe('No notice appeared');
    expect(useQa.getState().results['STATUS-03']).toMatchObject({
      status: 'fail',
      note: 'No notice appeared',
    });
  });

  it('copies a Markdown report and persists answers across a reload', async () => {
    render(<QaPanel />);
    const row = screen.getByTestId('qa-item-HOME-01');
    fireEvent.click(within(row).getByRole('button', { name: /Home has a still logo/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Skip' }));

    fireEvent.click(screen.getByRole('button', { name: /Copy results/ }));
    await act(async () => undefined);
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('`SKIP` **HOME-01**'));

    const saved = JSON.parse(localStorage.getItem('geeked-qa') ?? '{}');
    expect(saved.results['HOME-01'].status).toBe('skip');
  });

  it('filters to failures', () => {
    useQa.getState().answer(QA_ITEMS[0]!, 'fail', 'x');
    render(<QaPanel />);
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'fail' } });
    expect(screen.getByTestId(`qa-item-${QA_ITEMS[0]!.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`qa-item-${QA_ITEMS[1]!.id}`)).toBeNull();
  });
});
