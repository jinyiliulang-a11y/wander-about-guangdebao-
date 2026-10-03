export const HARDWARE_CODE_TTL_MS = 90_000;
export const HARDWARE_REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;
export const HARDWARE_DEVICE_ID = /^[A-Za-z0-9_-]{3,64}$/;

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const hardwareCodeHash = (storeId: string, code: string) =>
  digest(`mall-48h:${storeId}:${code}`);

// A retry can reconstruct the original code without retaining its plaintext.
// The random persisted nonce also lets a rare collision be retried safely.
export async function hardwareCodeValue(token: string, deviceId: string, requestId: string, nonce: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${deviceId}:${requestId}:${nonce}`)));
  const value = new DataView(bytes.buffer).getUint32(0, false) % 1_000_000;
  return String(value).padStart(6, "0");
}
