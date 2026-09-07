// Official codes from the สปส. "Format เงินสมทบ (135)" spec: 003=นาย, 004=นางสาว, 005=นาง.
// The spec lists only these three; any other prefix must be requested from ประกันสังคม.
export const PREFIX_CODES = {
  นาย: '003',
  นางสาว: '004',
  นาง: '005',
} as const;

export function lookupPrefixCode(prefix: string): string {
  const code = PREFIX_CODES[prefix as keyof typeof PREFIX_CODES];
  if (!code) throw new Error(`unknown SSO prefix: ${prefix}`);
  return code;
}
