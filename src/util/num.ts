export const sumSatang = (values: number[]): number =>
  values.reduce((total, value) => total + toSatang(value), 0);

export function toSatang(baht: number): number {
  if (!Number.isFinite(baht)) throw new Error(`invalid money value: ${baht}`);
  return Math.round((baht + Number.EPSILON) * 100);
}

export const fromSatang = (satang: number): number => satang / 100;
export const round2 = (baht: number): number => fromSatang(toSatang(baht));
export const pad2 = (value: number): string => String(value).padStart(2, '0');
