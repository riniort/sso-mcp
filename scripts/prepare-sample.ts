import { mkdir } from 'node:fs/promises';
import { prepareContribution } from '../src/prepare.js';
import type { RunContext } from '../src/types.js';

const ctx: RunContext = {
  employer: {
    nickname: 'sample',
    accountNo: '1234567890',
    branch: '0',
    name: 'บริษัท ตัวอย่าง จำกัด',
    province: 'กรุงเทพมหานคร',
  },
  period: { month: 8, yearCE: 2026 },
  payDate: new Date(2026, 8, 15),
  employees: [
    { ssoId: '1101700000012', prefixCode: '001', firstName: 'สมชาย', lastName: 'ตัวอย่าง', wage: 18_000 },
    { ssoId: '1101700000021', prefixCode: '003', firstName: 'สมหญิง', lastName: 'ทดสอบ', wage: 12_500 },
  ],
};

await mkdir('out', { recursive: true });
const result = await prepareContribution(ctx, [], {
  txtPath: 'out/sso110-sample.txt',
  xlsxPath: 'out/sso110-review-sample.xlsx',
});
console.log(`Prepared ${ctx.employees.length} employees. Warnings: ${result.warnings.length}`);
