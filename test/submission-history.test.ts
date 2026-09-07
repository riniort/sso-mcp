import { describe, expect, it } from 'vitest';
import {
  findSubmittedPeriod,
  parseHistoryRows,
  parsePeriodLabel,
  parseThaiAmount,
} from '../src/sso/submission-history.js';

// Real rows captured from a live infoEmployeeContribute.do session (account 1200318650, year 2569).
const capturedRows: string[][] = [
  ['งวดเงินสมทบ', 'วันที่ชำระเงิน', 'เงินค่าจ้าง', 'อัตราเงินสมทบ', 'จำนวนผู้ประกันตน', 'เงินสมทบ', 'เงินชำระเพิ่ม'],
  ['01/2569', '13/02/2569', '42,424.00', '5.00', '5', '4,242.00', '0.00'],
  ['02/2569', '17/03/2569', '42,796.00', '5.00', '5', '4,280.00', '0.00'],
  ['07/2569', '14/08/2569', '42,796.00', '5.00', '5', '4,280.00', '0.00'],
];

describe('parseThaiAmount', () => {
  it('strips thousands separators', () => {
    expect(parseThaiAmount('42,796.00')).toBe(42796);
    expect(parseThaiAmount(' 4,242.00 ')).toBe(4242);
  });
});

describe('parsePeriodLabel', () => {
  it('converts พ.ศ. period labels to Gregorian', () => {
    expect(parsePeriodLabel('07/2569')).toEqual({ month: 7, yearCE: 2026 });
  });
  it('rejects non-period text (e.g. the header)', () => {
    expect(parsePeriodLabel('งวดเงินสมทบ')).toBeNull();
    expect(parsePeriodLabel('13/2569')).toBeNull();
  });
});

describe('parseHistoryRows', () => {
  it('skips the header and parses filed periods', () => {
    const records = parseHistoryRows(capturedRows);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      month: 1,
      yearCE: 2026,
      periodLabelBE: '01/2569',
      payDateBE: '13/02/2569',
      totalWage: 42424,
      ratePercent: 5,
      headcount: 5,
      contribution: 4242,
      surcharge: 0,
    });
  });
});

describe('findSubmittedPeriod', () => {
  const records = parseHistoryRows(capturedRows);
  it('finds a period already filed', () => {
    expect(findSubmittedPeriod(records, { month: 7, yearCE: 2026 })?.periodLabelBE).toBe('07/2569');
  });
  it('returns undefined for a period not yet filed', () => {
    expect(findSubmittedPeriod(records, { month: 8, yearCE: 2026 })).toBeUndefined();
  });
});
