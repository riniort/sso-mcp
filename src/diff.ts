import type { Employee, EmployeeChange, EmployeeDiff } from './types.js';

const CHANGE_FIELDS: Array<keyof Omit<Employee, 'ssoId'>> = [
  'prefixCode',
  'firstName',
  'lastName',
  'wage',
];

export function diffEmployees(previous: readonly Employee[], current: readonly Employee[]): EmployeeDiff {
  const before = new Map(previous.map((employee) => [employee.ssoId, employee]));
  const after = new Map(current.map((employee) => [employee.ssoId, employee]));
  if (before.size !== previous.length) throw new Error('previous employee list contains duplicate ssoId');
  if (after.size !== current.length) throw new Error('current employee list contains duplicate ssoId');

  const added = current.filter((employee) => !before.has(employee.ssoId));
  const removed = previous.filter((employee) => !after.has(employee.ssoId));
  const changed: EmployeeChange[] = [];
  for (const employee of current) {
    const old = before.get(employee.ssoId);
    if (!old) continue;
    const fields = CHANGE_FIELDS.filter((field) => old[field] !== employee[field]);
    if (fields.length > 0) changed.push({ before: old, after: employee, fields });
  }
  return { added, removed, changed };
}
