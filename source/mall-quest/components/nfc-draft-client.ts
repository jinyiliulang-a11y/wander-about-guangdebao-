"use client";

import { useEffect, useRef, useState } from "react";
import { GameApiError, isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { Coupon } from "@/lib/game-types";
import type { NfcDraft, NfcDraftOperationStatus, NfcDraftPage, NfcDraftResult } from "@/lib/nfc-draft-types";

type DraftIntent = { action: string; requestId: string; payload: Record<string, unknown>; checked: boolean };
const memoryKey = Symbol.for("mall-quest.nfc-draft-intents.v1");
const changed = "mall-quest:nfc-draft-intent";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function intents() {
  if (typeof window === "undefined") return null;
  const target = window as unknown as Record<symbol, Map<string, DraftIntent> | undefined>;
  if (!target[memoryKey]) Object.defineProperty(window, memoryKey, { value: new Map<string, DraftIntent>(), configurable: true });
  return target[memoryKey]!;
}
function save(key: string, value: DraftIntent | null) {
  if (value) intents()?.set(key, value); else intents()?.delete(key);
  window.dispatchEvent(new CustomEvent(changed, { detail: key }));
}
function freezePayload(value: Record<string, unknown>) {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const freeze = (item: unknown) => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(copy); return copy;
}
export function draftRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function validDraft(value: unknown): value is NfcDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<NfcDraft>;
  return typeof row.id === "string" && uuid.test(row.id) && row.requestId === row.id &&
    [row.playerId, row.playerNickname, row.storeId, row.storeName, row.taskId, row.taskTitle, row.deviceId, row.reward, row.conditions].every(item => typeof item === "string") &&
    !!row.playerId && !!row.storeId && !!row.taskId && !!row.deviceId &&
    ["pending", "deleted", "issued"].includes(row.state || "") && ["points", "coupon"].includes(row.rewardType || "") &&
    Number.isSafeInteger(row.revision) && row.revision! >= 0 && [row.createdAt, row.updatedAt, row.permitUntil, row.rewardValue].every(Number.isFinite) &&
    typeof row.canConfirm === "boolean";
}
export function validDraftPage(value: unknown): value is NfcDraftPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<NfcDraftPage>;
  return Array.isArray(row.items) && row.items.every(validDraft) && [row.page, row.pageSize, row.total, row.totalPages].every(Number.isSafeInteger) &&
    row.page! >= 1 && row.pageSize! >= 1 && row.pageSize! <= 20 && row.total! >= 0 && row.totalPages! >= 0 && row.items.length <= row.pageSize!;
}
export function validDraftCoupon(value: unknown, draft: NfcDraft): value is Coupon {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<Coupon>;
  return typeof row.id === "string" && uuid.test(row.id) && row.taskId === draft.taskId && row.storeId === draft.storeId && row.demo !== true &&
    row.rewardType === draft.rewardType && typeof row.code === "string" && (row.rewardType === "points" ? row.code === "" : /^GTB-[0-9A-F]{12}$/i.test(row.code)) &&
    typeof row.taskTitle === "string" && typeof row.storeName === "string" && typeof row.reward === "string" && typeof row.conditions === "string" &&
    Number.isFinite(row.issuedAt) && (row.redeemedAt === null || Number.isFinite(row.redeemedAt));
}
export function draftActorKey(playerId: string, accountId?: string, storeId?: string) {
  return `${storeId ? "merchant" : "player"}:${playerId}:${accountId || ""}:${storeId || ""}`;
}
function matchesIntent(saved: DraftIntent, draft: NfcDraft, coupon?: unknown) {
  if (saved.action === "nfcClaim" && (draft.id !== saved.requestId || draft.taskId !== saved.payload.taskId ||
      typeof saved.payload.deviceId === "string" && draft.deviceId !== saved.payload.deviceId)) return false;
  if (typeof saved.payload.draftId === "string" && draft.id !== saved.payload.draftId) return false;
  if (coupon !== undefined && !validDraftCoupon(coupon, draft) || draft.coupon !== undefined && !validDraftCoupon(draft.coupon, draft)) return false;
  if (draft.state === "issued" && !validDraftCoupon(coupon ?? draft.coupon, draft)) return false;
  if (saved.action === "nfcDraftDelete" && draft.state !== "deleted") return false;
  return saved.action !== "merchantIssueClaim" || draft.state === "issued" && validDraftCoupon(coupon, draft) && coupon.id === saved.requestId;
}
/** Preserve a write's original UUID/payload in page memory; recovery only reads that UUID. */
export function useDraftMutation(actorKey: string, onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>) {
  const [pending, setPending] = useState<DraftIntent | null>(() => intents()?.get(actorKey) || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    const receive = (event: Event) => { if ((event as CustomEvent<string>).detail === actorKey) setPending(intents()?.get(actorKey) || null); };
    window.addEventListener(changed, receive);
    return () => { alive.current = false; window.removeEventListener(changed, receive); };
  }, [actorKey]);
  async function send(saved: DraftIntent, accepts?: (draft: NfcDraft, result: Record<string, unknown>) => boolean): Promise<NfcDraftResult | null> {
    lock.current = true; setBusy(true); setError("");
    save(actorKey, { ...saved, checked: false });
    try {
      const result = await onAction(saved.action, saved.payload) as Partial<NfcDraftResult> | null;
      if (!result || result.requestId !== saved.requestId || !validDraft(result.draft) ||
          !matchesIntent(saved, result.draft, (result as Record<string, unknown>).coupon) || accepts && !accepts(result.draft, result as Record<string, unknown>))
        throw new GameApiError("结果与原申请暂时无法核对，请查询原请求。", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: true });
      save(actorKey, null);
      return result as NfcDraftResult;
    } catch (cause) {
      const uncertain = isUncertainResult(cause) || !isGameApiError(cause);
      if (!uncertain) save(actorKey, null);
      if (alive.current) setError(cause instanceof Error ? cause.message : "操作未完成，请核对原请求。");
      return null;
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function run(action: string, payload: Record<string, unknown>, accepts?: (draft: NfcDraft, result: Record<string, unknown>) => boolean) {
    if (lock.current || intents()?.has(actorKey)) { setError("上次操作的结果尚未确认，请先核对原请求。"); return null; }
    const requestId = payload.requestId;
    if (typeof requestId !== "string" || !uuid.test(requestId)) throw new Error("领取请求标识无效。");
    return send({ action, requestId, payload: freezePayload(payload), checked: false }, accepts);
  }
  async function retry(accepts?: (draft: NfcDraft, result: Record<string, unknown>) => boolean) {
    const saved = intents()?.get(actorKey);
    if (lock.current || !saved?.checked) return null;
    return send(saved, accepts);
  }
  async function recover(): Promise<NfcDraftOperationStatus | null> {
    const saved = intents()?.get(actorKey);
    if (lock.current || !saved) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const action = saved.action === "nfcClaim" ? "nfcClaimStatus" : saved.action === "merchantIssueClaim" ? "merchantIssueClaimStatus" : "nfcDraftOperationStatus";
      const result = await onAction(action, { requestId: saved.requestId }) as Partial<NfcDraftOperationStatus> | null;
      if (!result || result.requestId !== saved.requestId || typeof result.found !== "boolean" ||
          result.found && (!validDraft(result.draft) || !matchesIntent(saved, result.draft, result.coupon))) throw new Error("原请求查询结果无法识别，请稍后核对。");
      if (!result.found) { save(actorKey, { ...saved, checked: true }); if (alive.current) setError("暂未查到原请求。可以继续核对，或明确重试同一请求；编号和原输入都保持不变。"); return null; }
      save(actorKey, null); return result as NfcDraftOperationStatus;
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "暂时无法核对原请求。"); return null; }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return { pending, busy, error, run, recover, retry };
}
