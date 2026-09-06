import type { RunResult } from '../types.js';
import { toSatang } from '../util/num.js';
import type { PortalSummary } from './actuator.js';

export type SummaryField =
  | 'headcount'
  | 'totalWage'
  | 'employeeTotal'
  | 'employerTotal'
  | 'grandTotal';

export interface ReconcileDifference {
  field: SummaryField;
  expected: number;
  actual: number | undefined;
  reason: 'missing' | 'mismatch';
}

export interface ReconcileResult {
  ok: boolean;
  differences: ReconcileDifference[];
}

const SUMMARY_FIELDS: readonly SummaryField[] = [
  'headcount',
  'totalWage',
  'employeeTotal',
  'employerTotal',
  'grandTotal',
];

function equal(field: SummaryField, expected: number, actual: number): boolean {
  return field === 'headcount' ? expected === actual : toSatang(expected) === toSatang(actual);
}

/** Fail-closed: every required portal total must be present and equal. */
export function reconcileSummary(run: RunResult, actual: PortalSummary): ReconcileResult {
  const differences: ReconcileDifference[] = [];
  for (const field of SUMMARY_FIELDS) {
    const expected = run.totals[field];
    const value = actual[field];
    if (value === undefined || !Number.isFinite(value)) {
      differences.push({ field, expected, actual: value, reason: 'missing' });
    } else if (!equal(field, expected, value)) {
      differences.push({ field, expected, actual: value, reason: 'mismatch' });
    }
  }
  return { ok: differences.length === 0, differences };
}
