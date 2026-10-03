export const STORE_IMAGE_MAX_BYTES = 500 * 1024;
export const STORE_IMAGE_MAX_DIMENSION = 1280;
export const STORE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type StoreImageMime = typeof STORE_IMAGE_TYPES[number];
const invalid = () => new Error("图片内容与格式不符，请使用有效的 PNG、JPEG 或 WebP 图片。");
const u32 = (b: Uint8Array, i: number) => (b[i] * 16777216 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]) >>> 0;
const little = (b: Uint8Array, i: number) => (b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + b[i + 3] * 16777216) >>> 0;
const ascii = (b: Uint8Array, i: number, length: number) => String.fromCharCode(...b.subarray(i, i + length));
const crcTable = Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc(b: Uint8Array, start: number, end: number) { let value = 0xffffffff; for (let i = start; i < end; i++) value = crcTable[(value ^ b[i]) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }

/** Checks real container headers, bounds, dimensions and declared MIME. No SVG or external URL is accepted. */
export function inspectStoreImage(bytes: Uint8Array, mime: string, maxBytes = STORE_IMAGE_MAX_BYTES, maxDimension = STORE_IMAGE_MAX_DIMENSION) {
  if (!STORE_IMAGE_TYPES.includes(mime as StoreImageMime) || bytes.length < 20 || bytes.length > maxBytes) throw invalid();
  let width = 0, height = 0;
  if (mime === "image/png") {
    if (ascii(bytes, 1, 3) !== "PNG" || bytes[0] !== 137 || bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10) throw invalid();
    let offset = 8, chunks = 0, data = false, ended = false;
    while (offset < bytes.length && chunks++ < 4096) {
      if (offset + 12 > bytes.length) throw invalid();
      const length = u32(bytes, offset), type = ascii(bytes, offset + 4, 4), end = offset + 12 + length;
      if (!/^[A-Za-z]{4}$/.test(type) || end > bytes.length || crc(bytes, offset + 4, offset + 8 + length) !== u32(bytes, offset + 8 + length)) throw invalid();
      if (chunks === 1) {
        if (type !== "IHDR" || length !== 13 || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw invalid();
        width = u32(bytes, offset + 8); height = u32(bytes, offset + 12);
      } else if (type === "IHDR") throw invalid();
      if (type === "IDAT" && length) data = true;
      if (type === "IEND") { if (length !== 0 || end !== bytes.length || !data) throw invalid(); ended = true; break; }
      offset = end;
    }
    if (!ended) throw invalid();
  } else if (mime === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216) throw invalid();
    let offset = 2, scan = false, ended = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) { if (offset !== bytes.length || !scan) throw invalid(); ended = true; break; }
      if (!marker || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) throw invalid();
      const length = bytes[offset] * 256 + bytes[offset + 1], end = offset + length;
      if (length < 2 || end > bytes.length) throw invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8 || length !== 8 + 3 * bytes[offset + 7]) throw invalid();
        height = bytes[offset + 3] * 256 + bytes[offset + 4]; width = bytes[offset + 5] * 256 + bytes[offset + 6];
      }
      offset = end;
      if (marker === 218) {
        if (length < 6 || !width) throw invalid(); scan = true;
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) { offset++; continue; }
          const next = bytes[offset + 1];
          if (next === 0 || next >= 208 && next <= 215) { offset += 2; continue; }
          break;
        }
      }
    }
    if (!ended) throw invalid();
  } else {
    if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || little(bytes, 4) + 8 !== bytes.length) throw invalid();
    let offset = 12, frame = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw invalid();
      const type = ascii(bytes, offset, 4), length = little(bytes, offset + 4), start = offset + 8, end = start + length;
      if (end > bytes.length) throw invalid();
      if (type === "VP8 ") {
        if (length < 10 || ascii(bytes, start + 3, 3) !== "\u009d\u0001\u002a") throw invalid();
        width = (bytes[start + 6] + (bytes[start + 7] << 8)) & 16383; height = (bytes[start + 8] + (bytes[start + 9] << 8)) & 16383; frame = true;
      } else if (type === "VP8L") {
        if (length < 5 || bytes[start] !== 47) throw invalid();
        width = 1 + bytes[start + 1] + ((bytes[start + 2] & 63) << 8);
        height = 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 15) << 10); frame = true;
      } else if (type === "VP8X") { if (length !== 10 || bytes[start] & 2) throw invalid(); }
      else if (type === "ANIM" || type === "ANMF") throw invalid();
      offset = end + (length & 1);
    }
    if (!frame || offset !== bytes.length) throw invalid();
  }
  if (!width || !height || width > maxDimension || height > maxDimension) throw new Error(`图片最长边须不超过 ${maxDimension} 像素，请缩小后重试。`);
  return { width, height, mime: mime as StoreImageMime, bytes: bytes.length };
}

export function validateStoreImageURL(value: unknown) {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > Math.ceil(STORE_IMAGE_MAX_BYTES / 3) * 4 + 40) throw new Error("门店图片不超过 500KB，且只能保存一张图片。");
  const matched = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!matched || matched[2].length % 4 !== 0) throw invalid();
  const raw = matched[2], padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0, size = raw.length / 4 * 3 - padding;
  if (size > STORE_IMAGE_MAX_BYTES) throw new Error("门店图片不超过 500KB，请压缩后重试。");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = new Uint8Array(size);
  let write = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const a = alphabet.indexOf(raw[i]), b = alphabet.indexOf(raw[i + 1]), c = raw[i + 2] === "=" ? 0 : alphabet.indexOf(raw[i + 2]), d = raw[i + 3] === "=" ? 0 : alphabet.indexOf(raw[i + 3]);
    if (i === raw.length - 4 && (padding === 2 && b & 15 || padding === 1 && c & 3)) throw invalid();
    bytes[write++] = a << 2 | b >> 4;
    if (write < size) bytes[write++] = b << 4 | c >> 2;
    if (write < size) bytes[write++] = c << 6 | d;
  }
  inspectStoreImage(bytes, matched[1]);
  return value;
}
