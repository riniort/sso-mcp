import { roundContributionBaht } from './calc.js';
import type { RunResult } from './types.js';
import { fromSatang, round2, sumSatang } from './util/num.js';

export function validateTier1(run: RunResult): string[] {
  const errors: string[] = [];
  const { totals } = run;
  if (totals.headcount !== run.lines.length) errors.push('headcount != count(detail)');

  const wageTotal = fromSatang(sumSatang(run.lines.map((line) => line.employee.wage)));
  if (wageTotal !== totals.totalWage) errors.push('totalWage != sum(detail wage)');

  const employeeTotal = fromSatang(sumSatang(run.lines.map((line) => line.employeeShare)));
  const employerTotal = fromSatang(sumSatang(run.lines.map((line) => line.employerShare)));
  if (employeeTotal !== totals.employeeTotal) errors.push('employeeTotal != sum(detail employee share)');
  if (employerTotal !== totals.employerTotal) errors.push('employerTotal != sum(detail employer share)');
  if (round2(totals.employeeTotal + totals.employerTotal) !== totals.grandTotal) {
    errors.push('grandTotal != employeeTotal + employerTotal');
  }

  const seen = new Set<string>();
  for (const line of run.lines) {
    const { employee } = line;
    if (seen.has(employee.ssoId)) errors.push(`duplicate ssoId=${employee.ssoId}`);
    seen.add(employee.ssoId);
    const expectedBase = Math.min(Math.max(employee.wage, run.rule.wageFloor), run.rule.wageCeiling);
    const expectedShare = Math.min(
      roundContributionBaht((expectedBase * run.rule.ratePercent) / 100),
      run.rule.maxContribution,
    );
    if (line.baseWage !== expectedBase) errors.push(`base wage miscalc ssoId=${employee.ssoId}`);
    if (line.employeeShare !== expectedShare) errors.push(`employee share miscalc ssoId=${employee.ssoId}`);
    if (line.employerShare !== expectedShare) errors.push(`employer share miscalc ssoId=${employee.ssoId}`);
    if (line.employeeShare > run.rule.maxContribution) errors.push(`over max ssoId=${employee.ssoId}`);
  }
  return errors;
}

export function assertTier1(run: RunResult): void {
  const errors = validateTier1(run);
  if (errors.length > 0) throw new Error(`Tier-1 validation failed:\n${errors.join('\n')}`);
}

export function validateTxtRecordWidths(buf: Buffer, expectedRecords: number): string[] {
  const errors: string[] = [];
  if (buf.length < 2 || buf.subarray(buf.length - 2).toString('latin1') !== '\r\n') {
    errors.push('file must end with CRLF');
  }
  const records = buf.subarray(0, Math.max(0, buf.length - 2)).toString('latin1').split('\r\n');
  if (records.length !== expectedRecords) errors.push(`record count ${records.length} != ${expectedRecords}`);
  records.forEach((record, index) => {
    if (Buffer.byteLength(record, 'latin1') !== 135) errors.push(`record ${index + 1} is not 135 bytes`);
  });
  return errors;
}
