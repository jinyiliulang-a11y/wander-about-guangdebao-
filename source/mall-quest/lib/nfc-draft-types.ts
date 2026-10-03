import type { Coupon } from "./game-types";

/** A saved request is not an issued reward and has no coupon/claim effects. */
export type NfcDraft = {
  id: string; requestId: string; playerId: string; playerNickname: string;
  storeId: string; storeName: string; taskId: string; taskTitle: string; deviceId: string;
  reward: string; conditions: string; rewardType: "coupon" | "points"; rewardValue: number;
  state: "pending" | "deleted" | "issued"; revision: number;
  createdAt: number; updatedAt: number; permitUntil: number; canConfirm: boolean; returnedAt?: number; coupon?: Coupon;
};
export type NfcDraftPage = { items: NfcDraft[]; page: number; pageSize: number; total: number; totalPages: number };
export type NfcDraftResult = { requestId: string; draft: NfcDraft; message: string };
export type NfcDraftOperationStatus = { found: boolean; requestId: string; draft?: NfcDraft; coupon?: Coupon };
export type MerchantClaimDevice = { id: string; name: string; storeId: string; storeName: string; taskId: string; code: string };
export type MerchantPendingClaims = NfcDraftPage & { device: MerchantClaimDevice };
export type MerchantIssueClaimResult = NfcDraftResult & { coupon: Coupon; newlyIssued: boolean };

/** A fixed code selects a registered device. It is public, reusable, and is not a proof of presence. */
export const FIXED_DEVICE_CODE_PREFIX = "GTB-DEVICE:";
