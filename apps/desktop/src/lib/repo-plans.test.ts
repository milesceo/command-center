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

  it('is part of the data export and the full wipe', async () => {
    await plans.createPlan(db, { title: 'A', html: doc, source: null });
    expect((await exportAll(db)).tables.business_plans).toHaveLength(1);
    await clearData(db, 'everything');
    expect(await plans.listPlans(db)).toEqual([]);
  });
});
