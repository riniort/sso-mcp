import { describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import { reconcileSummary } from '../src/sso/reconcile.js';
import { sampleContext } from './fixtures.js';

describe('reconcileSummary', () => {
  it('passes only when every portal total is present and equal', () => {
    const run = computeRun(sampleContext());
    expect(reconcileSummary(run, { ...run.totals, draftId: 'draft-1' })).toEqual({ ok: true, differences: [] });
  });

  it('fails closed on missing fields', () => {
    const run = computeRun(sampleContext());
    const result = reconcileSummary(run, { headcount: run.totals.headcount });
    expect(result.ok).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'grandTotal', reason: 'missing' }),
    ]));
  });

  it('reports mismatched values', () => {
    const run = computeRun(sampleContext());
    const result = reconcileSummary(run, { ...run.totals, grandTotal: run.totals.grandTotal + 0.01 });
    expect(result.differences).toEqual([
      { field: 'grandTotal', expected: run.totals.grandTotal, actual: run.totals.grandTotal + 0.01, reason: 'mismatch' },
    ]);
  });
});
