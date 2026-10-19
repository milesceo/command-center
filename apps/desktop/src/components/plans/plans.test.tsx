// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

import { usePlans } from '../../stores/plans';
import { useToastStore } from '../../stores/toast';
import { BusinessPlansView } from './BusinessPlansView';

const PLAN =
  '<!doctype html><html><head><title>Short-Let Launch Plan</title></head><body><h1>Plan</h1><script>document.title="x"</script></body></html>';

/** The reader's iframe for a plan (the toolbar also carries the title as a tooltip). */
const planFrame = (title: string) =>
  waitFor(() => {
    const frame = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);
    if (!frame) throw new Error(`no frame for ${title}`);
    return frame;
  });

const upload = (html: string, name = 'plan.html') => {
  const input = screen.getByTestId('plan-file-input');
  fireEvent.change(input, { target: { files: [new File([html], name, { type: 'text/html' })] } });
};

beforeEach(() => {
  hoisted.db = createTestDb();
  usePlans.setState({ plans: [], loaded: false, error: null, selectedId: null });
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe('Business plans', () => {
  it('starts empty, adds a plan from an HTML file and opens it in the sandbox', async () => {
    render(<BusinessPlansView />);
    expect(await screen.findByText('No plans yet')).toBeTruthy();
    upload(PLAN);

    const nav = await screen.findByRole('navigation', { name: 'Plans' });
    expect(within(nav).getByRole('button', { name: 'Short-Let Launch Plan' })).toBeTruthy();
    const frame = await planFrame('Short-Let Launch Plan');
    // Scripts run, but nothing else: no same-origin access to the app.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Plan</h1>');
  });

  it('opens the first plan by default and keeps reading order', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    await usePlans.getState().add({ title: 'Second', html: '<p>two</p>', source: null });
    usePlans.setState({ selectedId: null, loaded: false });
    render(<BusinessPlansView />);
    const nav = await screen.findByRole('navigation', { name: 'Plans' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['First', 'Second']);
    expect(within(nav).getByRole('button', { name: 'First' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await planFrame('First')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'Second' }));
    expect((await planFrame('Second')).getAttribute('srcdoc')).toContain('two');
  });

  it('names a plan without a <title> after its file, and refuses an empty file', async () => {
    render(<BusinessPlansView />);
    await screen.findByText('No plans yet');
    upload('   ', 'empty.html');
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'That file is empty.',
      ),
    );
    upload('<p>hello</p>', 'my_launch-plan.html');
    expect(await screen.findByRole('button', { name: 'my launch plan' })).toBeTruthy();
  });

  it('renames, moves to the top and removes after confirming', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    await usePlans.getState().add({ title: 'Second', html: PLAN, source: null });
    render(<BusinessPlansView />);
    const nav = await screen.findByRole('navigation', { name: 'Plans' });

    fireEvent.click(within(nav).getByRole('button', { name: 'Second' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move Second to the top' }));
    await waitFor(() =>
      expect(usePlans.getState().plans.map((p) => p.title)).toEqual(['Second', 'First']),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Second' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Launch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(usePlans.getState().plans[0]?.title).toBe('Launch'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Launch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(usePlans.getState().plans.map((p) => p.title)).toEqual(['First']));
  });

  it('keeps the open page when a plan is renamed, and refuses files over 5 MB unread', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    render(<BusinessPlansView />);
    const before = await planFrame('First');
    await usePlans.getState().rename(usePlans.getState().plans[0]!.id, 'Renamed');
    const after = await planFrame('Renamed');
    // Same iframe element: the page was not rebuilt.
    expect(after).toBe(before);

    const big = new File(['x'], 'big.html', { type: 'text/html' });
    Object.defineProperty(big, 'size', { value: 6_000_000 });
    const text = vi.spyOn(big, 'text');
    fireEvent.change(screen.getByTestId('plan-file-input'), { target: { files: [big] } });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'That plan is larger than 5 MB.',
      ),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('opens the next plan after removing the open one', async () => {
    for (const title of ['A', 'B', 'C']) {
      await usePlans.getState().add({ title, html: PLAN, source: null });
    }
    const [, b] = usePlans.getState().plans;
    usePlans.getState().select(b!.id);
    await usePlans.getState().remove(b!.id);
    const { plans, selectedId } = usePlans.getState();
    expect(plans.find((p) => p.id === selectedId)?.title).toBe('C');
  });

  it('keeps the reader iframe sandboxed to allow-scripts only, with no referrer', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    render(<BusinessPlansView />);
    const frame = await planFrame('First');
    // Exactly this token: never allow-same-origin, allow-popups, allow-forms, allow-modals...
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows Retry when a plan cannot be opened, and Retry recovers', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    const select = hoisted.db.select.bind(hoisted.db);
    let failed = false;
    hoisted.db.select = ((sql: string, params?: unknown[]) => {
      // Fail only the reader's first document read; the list keeps working.
      if (!failed && sql.includes('SELECT * FROM business_plans WHERE id')) {
        failed = true;
        return Promise.reject(new Error('database is locked'));
      }
      return select(sql, params);
    }) as Db['select'];

    render(<BusinessPlansView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not open this plan: database is locked');
    expect(document.querySelector('iframe')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect((await planFrame('First')).getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the open plan was removed elsewhere', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    // Deleted straight from the database; the store still lists it.
    await hoisted.db.execute('DELETE FROM business_plans');
    render(<BusinessPlansView />);
    expect((await screen.findByRole('alert')).textContent).toContain('This plan was removed.');
  });

  it('shows Retry when the list cannot be read, and Retry recovers', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    usePlans.setState({ loaded: false });
    const select = hoisted.db.select.bind(hoisted.db);
    hoisted.db.select = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk I/O error'))
      .mockImplementation(select);

    render(<BusinessPlansView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not read your plans: disk I/O error');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('navigation', { name: 'Plans' })).toBeTruthy();
    expect(await planFrame('First')).toBeTruthy();
  });

  it('never shows the previous plan when its document arrives late', async () => {
    await usePlans.getState().add({ title: 'Slow', html: '<p>slow body</p>', source: null });
    await usePlans.getState().add({ title: 'Fast', html: '<p>fast body</p>', source: null });
    const [slow] = usePlans.getState().plans;
    usePlans.getState().select(slow!.id);
    const select = hoisted.db.select.bind(hoisted.db);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    hoisted.db.select = (async (sql: string, params?: unknown[]) => {
      if (sql.includes('WHERE id') && params?.[0] === slow!.id) await gate;
      return select(sql, params);
    }) as Db['select'];

    render(<BusinessPlansView />);
    const nav = await screen.findByRole('navigation', { name: 'Plans' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Fast' }));
    const fast = await planFrame('Fast');
    expect(fast.getAttribute('srcdoc')).toContain('fast body');
    release();
    await new Promise((r) => setTimeout(r, 20));
    const frames = document.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('srcdoc')).toContain('fast body');
    expect(frames[0]?.getAttribute('srcdoc')).not.toContain('slow body');
  });

  it('refuses an empty name when renaming and keeps the dialog open', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    render(<BusinessPlansView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename First' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/name of 1 to 120/);
    expect(screen.getByRole('dialog', { name: 'Rename plan' })).toBeTruthy();
    expect(usePlans.getState().plans[0]?.title).toBe('First');
  });

  it('cancelling the remove confirmation keeps the plan', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    render(<BusinessPlansView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove First' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('The original file or artifact is not touched.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(usePlans.getState().plans.map((p) => p.title)).toEqual(['First']);
  });

  it('hides Move to the top on the first plan', async () => {
    await usePlans.getState().add({ title: 'First', html: PLAN, source: null });
    await usePlans.getState().add({ title: 'Second', html: PLAN, source: null });
    usePlans.getState().select(usePlans.getState().plans[0]!.id);
    render(<BusinessPlansView />);
    await screen.findByRole('button', { name: 'Rename First' });
    expect(screen.queryByRole('button', { name: /to the top/ })).toBeNull();
  });
});
