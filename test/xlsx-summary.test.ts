import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { computeRun } from '../src/calc.js';
import { diffEmployees } from '../src/diff.js';
import { generateTxt } from '../src/txt-generator.js';
import { writeXlsx } from '../src/xlsx-summary.js';
import { sampleContext } from './fixtures.js';

describe('xlsx summary', () => {
  it('uses the same RunResult totals as TXT', async () => {
    const run = computeRun(sampleContext());
    const txt = generateTxt(run);
    const workbook = new ExcelJS.Workbook();
    const bytes = await writeXlsx(run, diffEmployees([], run.ctx.employees));
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.getWorksheet('สรุปเงินสมทบ')!;
    const totalsRow = sheet.getRow(sheet.rowCount);
    expect(totalsRow.getCell(7).value).toBe(run.totals.grandTotal);

    const header = txt.buf.subarray(0, 135).toString('latin1');
    const grandTotalSatang = Number(header.slice(97, 111));
    expect(grandTotalSatang).toBe(Math.round(run.totals.grandTotal * 100));
  });
});
