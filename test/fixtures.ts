import type { RunContext } from '../src/types.js';

export const sampleContext = (): RunContext => ({
  employer: {
    nickname: 'demo',
    accountNo: '0000000000',
    branch: '0',
    name: 'นิติบุคคลทดสอบ',
    province: 'กรุงเทพมหานคร',
  },
  period: { month: 8, yearCE: 2026 },
  payDate: new Date(2026, 8, 15),
  employees: [
    { ssoId: '0000000000000', prefixCode: '001', firstName: 'ทดสอบหนึ่ง', lastName: 'ข้อมูลจำลอง', wage: 1_000 },
    { ssoId: '9999999999999', prefixCode: '003', firstName: 'ทดสอบสอง', lastName: 'ข้อมูลจำลอง', wage: 20_000 },
  ],
});
