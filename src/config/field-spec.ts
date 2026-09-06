import type { FieldSpec } from '../types.js';

export const RECORD_BYTES = 135;
export const RATE_SCALE = 100;

export const HEADER_SPEC: readonly FieldSpec[] = [
  { name: 'recordType', length: 1, align: 'left', pad: ' ', kind: 'const', const: '1' },
  { name: 'accountNo', length: 10, align: 'left', pad: ' ', kind: 'text' },
  { name: 'branch', length: 6, align: 'right', pad: '0', kind: 'int' },
  { name: 'payDate', length: 6, align: 'right', pad: '0', kind: 'dateDDMMYY' },
  { name: 'period', length: 4, align: 'right', pad: '0', kind: 'periodMMYY' },
  { name: 'employerName', length: 45, align: 'left', pad: ' ', kind: 'text' },
  { name: 'rate', length: 4, align: 'right', pad: '0', kind: 'int' },
  { name: 'headcount', length: 6, align: 'right', pad: '0', kind: 'int' },
  { name: 'totalWage', length: 15, align: 'right', pad: '0', kind: 'money' },
  { name: 'totalContribution', length: 14, align: 'right', pad: '0', kind: 'money' },
  { name: 'employeeContribution', length: 12, align: 'right', pad: '0', kind: 'money' },
  { name: 'employerContribution', length: 12, align: 'right', pad: '0', kind: 'money' },
];

export const DETAIL_SPEC: readonly FieldSpec[] = [
  { name: 'recordType', length: 1, align: 'left', pad: ' ', kind: 'const', const: '2' },
  { name: 'ssoId', length: 13, align: 'left', pad: ' ', kind: 'text' },
  { name: 'prefixCode', length: 3, align: 'left', pad: ' ', kind: 'text' },
  { name: 'firstName', length: 30, align: 'left', pad: ' ', kind: 'text' },
  { name: 'lastName', length: 35, align: 'left', pad: ' ', kind: 'text' },
  { name: 'wage', length: 14, align: 'right', pad: '0', kind: 'money' },
  { name: 'contribution', length: 12, align: 'right', pad: '0', kind: 'money' },
  { name: 'filler', length: 27, align: 'left', pad: ' ', kind: 'const', const: '' },
];

function assertSpecWidth(name: string, spec: readonly FieldSpec[]): void {
  const width = spec.reduce((total, field) => total + field.length, 0);
  if (width !== RECORD_BYTES) throw new Error(`${name} spec is ${width} bytes, expected ${RECORD_BYTES}`);
}

assertSpecWidth('header', HEADER_SPEC);
assertSpecWidth('detail', DETAIL_SPEC);
