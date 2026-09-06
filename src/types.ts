export interface Employee {
  ssoId: string;
  prefixCode: string;
  firstName: string;
  lastName: string;
  wage: number;
}

export interface Contribution {
  employee: Employee;
  baseWage: number;
  employeeShare: number;
  employerShare: number;
}

export interface EmployerRef {
  nickname: string;
  accountNo: string;
  branch: string;
  name: string;
  province: string;
}

export interface Period {
  month: number;
  yearCE: number;
}

export interface CeilingRule {
  from: Period;
  to?: Period;
  ratePercent: number;
  wageFloor: number;
  wageCeiling: number;
  maxContribution: number;
  provisional?: boolean;
}

export interface RunContext {
  employer: EmployerRef;
  period: Period;
  payDate: Date;
  employees: Employee[];
}

export interface RunResult {
  ctx: RunContext;
  rule: CeilingRule;
  lines: Contribution[];
  totals: {
    headcount: number;
    totalWage: number;
    employeeTotal: number;
    employerTotal: number;
    grandTotal: number;
  };
}

export interface EmployeeChange {
  before: Employee;
  after: Employee;
  fields: Array<keyof Omit<Employee, 'ssoId'>>;
}

export interface EmployeeDiff {
  added: Employee[];
  removed: Employee[];
  changed: EmployeeChange[];
}

export type FieldKind =
  | 'const'
  | 'text'
  | 'int'
  | 'money'
  | 'dateDDMMYY'
  | 'periodMMYY';

export interface FieldSpec {
  name: string;
  length: number;
  align: 'left' | 'right';
  pad: ' ' | '0';
  kind: FieldKind;
  const?: string;
}

export interface GeneratedTxt {
  buf: Buffer;
  warnings: string[];
}
