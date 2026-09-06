export const PREFIX_CODES = {
  นาย: '001',
  นาง: '002',
  นางสาว: '003',
} as const;

export function lookupPrefixCode(prefix: string): string {
  const code = PREFIX_CODES[prefix as keyof typeof PREFIX_CODES];
  if (!code) throw new Error(`unknown SSO prefix: ${prefix}`);
  return code;
}
