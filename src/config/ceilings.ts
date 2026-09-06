import type { CeilingRule, Period } from '../types.js';

const periodNumber = (period: Period): number => period.yearCE * 12 + period.month - 1;

export const CEILING_RULES: readonly CeilingRule[] = [
  {
    from: { month: 1, yearCE: 2000 },
    to: { month: 12, yearCE: 2025 },
    ratePercent: 5,
    wageFloor: 1_650,
    wageCeiling: 15_000,
    maxContribution: 750,
  },
  {
    from: { month: 1, yearCE: 2026 },
    to: { month: 12, yearCE: 2028 },
    ratePercent: 5,
    wageFloor: 1_650,
    wageCeiling: 17_500,
    maxContribution: 875,
    provisional: true,
  },
  {
    from: { month: 1, yearCE: 2029 },
    to: { month: 12, yearCE: 2031 },
    ratePercent: 5,
    wageFloor: 1_650,
    wageCeiling: 20_000,
    maxContribution: 1_000,
    provisional: true,
  },
];

export function lookupCeiling(period: Period): CeilingRule {
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new Error(`invalid month: ${period.month}`);
  }
  if (!Number.isInteger(period.yearCE) || period.yearCE < 2000) {
    throw new Error(`invalid Gregorian year: ${period.yearCE}`);
  }
  const value = periodNumber(period);
  const rule = CEILING_RULES.find(
    (candidate) =>
      value >= periodNumber(candidate.from) &&
      (candidate.to === undefined || value <= periodNumber(candidate.to)),
  );
  if (!rule) throw new Error(`no ceiling rule for ${period.month}/${period.yearCE}`);
  return rule;
}
