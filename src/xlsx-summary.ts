import ExcelJS from 'exceljs';
import type { EmployeeDiff, RunResult } from './types.js';

const moneyFormat = '#,##0.00';

function addEmployeeRow(
  sheet: ExcelJS.Worksheet,
  status: string,
  employee: { ssoId: string; prefixCode: string; firstName: string; lastName: string; wage: number },
  details = '',
): void {
  sheet.addRow([status, employee.ssoId, employee.prefixCode, employee.firstName, employee.lastName, employee.wage, details]);
}

export async function writeXlsx(run: RunResult, diff: EmployeeDiff): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ssomcp';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('สรุปเงินสมทบ', { views: [{ state: 'frozen', ySplit: 5 }] });
  summary.addRows([
    ['นายจ้าง', run.ctx.employer.name],
    ['เลขบัญชี/สาขา', `${run.ctx.employer.accountNo}/${run.ctx.employer.branch.padStart(6, '0')}`],
    ['งวด', `${String(run.ctx.period.month).padStart(2, '0')}/${run.ctx.period.yearCE + 543}`],
    ['สถานะกฎ', run.rule.provisional ? 'ชั่วคราว—ต้องยืนยันค่าจ้างขั้นต่ำตามกฎกระทรวง' : 'ยืนยันแล้ว'],
    ['เลขประกันสังคม', 'ชื่อ-สกุล', 'ค่าจ้างจริง', 'ฐานคำนวณ', 'ส่วนลูกจ้าง', 'ส่วนนายจ้าง', 'รวม'],
  ]);
  for (const line of run.lines) {
    summary.addRow([
      line.employee.ssoId,
      `${line.employee.firstName} ${line.employee.lastName}`,
      line.employee.wage,
      line.baseWage,
      line.employeeShare,
      line.employerShare,
      line.employeeShare + line.employerShare,
    ]);
  }
  summary.addRow([
    'รวม',
    `${run.totals.headcount} คน`,
    run.totals.totalWage,
    '',
    run.totals.employeeTotal,
    run.totals.employerTotal,
    run.totals.grandTotal,
  ]);
  summary.columns = [
    { width: 18 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
  ];
  summary.getRow(5).font = { bold: true };
  summary.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
  summary.getColumn(1).numFmt = '@';
  for (let column = 3; column <= 7; column += 1) summary.getColumn(column).numFmt = moneyFormat;
  summary.autoFilter = { from: 'A5', to: 'G5' };

  const changes = workbook.addWorksheet('เปลี่ยนแปลงจากงวดก่อน');
  changes.addRow(['สถานะ', 'เลขประกันสังคม', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ค่าจ้าง', 'รายละเอียด']);
  diff.added.forEach((employee) => addEmployeeRow(changes, 'เพิ่ม', employee));
  diff.removed.forEach((employee) => addEmployeeRow(changes, 'ออก', employee));
  diff.changed.forEach((change) => addEmployeeRow(changes, 'แก้ไข', change.after, change.fields.join(', ')));
  if (changes.rowCount === 1) changes.addRow(['ไม่มีการเปลี่ยนแปลง']);
  changes.columns = [
    { width: 14 }, { width: 18 }, { width: 12 }, { width: 22 }, { width: 25 }, { width: 16 }, { width: 32 },
  ];
  changes.getRow(1).font = { bold: true };
  changes.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
  changes.getColumn(2).numFmt = '@';
  changes.getColumn(6).numFmt = moneyFormat;
  changes.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
