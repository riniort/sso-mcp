import { describe, expect, it } from 'vitest';
import { computeRun, roundSatang } from '../src/calc.js';
import { sampleContext } from './fixtures.js';

describe('computeRun', () => {
  it('clamps below floor and above ceiling', () => {
    const run = computeRun(sampleContext());
    expect(run.lines[0]).toMatchObject({ baseWage: 1_650, employeeShare: 82.5, employerShare: 82.5 });
    expect(run.lines[1]).toMatchObject({ baseWage: 17_500, employeeShare: 875, employerShare: 875 });
    expect(run.totals).toEqual({
      headcount: 2,
      totalWage: 21_000,
      employeeTotal: 957.5,
      employerTotal: 957.5,
      grandTotal: 1_915,
    });
  });

  it('uses the pre-2026 ceiling', () => {
    const ctx = sampleContext();
    ctx.period = { month: 12, yearCE: 2025 };
    const run = computeRun(ctx);
    expect(run.lines[1]?.employeeShare).toBe(750);
  });

  it('rounds to satang', () => {
    expect(roundSatang(10.005)).toBe(10.01);
    expect(roundSatang(10.994)).toBe(10.99);
  });
});
