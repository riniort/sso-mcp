import type { Period } from '../types.js';

/**
 * Parser for the รายการประวัติการส่งเงินสมทบ table on infoEmployeeContribute.do, kept pure so
 * it can be unit-tested against real captured rows without a browser. Column order (verified
 * from a live authenticated session):
 *   งวดเงินสมทบ | วันที่ชำระเงิน | เงินค่าจ้าง | อัตราเงินสมทบ | จำนวนผู้ประกันตน | เงินสมทบ | เงินชำระเพิ่ม
 * Periods and dates on the page are Buddhist Era (พ.ศ.).
 */
export interface SubmissionRecord {
  month: number;
  yearCE: number;
  /** Period label as shown, e.g. "07/2569". */
  periodLabelBE: string;
  payDateBE: string;
  totalWage: number;
  ratePercent: number;
  headcount: number;
  contribution: number;
  surcharge: number;
}

/** Parse "42,796.00" → 42796. Returns NaN for unparseable input. */
export function parseThaiAmount(text: string): number {
  return Number(text.replace(/,/gu, '').trim());
}

const BE_OFFSET = 543;

/** Parse a "MM/YYYY" Buddhist-era period label into month + Gregorian year. */
export function parsePeriodLabel(label: string): { month: number; yearCE: number } | null {
  const match = /^(\d{1,2})\/(\d{4})$/u.exec(label.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const yearBE = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { month, yearCE: yearBE - BE_OFFSET };
}

/**
 * Turn raw table cells (including or excluding the header row) into structured records.
 * Rows that do not start with a valid MM/YYYY period label (e.g. the header, or a
 * "no data" row) are skipped.
 */
export function parseHistoryRows(rows: string[][]): SubmissionRecord[] {
  const records: SubmissionRecord[] = [];
  for (const cells of rows) {
    if (cells.length < 7) continue;
    const period = parsePeriodLabel(cells[0] ?? '');
    if (!period) continue;
    records.push({
      month: period.month,
      yearCE: period.yearCE,
      periodLabelBE: cells[0]!.trim(),
      payDateBE: cells[1]!.trim(),
      totalWage: parseThaiAmount(cells[2]!),
      ratePercent: parseThaiAmount(cells[3]!),
      headcount: parseThaiAmount(cells[4]!),
      contribution: parseThaiAmount(cells[5]!),
      surcharge: parseThaiAmount(cells[6]!),
    });
  }
  return records;
}

/** Find an already-submitted filing for the given Gregorian period, if any. */
export function findSubmittedPeriod(
  records: SubmissionRecord[],
  period: Period,
): SubmissionRecord | undefined {
  return records.find((record) => record.month === period.month && record.yearCE === period.yearCE);
}
