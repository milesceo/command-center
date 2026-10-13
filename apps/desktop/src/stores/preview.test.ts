import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_LOGS, MAX_TABS, createPreviewStore } from './preview';

let store: ReturnType<typeof createPreviewStore>;
beforeEach(() => {
  store = createPreviewStore();
});
const s = () => store.getState();
const html = (source: string, sourceKey: string | null = null) =>
  s().open({ kind: 'html', title: 'page', source, sourceKey });

describe('preview store tabs', () => {
  it('opens and activates tabs, closing picks a neighbor', () => {
    const a = html('a');
    const b = html('b');
    const c = html('c');
    expect(s().activeId).toBe(c);
    s().close(c);
    expect(s().activeId).toBe(b);
    s().activate(a);
    s().close(a);
    expect(s().activeId).toBe(b);
    s().close(b);
    expect(s().activeId).toBeNull();
  });

  it('reuses the tab that follows the same code block', () => {
    const first = html('v1', 'm1:0:3');
    s().open({ kind: 'html', title: 'page', source: 'v2', sourceKey: 'm1:0:3' });
    expect(s().tabs).toHaveLength(1);
    expect(s().tabs[0]).toMatchObject({ id: first, source: 'v2', version: 2 });
  });

  it('keeps at most MAX_TABS, dropping the oldest', () => {
    for (let i = 0; i < MAX_TABS + 3; i++) html(`p${i}`);
    expect(s().tabs).toHaveLength(MAX_TABS);
    expect(s().tabs[0]?.source).toBe('p3');
  });

  it('opens diffs as tabs', () => {
    const id = s().openDiff({ title: 'diff', diff: { type: 'patch', patch: '@@' } });
    expect(s().tabs.find((t) => t.id === id)).toMatchObject({
      kind: 'diff',
      diff: { type: 'patch' },
    });
  });
});

describe('preview store updates and logs', () => {
  it('a changed source starts a fresh run and clears logs; an identical one does nothing', () => {
    const id = html('a');
    s().addLog(id, { level: 'log', text: 'x', at: 1 });
    s().updateSource(id, 'a');
    expect(s().tabs[0]).toMatchObject({ version: 1 });
    expect(s().tabs[0]?.logs).toHaveLength(1);
    s().updateSource(id, 'b');
    expect(s().tabs[0]).toMatchObject({ source: 'b', version: 2, logs: [] });
  });

  it('refresh bumps the version and clears logs', () => {
    const id = html('a');
    s().addLog(id, { level: 'error', text: 'x', at: 1 });
    s().refresh(id);
    expect(s().tabs[0]).toMatchObject({ version: 2, logs: [] });
  });

  it('caps the log length', () => {
    const id = html('a');
    for (let i = 0; i < MAX_LOGS + 10; i++)
      s().addLog(id, { level: 'log', text: String(i), at: i });
    expect(s().tabs[0]?.logs).toHaveLength(MAX_LOGS);
    expect(s().tabs[0]?.logs[0]?.text).toBe('10');
  });

  it('tracks viewport, console and a pending comparison', () => {
    s().setViewport('mobile');
    s().setConsoleOpen(true);
    s().startCompare({ key: 'k', title: 't', code: 'c' });
    expect(s()).toMatchObject({ viewport: 'mobile', consoleOpen: true, compare: { key: 'k' } });
    s().cancelCompare();
    expect(s().compare).toBeNull();
  });
});
