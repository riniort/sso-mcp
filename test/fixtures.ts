import type { RunContext } from '../src/types.js';

export const sampleContext = (): RunContext => ({
  employer: {
    nickname: 'demo',
    accountNo: '1234567890',
    branch: '0',
    name: 'บริษัท ทดสอบ จำกัด',
    province: 'กรุงเทพมหานคร',
  },
  period: { month: 8, yearCE: 2026 },
  payDate: new Date(2026, 8, 15),
  employees: [
    { ssoId: '1101700000012', prefixCode: '001', firstName: 'สมชาย', lastName: 'ใจดี', wage: 1_000 },
    { ssoId: '1101700000021', prefixCode: '003', firstName: 'สมหญิง', lastName: 'ขยัน', wage: 20_000 },
  ],
});
