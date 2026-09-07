import { lookupCeiling } from './config/ceilings.js';
import type { Contribution, Employee, RunContext, RunResult } from './types.js';
import { fromSatang, round2, sumSatang, toSatang } from './util/num.js';

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * Round one person's contribution to a whole baht per the สปส. rule confirmed against a real
 * accepted file (SSOSENT 6504): เศษ ≥ 50 สตางค์ ปัดขึ้นเป็น 1 บาท, ต่ำกว่า 50 สตางค์ ปัดทิ้ง.
 * e.g. 380.65 → 381, 500.45 → 500, 82.50 → 83.
 */
export const roundContributionBaht = (baht: number): number => Math.floor((toSatang(baht) + 50) / 100);

function assertEmployee(employee: Employee): void {
  if (!/^\d{13}$/.test(employee.ssoId)) throw new Error(`ssoId must be 13 digits: ${employee.ssoId}`);
  if (!/^\d{3}$/.test(employee.prefixCode)) throw new Error(`prefixCode must be 3 digits: ${employee.prefixCode}`);
  if (!employee.firstName.trim() || !employee.lastName.trim()) throw new Error(`employee name is required: ${employee.ssoId}`);
  if (!Number.isFinite(employee.wage) || employee.wage < 0) throw new Error(`invalid wage: ${employee.ssoId}`);
  if (toSatang(employee.wage) / 100 !== employee.wage) throw new Error(`wage has more than 2 decimals: ${employee.ssoId}`);
}

export function computeRun(ctx: RunContext): RunResult {
  const rule = lookupCeiling(ctx.period);
  if (Number.isNaN(ctx.payDate.getTime())) throw new Error('invalid payDate');
  if (!/^\d{10}$/.test(ctx.employer.accountNo)) throw new Error('employer accountNo must be 10 digits');
  if (!/^\d{1,6}$/.test(ctx.employer.branch)) throw new Error('employer branch must be 1-6 digits');

  const lines: Contribution[] = ctx.employees.map((employee) => {
    assertEmployee(employee);
    const baseWage = clamp(employee.wage, rule.wageFloor, rule.wageCeiling);
    const employeeShare = Math.min(
      roundContributionBaht((baseWage * rule.ratePercent) / 100),
      rule.maxContribution,
    );
    return { employee, baseWage, employeeShare, employerShare: employeeShare };
  });

  const employeeTotal = fromSatang(sumSatang(lines.map((line) => line.employeeShare)));
  const employerTotal = fromSatang(sumSatang(lines.map((line) => line.employerShare)));
  return {
    ctx,
    rule,
    lines,
    totals: {
      headcount: lines.length,
      totalWage: fromSatang(sumSatang(lines.map((line) => line.employee.wage))),
      employeeTotal,
      employerTotal,
      grandTotal: round2(employeeTotal + employerTotal),
    },
  };
}
