import { describe, expect, it } from 'vitest';
import { diffEmployees } from '../src/diff.js';
import type { Employee } from '../src/types.js';

const employee = (ssoId: string, wage: number): Employee => ({
  ssoId,
  prefixCode: '001',
  firstName: 'ทดสอบ',
  lastName: 'ทดสอบ',
  wage,
});

describe('diffEmployees', () => {
  it('reports additions, removals, and field changes', () => {
    const result = diffEmployees([employee('0000000000001', 10_000), employee('0000000000002', 8_000)], [
      employee('0000000000001', 12_000),
      employee('0000000000003', 9_000),
    ]);
    expect(result.added.map((row) => row.ssoId)).toEqual(['0000000000003']);
    expect(result.removed.map((row) => row.ssoId)).toEqual(['0000000000002']);
    expect(result.changed[0]?.fields).toEqual(['wage']);
  });
});
