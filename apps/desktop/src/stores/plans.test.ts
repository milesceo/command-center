import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../lib/db';
import { createTestDb } from '../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

import * as repo from '../lib/repo-plans';
import { usePlans } from './plans';

// Harmless fixture documents only: the repository is public.
const DOC = '<!doctype html><title>Test plan</title><p>fixture</p>';

const add = async (...titles: string[]) => {
  for (const title of titles) await usePlans.getState().add({ title, html: DOC, source: null });
  return usePlans.getState().plans;
};
const titles = () => usePlans.getState().plans.map((p) => p.title);
const selectedTitle = () => {
  const { plans, selectedId } = usePlans.getState();
  return plans.find((p) => p.id === selectedId)?.title ?? null;
};

beforeEach(() => {
  hoisted.db = createTestDb();
  usePlans.setState({ plans: [], loaded: false, error: null, selectedId: null });
});

describe('plans store', () => {
  it('load on an empty database selects nothing', async () => {
    await usePlans.getState().load();
    expect(usePlans.getState()).toMatchObject({
      plans: [],
      loaded: true,
      error: null,
      selectedId: null,
    });
  });

  it('add selects the new plan and appends it to the list', async () => {
    await add('A', 'B');
    expect(titles()).toEqual(['A', 'B']);
    expect(selectedTitle()).toBe('B');
  });

  it('load keeps a selection that still exists', async () => {
    const [, b] = await add('A', 'B', 'C');
    usePlans.getState().select(b!.id);
    await usePlans.getState().load();
    expect(selectedTitle()).toBe('B');
  });

  it('load falls back to the first plan when the selection is gone or unknown', async () => {
    const [, b] = await add('A', 'B');
    usePlans.setState({ selectedId: 'no-such-plan' });
    await usePlans.getState().load();
    expect(selectedTitle()).toBe('A');

    // Deleted behind the store's back (another window, a data wipe).
    usePlans.getState().select(b!.id);
    await repo.deletePlan(hoisted.db, b!.id);
    await usePlans.getState().load();
    expect(selectedTitle()).toBe('A');
  });

  it('load records a database error, and a later load clears it', async () => {
    const select = hoisted.db.select.bind(hoisted.db);
    hoisted.db.select = vi.fn().mockRejectedValueOnce(new Error('disk I/O error'));
    await usePlans.getState().load();
    expect(usePlans.getState()).toMatchObject({ loaded: true, error: 'disk I/O error' });

    hoisted.db.select = select;
    await usePlans.getState().load();
    expect(usePlans.getState().error).toBeNull();
  });

  it('removing the open last plan selects the previous one', async () => {
    const [, , c] = await add('A', 'B', 'C');
    usePlans.getState().select(c!.id);
    await usePlans.getState().remove(c!.id);
    expect(titles()).toEqual(['A', 'B']);
    expect(selectedTitle()).toBe('B');
  });

  it('removing a plan that is not open keeps the open one', async () => {
    const [a, b] = await add('A', 'B', 'C');
    usePlans.getState().select(b!.id);
    await usePlans.getState().remove(a!.id);
    expect(titles()).toEqual(['B', 'C']);
    expect(selectedTitle()).toBe('B');
  });

  it('removing the only plan leaves nothing selected', async () => {
    const [a] = await add('A');
    await usePlans.getState().remove(a!.id);
    expect(usePlans.getState().plans).toEqual([]);
    expect(usePlans.getState().selectedId).toBeNull();
  });

  it('moveFirst can be repeated and keeps the rest in order', async () => {
    const [a, b, c] = await add('A', 'B', 'C');
    await usePlans.getState().moveFirst(c!.id);
    expect(titles()).toEqual(['C', 'A', 'B']);
    await usePlans.getState().moveFirst(b!.id);
    expect(titles()).toEqual(['B', 'C', 'A']);
    await usePlans.getState().moveFirst(a!.id);
    expect(titles()).toEqual(['A', 'B', 'C']);
    // Moving the plan that is already first changes nothing visible.
    await usePlans.getState().moveFirst(a!.id);
    expect(titles()).toEqual(['A', 'B', 'C']);
    // A plan added after the moves still goes to the end.
    await add('D');
    expect(titles()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('rename refuses an empty name and leaves the title alone', async () => {
    const [a] = await add('A');
    await expect(usePlans.getState().rename(a!.id, '   ')).rejects.toThrow(repo.PlanError);
    await expect(usePlans.getState().rename(a!.id, 'x'.repeat(121))).rejects.toThrow(
      repo.PlanError,
    );
    expect(titles()).toEqual(['A']);
    await usePlans.getState().rename(a!.id, '  New   name ');
    expect(titles()).toEqual(['New name']);
  });
});
