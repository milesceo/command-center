// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TOTALS, type StoredWindow, type UsageTotals } from '../../lib/repo-usage';
import { usageStore, type UsageData } from '../../stores/usage';
import { useUiStore } from '../../stores/ui';
import { ConversationUsage } from './ConversationUsage';
import { HeadroomCard } from './HeadroomCard';
import { StackedBars, type Column, type Series } from './StackedBars';
import { UsageView } from './UsageView';

afterEach(cleanup);

const NOW = Date.UTC(2026, 9, 14, 12);
const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  ...EMPTY_TOTALS,
  replies: 2,
  inputTokens: 1_200,
  outputTokens: 3_400,
  cacheReadTokens: 50_000,
  cacheCreationTokens: 800,
  costUsd: 0.1234,
  costComplete: true,
  ...over,
});
const win = (over: Partial<StoredWindow> = {}): StoredWindow => ({
  key: 'five_hour',
  label: '5-hour',
  utilization: 0.37,
  resetsAt: NOW + 2 * 3_600_000,
  observedAt: NOW,
  source: 'report',
  ...over,
});

const series: Series[] = [
  { key: 'a', label: 'Input', color: 'var(--series-1)' },
  { key: 'b', label: 'Output', color: 'var(--series-2)' },
];
const columns: Column[] = [
  { key: '1', label: '1', title: 'Mon 1 Oct', values: { a: 100, b: 50 } },
  { key: '2', label: '2', title: 'Tue 2 Oct', values: { a: 0, b: 0 } },
  { key: '3', label: '3', title: 'Wed 3 Oct', values: { a: 400, b: 200 } },
];
const fmt = (v: number) => `${v} tok`;

describe('StackedBars', () => {
  it('draws one thin stacked bar per column that has data, with a legend', () => {
    const { container } = render(
      <StackedBars title="Tokens per day" format={fmt} series={series} columns={columns} />,
    );
    expect(screen.getByRole('group', { name: 'Series' })).toBeTruthy();
    expect(container.querySelectorAll('path[data-series="a"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[data-series="b"]')).toHaveLength(2);
    // The tallest column carries its value as the only direct label.
    expect(screen.getAllByText('600 tok').length).toBeGreaterThanOrEqual(1);
  });

  it('has a table view with the exact figures', () => {
    render(<StackedBars title="Tokens per day" format={fmt} series={series} columns={columns} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(
      within(rows[3] as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Wed 3 Oct', '400 tok', '200 tok', '600 tok']);
  });

  it('hiding a series in the legend removes it from the bars and the tooltip', () => {
    const { container } = render(
      <StackedBars title="Tokens per day" format={fmt} series={series} columns={columns} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Output' }));
    expect(container.querySelectorAll('path[data-series="b"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Output' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('shows a tooltip with the hovered day and its values', () => {
    const { container } = render(
      <StackedBars title="Tokens per day" format={fmt} series={series} columns={columns} />,
    );
    const hit = container.querySelector('rect[fill="transparent"]') as SVGRectElement;
    hit.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 100 }) as DOMRect;
    fireEvent.mouseMove(hit, { clientX: 1 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Mon 1 Oct');
    expect(tip.textContent).toContain('100 tok');
    expect(tip.textContent).toContain('150 tok');
  });

  it('says so when there is nothing to draw', () => {
    render(
      <StackedBars
        title="Tokens per day"
        format={fmt}
        series={series}
        columns={[{ key: '1', label: '1', title: 'x', values: {} }]}
      />,
    );
    expect(screen.getByRole('img')).toBeTruthy();
  });
});

const reset = (over: Partial<ReturnType<typeof usageStore.getState>> = {}) =>
  usageStore.setState({
    data: null,
    report: { status: 'idle' },
    conversationTotals: {},
    load: vi.fn(() => Promise.resolve()),
    refreshReport: vi.fn(() => Promise.resolve()),
    ...over,
  });
const data = (over: Partial<UsageData> = {}): UsageData => ({
  totals: totals(),
  daily: [],
  weekly: [],
  models: [],
  top: [],
  windows: [],
  ...over,
});

describe('HeadroomCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows what is left in each window, as the SDK reported it', () => {
    reset({
      data: data({
        windows: [win(), win({ key: 'seven_day', label: 'Weekly', utilization: 0.9 })],
      }),
    });
    render(<HeadroomCard />);
    const five = document.querySelector('[data-window="five_hour"]') as HTMLElement;
    expect(five.textContent).toContain('63% left (37% used)');
    expect(five.textContent).toContain('resets');
    expect(within(five).getByRole('meter').getAttribute('aria-valuenow')).toBe('37');
    const weekly = document.querySelector('[data-window="seven_day"]') as HTMLElement;
    expect(weekly.textContent).toContain('10% left');
    expect(weekly.textContent).toContain('Almost used up');
  });

  it('flags a reading from before the last reset instead of extrapolating', () => {
    reset({ data: data({ windows: [win({ resetsAt: NOW - 1000 })] }) });
    render(<HeadroomCard />);
    expect(screen.getByText('reading is out of date')).toBeTruthy();
  });

  it('says plainly when the login has no plan windows', () => {
    reset({
      data: data(),
      report: {
        status: 'ready',
        available: false,
        subscriptionType: null,
        extraUsage: null,
        fetchedAt: NOW,
      },
    });
    render(<HeadroomCard />);
    expect(screen.getByTestId('headroom-empty').textContent).toMatch(
      /aren't available for this login/,
    );
  });

  it('says plainly when nothing has been reported yet, and Refresh asks the SDK', () => {
    const refreshReport = vi.fn(() => Promise.resolve());
    reset({ data: data(), refreshReport });
    render(<HeadroomCard />);
    expect(screen.getByTestId('headroom-empty').textContent).toMatch(/No plan usage reported yet/);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(refreshReport).toHaveBeenCalledOnce();
  });

  it('keeps the last readings visible when a refresh fails', () => {
    reset({
      data: data({ windows: [win()] }),
      report: { status: 'error', message: 'timed out' },
    });
    render(<HeadroomCard />);
    expect(screen.getByText(/Couldn't refresh: timed out/)).toBeTruthy();
    expect(document.querySelector('[data-window="five_hour"]')).toBeTruthy();
  });
});

describe('ConversationUsage', () => {
  it('shows nothing before the first reply', () => {
    reset();
    const { container } = render(<ConversationUsage conversationId="c" />);
    expect(container.textContent).toBe('');
  });

  it('shows running totals, labelled as API-equivalent and not a bill', () => {
    reset({ conversationTotals: { c: totals() } });
    render(<ConversationUsage conversationId="c" />);
    const button = screen.getByTestId('conversation-usage');
    expect(button.textContent).toContain('55.4k tokens');
    expect(button.textContent).toContain('API-equiv.');
    expect(button.getAttribute('title')).toContain('2 replies');
    expect(button.getAttribute('title')).toContain('API-equivalent cost');
    expect(button.getAttribute('title')).toContain('informational, not a bill');
  });

  it('opens the Usage view', () => {
    reset({ conversationTotals: { c: totals() } });
    useUiStore.getState().setView('chat');
    render(<ConversationUsage conversationId="c" />);
    fireEvent.click(screen.getByTestId('conversation-usage'));
    expect(useUiStore.getState().view).toBe('usage');
  });
});

describe('UsageView', () => {
  it('shows totals, both charts, models and top conversations, and switches metric and range', async () => {
    const load = vi.fn(() => Promise.resolve());
    reset({
      load,
      data: data({
        daily: [{ bucket: '2026-10-14', start: new Date(2026, 9, 14), ...totals() }],
        weekly: [{ bucket: '2026-10-12', start: new Date(2026, 9, 12), ...totals() }],
        models: [{ model: 'claude-sonnet-5-5', ...totals() }],
        top: [{ conversationId: 'c', title: 'Fix the bug', ...totals() }],
      }),
    });
    render(<UsageView />);
    expect(load).toHaveBeenCalled();
    const tiles = screen.getByTestId('usage-totals');
    expect(tiles.textContent).toContain('Replies2');
    expect(tiles.textContent).toContain('API-equivalent cost');
    expect(screen.getByRole('figure', { name: 'Tokens per day' })).toBeTruthy();
    expect(screen.getByRole('figure', { name: 'Tokens per week' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'By model' })).getByText('claude-sonnet-5-5'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Top conversations' })).getByText('Fix the bug'),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'API-equivalent cost' }));
    });
    expect(screen.getByRole('figure', { name: 'API-equivalent cost per day' })).toBeTruthy();
    expect(screen.getAllByText(/informational, not a bill/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    });
    expect(usageStore.getState().rangeDays).toBe(7);
  });

  it('explains an empty range', () => {
    reset({ data: data({ totals: totals({ replies: 0, costUsd: null }) }) });
    render(<UsageView />);
    expect(screen.getByText(/No usage recorded in this range yet/)).toBeTruthy();
  });
});
