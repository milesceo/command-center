// @vitest-environment jsdom
// The desktop path: the plan is registered with Rust (`preview_set`) and loaded from the
// `preview:` scheme, still in an `allow-scripts`-only sandbox.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  invoked: [] as { cmd: string; args: Record<string, unknown> }[],
}));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('../../lib/tauri', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    hoisted.invoked.push({ cmd, args });
    return Promise.resolve();
  },
  convertFileSrc: (id: string, scheme: string) => `${scheme}://localhost/${id}`,
}));

import { usePlans } from '../../stores/plans';
import { PlanReader } from './BusinessPlansView';

beforeEach(() => {
  hoisted.db = createTestDb();
  hoisted.invoked = [];
  usePlans.setState({ plans: [], loaded: false, error: null, selectedId: null });
});
afterEach(cleanup);

describe('PlanReader in the desktop app', () => {
  it('serves the plan from the preview scheme under one stable id, sandboxed', async () => {
    const plan = await usePlans
      .getState()
      .add({ title: 'Test plan', html: '<p>fixture body</p>', source: null });
    const { rerender } = render(<PlanReader plan={plan} />);
    const frame = await waitFor(() => {
      const f = document.querySelector('iframe');
      if (!f) throw new Error('no frame yet');
      return f;
    });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe(`preview://localhost/plan-${plan.id}`);
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(hoisted.invoked).toHaveLength(1);
    expect(hoisted.invoked[0]?.cmd).toBe('preview_set');
    expect(hoisted.invoked[0]?.args.id).toBe(`plan-${plan.id}`);
    expect(String(hoisted.invoked[0]?.args.html)).toContain('fixture body');

    // A rename (same id, new title) does not publish the document again.
    rerender(<PlanReader plan={{ ...plan, title: 'Renamed' }} />);
    await waitFor(() => expect(document.querySelector('iframe')?.title).toBe('Renamed'));
    expect(hoisted.invoked).toHaveLength(1);
  });
});
