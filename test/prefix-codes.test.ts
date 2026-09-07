import { describe, expect, it } from 'vitest';
import { lookupPrefixCode, PREFIX_CODES } from '../src/config/prefix-codes.js';

// Official codes from the สปส. "Format เงินสมทบ (135)" spec, confirmed by a real accepted file
// (ชลชาติ = 003 นาย, ณัฎฐณิชา = 004 นางสาว).
describe('prefix codes', () => {
  it('uses the official สปส. codes', () => {
    expect(PREFIX_CODES).toEqual({ นาย: '003', นางสาว: '004', นาง: '005' });
    expect(lookupPrefixCode('นาย')).toBe('003');
    expect(lookupPrefixCode('นางสาว')).toBe('004');
    expect(lookupPrefixCode('นาง')).toBe('005');
  });

  it('throws for a prefix not in the official list', () => {
    expect(() => lookupPrefixCode('ว่าที่ร้อยตรี')).toThrow();
  });
});
