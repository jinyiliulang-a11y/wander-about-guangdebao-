import type { AccountRole } from "@/lib/account-types";

export type MerchantDraft = { name: string; address: string; floor: string; area: string; category: string; phone: string; latitude: string; longitude: string; radius: string; couponTitle: string; couponType: "cash" | "discount" | "gift"; value: string; minAmount: string; totalCount: string; conditions: string; validity: "always" | "dates"; start: string; end: string };
/** The verified email is the username; keep the original proof with the exact pending UUID in volatile memory. */
type RegistrationSnapshot = { username: string; password: string; confirmPassword: string; nickname: string; phone: string; merchant: MerchantDraft; step: number; email: string; emailCode: string; emailChallengeId: string; emailExpiresAt: number };
type Intent = { requestId: string; payload: Record<string, unknown>; snapshot: RegistrationSnapshot; retryable: boolean };
const key = Symbol.for("mall-quest.pending-account-registration.v2332");
function memory(): Map<AccountRole, Intent> | null {
  if (typeof window === "undefined") return null;
  const target = window as unknown as Record<symbol, Map<AccountRole, Intent> | undefined>;
  if (!target[key]) Object.defineProperty(window, key, { value: new Map<AccountRole, Intent>(), configurable: true });
  return target[key]!;
}
function immutable<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (node: unknown) => { if (node && typeof node === "object") { for (const child of Object.values(node)) freeze(child); Object.freeze(node); } };
  freeze(clone); return clone;
}
export function pendingRegistration(role: AccountRole) { return memory()?.get(role) || null; }
export function rememberRegistration(role: AccountRole, payload: Record<string, unknown>, snapshot: RegistrationSnapshot) {
  const store = memory(), requestId = payload.requestId;
  if (!store || typeof requestId !== "string") return false;
  const old = store.get(role);
  if (old && old.requestId !== requestId) return false;
  store.set(role, immutable({ requestId, payload, snapshot, retryable: old?.retryable ?? true }));
  return true;
}
export function registrationRetryable(role: AccountRole, requestId: unknown, retryable: boolean) {
  const store = memory(), current = store?.get(role);
  if (current && current.requestId === requestId) store!.set(role, Object.freeze({ ...current, retryable }));
}
export function clearRegistration(role: AccountRole, requestId: unknown) {
  const store = memory();
  if (store && typeof requestId === "string" && store.get(role)?.requestId === requestId) store.delete(role);
}
