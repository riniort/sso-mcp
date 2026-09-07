import { describe, expect, it } from 'vitest';
import { computeRun, roundContributionBaht } from '../src/calc.js';
import { sampleContext } from './fixtures.js';

describe('computeRun', () => {
  it('clamps below floor and above ceiling', () => {
    const run = computeRun(sampleContext());
    // 1,650 × 5% = 82.50 → rounds up to 83 (whole-baht สปส. rule).
    expect(run.lines[0]).toMatchObject({ baseWage: 1_650, employeeShare: 83, employerShare: 83 });
    expect(run.lines[1]).toMatchObject({ baseWage: 17_500, employeeShare: 875, employerShare: 875 });
    expect(run.totals).toEqual({
      headcount: 2,
      totalWage: 21_000,
      employeeTotal: 958,
      employerTotal: 958,
      grandTotal: 1_916,
    });
  });

  it('uses the pre-2026 ceiling', () => {
    const ctx = sampleContext();
    ctx.period = { month: 12, yearCE: 2025 };
    const run = computeRun(ctx);
    expect(run.lines[1]?.employeeShare).toBe(750);
  });

  it('rounds each contribution to whole baht, half up (สปส. rule)', () => {
    expect(roundContributionBaht(82.5)).toBe(83); // exactly .50 rounds up
    expect(roundContributionBaht(380.65)).toBe(381); // matches SSOSENT 6504 sample
    expect(roundContributionBaht(500.45)).toBe(500); // < .50 rounds down
    expect(roundContributionBaht(500.5)).toBe(501);
    expect(roundContributionBaht(750)).toBe(750);
  });
});
