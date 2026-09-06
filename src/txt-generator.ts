import { DETAIL_SPEC, HEADER_SPEC, RATE_SCALE, RECORD_BYTES } from './config/field-spec.js';
import type { FieldSpec, GeneratedTxt, Period, RunResult } from './types.js';
import { fitLeft, fitRight } from './util/bytes.js';
import { pad2, toSatang } from './util/num.js';
import { assertTier1, validateTxtRecordWidths } from './validate.js';

const CRLF = Buffer.from('\r\n', 'latin1');

export function formatField(field: FieldSpec, value: unknown): string {
  switch (field.kind) {
    case 'const':
      return field.const ?? '';
    case 'text':
      return String(value ?? '');
    case 'int':
      return String(Math.trunc(Number(value)));
    case 'money':
      return String(toSatang(Number(value)));
    case 'dateDDMMYY': {
      const date = value as Date;
      return `${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${pad2((date.getFullYear() + 543) % 100)}`;
    }
    case 'periodMMYY': {
      const period = value as Period;
      return `${pad2(period.month)}${pad2((period.yearCE + 543) % 100)}`;
    }
  }
}

export function buildLine(
  spec: readonly FieldSpec[],
  values: Readonly<Record<string, unknown>>,
): { buf: Buffer; warnings: string[] } {
  const warnings: string[] = [];
  const parts = spec.map((field) => {
    const raw = formatField(field, values[field.name]);
    const result =
      field.align === 'left'
        ? fitLeft(raw, field.length, field.pad)
        : fitRight(raw, field.length, field.pad);
    if (result.truncated) warnings.push(`truncated ${field.name}: "${raw}"`);
    if (result.buf.length !== field.length) {
      throw new Error(`${field.name} width ${result.buf.length} != ${field.length}`);
    }
    return result.buf;
  });
  const buf = Buffer.concat(parts);
  if (buf.length !== RECORD_BYTES) throw new Error(`line is ${buf.length} bytes, expected ${RECORD_BYTES}`);
  return { buf, warnings };
}

export function generateTxt(run: RunResult): GeneratedTxt {
  assertTier1(run);
  const warnings: string[] = [];
  if (run.rule.provisional) warnings.push('wage floor is provisional for this period; confirm the governing rule');
  const { ctx, totals } = run;
  const header = buildLine(HEADER_SPEC, {
    accountNo: ctx.employer.accountNo,
    branch: ctx.employer.branch,
    payDate: ctx.payDate,
    period: ctx.period,
    employerName: ctx.employer.name,
    rate: run.rule.ratePercent * RATE_SCALE,
    headcount: totals.headcount,
    totalWage: totals.totalWage,
    totalContribution: totals.grandTotal,
    employeeContribution: totals.employeeTotal,
    employerContribution: totals.employerTotal,
  });
  warnings.push(...header.warnings);

  const details = run.lines.map((line) => {
    const detail = buildLine(DETAIL_SPEC, {
      ssoId: line.employee.ssoId,
      prefixCode: line.employee.prefixCode,
      firstName: line.employee.firstName,
      lastName: line.employee.lastName,
      wage: line.employee.wage,
      contribution: line.employeeShare,
    });
    warnings.push(...detail.warnings);
    return detail.buf;
  });

  const records = [header.buf, ...details];
  const buf = Buffer.concat(records.flatMap((record) => [record, CRLF]));
  const widthErrors = validateTxtRecordWidths(buf, records.length);
  if (widthErrors.length > 0) throw new Error(`TXT validation failed:\n${widthErrors.join('\n')}`);
  return { buf, warnings };
}
