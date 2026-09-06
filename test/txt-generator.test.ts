import { describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import { DETAIL_SPEC, HEADER_SPEC } from '../src/config/field-spec.js';
import { buildLine, formatField, generateTxt } from '../src/txt-generator.js';
import { decodeTIS620 } from '../src/util/bytes.js';
import { sampleContext } from './fixtures.js';

describe('generateTxt', () => {
  it('writes 135-byte TIS-620 records with CRLF', () => {
    const generated = generateTxt(computeRun(sampleContext()));
    const records = generated.buf.subarray(0, -2).toString('latin1').split('\r\n');
    expect(records).toHaveLength(3);
    expect(records.every((record) => Buffer.byteLength(record, 'latin1') === 135)).toBe(true);
    expect(generated.buf.subarray(-2).toString('latin1')).toBe('\r\n');
    expect(decodeTIS620(generated.buf)).toContain('บริษัท ทดสอบ จำกัด');
  });

  it('writes 5 percent as 0500 and converts dates to Buddhist Era only at formatting', () => {
    const generated = generateTxt(computeRun(sampleContext()));
    const header = decodeTIS620(generated.buf.subarray(0, 135));
    expect(header.slice(72, 76)).toBe('0500');
    expect(formatField(HEADER_SPEC[3]!, new Date(2026, 8, 15))).toBe('150969');
    expect(formatField(HEADER_SPEC[4]!, { month: 8, yearCE: 2026 })).toBe('0869');
  });

  it('warns when Thai text is truncated', () => {
    const result = buildLine(DETAIL_SPEC, {
      ssoId: '1101700000012',
      prefixCode: '001',
      firstName: 'ก'.repeat(31),
      lastName: 'ใจดี',
      wage: 10_000,
      contribution: 500,
    });
    expect(result.buf).toHaveLength(135);
    expect(result.warnings).toEqual([expect.stringContaining('truncated firstName')]);
  });

  it('rejects characters outside TIS-620', () => {
    const ctx = sampleContext();
    ctx.employees[0]!.firstName = 'Test😀';
    expect(() => generateTxt(computeRun(ctx))).toThrow(/not representable/);
  });
});
