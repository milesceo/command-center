import { beforeEach, describe, expect, it } from 'vitest';
import { clearData, exportAll } from './data';
import type { Db } from './db';
import * as plans from './repo-plans';
import { createTestDb } from './sqlite-test-db';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

const doc = '<!doctype html><title>Short-Let &amp; Launch Plan</title><h1>Hi</h1>';

describe('business plans', () => {
  it('adds plans in reading order and reads one back with its document', async () => {
    const a = await plans.createPlan(db, { title: 'A', html: doc, source: 'a.html' }, 1);
    const b = await plans.createPlan(db, { title: '  B  plan ', html: doc, source: null }, 2);
    expect((await plans.listPlans(db)).map((p) => [p.title, p.position])).toEqual([
      ['A', 0],
      ['B plan', 1],
    ]);
    expect(await plans.getPlan(db, a.id)).toMatchObject({
      title: 'A',
      html: doc,
      source: 'a.html',
    });
    // The list never carries the documents.
    expect((await plans.listPlans(db))[0]).not.toHaveProperty('html');

    await plans.movePlanFirst(db, b.id);
    expect((await plans.listPlans(db)).map((p) => p.title)).toEqual(['B plan', 'A']);
  });

  it('renames and deletes', async () => {
    const a = await plans.createPlan(db, { title: 'A', html: doc, source: null });
    await plans.renamePlan(db, a.id, 'Launch');
    expect((await plans.getPlan(db, a.id))?.title).toBe('Launch');
    await plans.deletePlan(db, a.id);
    expect(await plans.listPlans(db)).toEqual([]);
  });

  it('refuses empty, unnamed or oversized plans', async () => {
    await expect(plans.createPlan(db, { title: ' ', html: doc, source: null })).rejects.toThrow(
      /name/,
    );
    await expect(plans.createPlan(db, { title: 'x', html: '  ', source: null })).rejects.toThrow(
      /empty/,
    );
    const big = 'x'.repeat(plans.MAX_PLAN_BYTES + 1);
    await expect(plans.createPlan(db, { title: 'x', html: big, source: null })).rejects.toThrow(
      /5 MB/,
    );
  });

  it('takes titles from the document or the file name', () => {
    expect(plans.titleFromHtml(doc)).toBe('Short-Let & Launch Plan');
    expect(plans.titleFromHtml('<p>no title</p>')).toBeNull();
    expect(plans.titleFromHtml('<title>Plan &#8211; v2 &#x2019;26 &#99999999;</title>')).toBe(
      'Plan – v2 ’26 &#99999999;',
    );
    expect(plans.titleFromFileName('short-let_launch-plan.html')).toBe('short let launch plan');
    expect(plans.titleFromFileName('.html')).toBe('Untitled plan');
  });

  it("keeps what a plan's page saves, separately from the plan", async () => {
    const a = await plans.createPlan(db, { title: 'A', html: doc, source: null }, 1);
    expect(await plans.getPlanStorage(db, a.id)).toEqual({});
    await plans.savePlanStorage(db, a.id, { 'slp-checks': '{"k1":true}', read: 'p1' });
    expect(await plans.getPlanStorage(db, a.id)).toEqual({
      'slp-checks': '{"k1":true}',
      read: 'p1',
    });
    // Saving progress is not an edit of the plan.
    expect((await plans.getPlan(db, a.id))?.updatedAt).toBe(1);
    expect(await plans.getPlan(db, a.id)).not.toHaveProperty('storage');
    // A damaged value reads back as empty rather than failing the plan.
    await db.execute('UPDATE business_plans SET storage = ? WHERE id = ?', ['{bad', a.id]);
    expect(await plans.getPlanStorage(db, a.id)).toEqual({});
  });

  it('accepts only plain objects of strings within the size limit as page storage', () => {
    expect(plans.parsePlanStorage({ a: 'b' })).toEqual({ a: 'b' });
    expect(plans.parsePlanStorage({})).toEqual({});
    expect(plans.parsePlanStorage(null)).toBeNull();
    expect(plans.parsePlanStorage(['a'])).toBeNull();
    expect(plans.parsePlanStorage('a')).toBeNull();
    expect(plans.parsePlanStorage({ a: 1 })).toBeNull();
    expect(plans.parsePlanStorage({ a: 'x'.repeat(plans.MAX_PLAN_STORAGE) })).toBeNull();
  });

  it('is part of the data export and the full wipe', async () => {
    await plans.createPlan(db, { title: 'A', html: doc, source: null });
    expect((await exportAll(db)).tables.business_plans).toHaveLength(1);
    await clearData(db, 'everything');
    expect(await plans.listPlans(db)).toEqual([]);
  });
});
