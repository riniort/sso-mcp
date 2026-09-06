import iconv from 'iconv-lite';

export const encodeTIS620 = (value: string): Buffer => iconv.encode(value, 'tis620');
export const decodeTIS620 = (value: Buffer): string => iconv.decode(value, 'tis620');

export function assertTIS620(value: string, fieldName: string): void {
  const encoded = encodeTIS620(value);
  const decoded = decodeTIS620(encoded);
  if (decoded !== value) {
    throw new Error(`${fieldName} contains characters not representable in TIS-620`);
  }
}

export function fitLeft(value: string, length: number, pad = ' '): { buf: Buffer; truncated: boolean } {
  assertTIS620(value, 'text');
  const bytes = encodeTIS620(value);
  if (bytes.length >= length) {
    return { buf: bytes.subarray(0, length), truncated: bytes.length > length };
  }
  return {
    buf: Buffer.concat([bytes, encodeTIS620(pad.repeat(length - bytes.length))]),
    truncated: false,
  };
}

export function fitRight(value: string, length: number, pad = '0'): { buf: Buffer; truncated: boolean } {
  assertTIS620(value, 'text');
  const bytes = encodeTIS620(value);
  if (bytes.length >= length) {
    return { buf: bytes.subarray(bytes.length - length), truncated: bytes.length > length };
  }
  return {
    buf: Buffer.concat([encodeTIS620(pad.repeat(length - bytes.length)), bytes]),
    truncated: false,
  };
}
