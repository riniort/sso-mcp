import { describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import { generateTxt } from '../src/txt-generator.js';
import { validateTier1, validateTxtRecordWidths } from '../src/validate.js';
import { sampleContext } from './fixtures.js';

describe('Tier-1 validation', () => {
  it('accepts a valid run', () => {
    expect(validateTier1(computeRun(sampleContext()))).toEqual([]);
  });

  it('detects total and per-person tampering', () => {
    const run = computeRun(sampleContext());
    run.totals.grandTotal += 1;
    run.lines[0]!.employeeShare += 1;
    expect(validateTier1(run)).toEqual(expect.arrayContaining([
      expect.stringContaining('employeeTotal'),
      expect.stringContaining('grandTotal'),
      expect.stringContaining('employee share miscalc'),
    ]));
  });

  it('detects duplicate ids', () => {
    const ctx = sampleContext();
    ctx.employees.push({ ...ctx.employees[0]! });
    expect(validateTier1(computeRun(ctx))).toContain('duplicate ssoId=1101700000012');
  });

  it('detects malformed record width', () => {
    const buf = generateTxt(computeRun(sampleContext())).buf;
    const broken = Buffer.concat([buf.subarray(0, 134), buf.subarray(135)]);
    expect(validateTxtRecordWidths(broken, 3)).toContain('record 1 is not 135 bytes');
  });
});
