import { mkdir } from 'node:fs/promises';
import { prepareContribution } from '../src/prepare.js';
import type { RunContext } from '../src/types.js';

const ctx: RunContext = {
  employer: {
    nickname: 'sample',
    accountNo: '0000000000',
    branch: '0',
    name: 'นิติบุคคลทดสอบ',
    province: 'กรุงเทพมหานคร',
  },
  period: { month: 8, yearCE: 2026 },
  payDate: new Date(2026, 8, 15),
  employees: [
    { ssoId: '0000000000000', prefixCode: '001', firstName: 'ทดสอบหนึ่ง', lastName: 'ข้อมูลจำลอง', wage: 18_000 },
    { ssoId: '9999999999999', prefixCode: '003', firstName: 'ทดสอบสอง', lastName: 'ข้อมูลจำลอง', wage: 12_500 },
  ],
};

await mkdir('out', { recursive: true });
const result = await prepareContribution(ctx, [], {
  txtPath: 'out/sso110-sample.txt',
  xlsxPath: 'out/sso110-review-sample.xlsx',
});
console.log(`Prepared ${ctx.employees.length} employees. Warnings: ${result.warnings.length}`);
