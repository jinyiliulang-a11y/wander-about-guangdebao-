// QR Code versions 2/3, error correction L, byte mode, mask 0.
// Version 3 also covers longer legacy ASCII redemption codes.
export function couponQrMatrix(value: string): boolean[][] {
  const bytes = new TextEncoder().encode(value);
  if (!/^[A-Za-z0-9-]+$/.test(value) || bytes.length > 53) throw new Error("券码不适合生成二维码");
  const version = bytes.length <= 32 ? 2 : 3;
  const capacity = version === 2 ? 34 : 55, eccLength = version === 2 ? 10 : 15;
  const bits: number[] = [];
  const append = (number: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((number >>> i) & 1);
  };
  append(4, 4); append(bytes.length, 8);
  bytes.forEach(byte => append(byte, 8));
  append(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0; data.length < capacity; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  function multiply(x: number, y: number) {
    let result = 0;
    for (let i = 7; i >= 0; i--) { result = (result << 1) ^ ((result >>> 7) * 0x11d); result ^= ((y >>> i) & 1) * x; }
    return result;
  }
  const divisor = Array<number>(eccLength).fill(0); divisor[eccLength - 1] = 1;
  let root = 1;
  for (let i = 0; i < eccLength; i++) {
    for (let j = 0; j < eccLength; j++) { divisor[j] = multiply(divisor[j], root); if (j + 1 < eccLength) divisor[j] ^= divisor[j + 1]; }
    root = multiply(root, 2);
  }
  const ecc = Array<number>(eccLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ ecc.shift()!; ecc.push(0);
    for (let i = 0; i < eccLength; i++) ecc[i] ^= multiply(divisor[i], factor);
  }
  const codewords = [...data, ...ecc];
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  const format = 0x77c4;
  const formatBit = (i: number) => !!((format >>> i) & 1);
  for (let i = 0; i <= 5; i++) set(8, i, formatBit(i));
  set(8, 7, formatBit(6)); set(8, 8, formatBit(7)); set(7, 8, formatBit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, formatBit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, formatBit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, formatBit(i));
  set(8, size - 8, true);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fixed[y][x]) continue;
        const bit = index < codewords.length * 8 && !!((codewords[index >>> 3] >>> (7 - (index & 7))) & 1);
        modules[y][x] = bit !== ((x + y) % 2 === 0); index++;
      }
    }
  }
  return modules;
}
