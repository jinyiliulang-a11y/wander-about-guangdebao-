"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Plus, RefreshCw, Ticket } from "lucide-react";
import { GameApiError, isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { Coupon, GameState, RecordingCouponResult, RecordingCouponStatus } from "@/lib/game-types";
import "./recording-coupon-control.css";

export type RecordingCouponControlProps = {
  game: GameState;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onOpenReward: (coupon: Coupon) => void;
  onNewReward?: (coupon: Coupon) => void;
  onRefresh?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};
type Intent = { playerId: string; requestId: string; payload: Record<string, unknown> };
type Phase = "idle" | "submitting" | "uncertain" | "checking";
const memoryKey = Symbol.for("mall-quest.recording-coupon-intent.v2334");

/** Volatile transport intent only; the server owns the issued coupon. */
function memory() {
  if (typeof window === "undefined") return null;
  const target = window as unknown as Record<symbol, Map<string, Intent> | undefined>;
  if (!target[memoryKey]) Object.defineProperty(window, memoryKey, { value: new Map<string, Intent>(), configurable: true });
  return target[memoryKey]!;
}
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function validDemo(value: unknown): value is Coupon {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<Coupon>;
  return row.demo === true && row.rewardType === "coupon" && typeof row.id === "string" && !!row.id &&
    row.taskId === "recording-coupon" && row.storeId === "tea" &&
    typeof row.code === "string" && /^GTB-D-[0-9A-F]{20}$/i.test(row.code) &&
    typeof row.taskTitle === "string" && typeof row.storeName === "string" &&
    typeof row.reward === "string" && typeof row.conditions === "string" &&
    typeof row.issuedAt === "number" && Number.isFinite(row.issuedAt) && row.issuedAt > 0 &&
    typeof row.validStart === "number" && Number.isFinite(row.validStart) && row.validStart > 0 &&
    typeof row.validEnd === "number" && Number.isFinite(row.validEnd) && row.validEnd > row.validStart &&
    ["unused", "used", "expired"].includes(row.status || "") &&
    (row.redeemedAt === null || typeof row.redeemedAt === "number" && Number.isFinite(row.redeemedAt) && row.redeemedAt > 0);
}
function activeDemo(coupon: Coupon | null | undefined, now: number): coupon is Coupon {
  return !!coupon && validDemo(coupon) && coupon.redeemedAt === null &&
    coupon.status !== "used" && coupon.status !== "expired" && coupon.status !== "upcoming" &&
    (coupon.validStart == null || coupon.validStart <= now) && (coupon.validEnd == null || coupon.validEnd > now);
}

export function RecordingCouponControl(props: RecordingCouponControlProps) {
  if (props.game.recordingCouponAllowed !== true || !props.game.player.accountAuthenticated) return null;
  return <RecordingCouponControlContent key={`${props.game.player.id}:${props.game.player.accountId || ""}`} {...props} />;
}

function RecordingCouponControlContent({ game, onAction, onOpenReward, onNewReward, onRefresh, onBusyChange }: RecordingCouponControlProps) {
  const scope = game.player.id;
  const [recovered] = useState(() => memory()?.get(scope) || null);
  const [phase, setPhase] = useState<Phase>(recovered ? "uncertain" : "idle");
  const [issued, setIssued] = useState<Coupon | null>(null), [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(""), [message, setMessage] = useState(recovered ? "上次添加结果还待核对，请先核对原申请。" : "");
  const alive = useRef(true), lock = useRef(false), intent = useRef<Intent | null>(recovered);
  const working = phase === "submitting" || phase === "checking", unresolved = phase === "uncertain";
  const currentIssued = issued ? game.coupons.find(item => item.id === issued.id) || issued : null;
  const existing = game.coupons.find(item => activeDemo(item, now)) || (activeDemo(currentIssued, now) ? currentIssued : null);

  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(() => { if (alive.current) setNow(Date.now()); }, 1000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { onBusyChange?.(working || unresolved); }, [working, unresolved, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    if (!working && !unresolved) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [working, unresolved]);

  function clearIntent(id: string) {
    if (memory()?.get(scope)?.requestId === id) memory()?.delete(scope);
    if (intent.current?.requestId === id) intent.current = null;
  }
  function refresh() {
    try { const result = onRefresh?.(); if (result) void result.catch(() => {}); }
    catch { /* Issuance remains confirmed even if the card pack refresh fails. */ }
  }
  function showCoupon(coupon: Coupon, id: string, newlyIssued: boolean) {
    clearIntent(id);
    if (!alive.current) return;
    setIssued(coupon); setPhase("idle"); setError("");
    const active = activeDemo(coupon, Date.now());
    setMessage(coupon.redeemedAt || coupon.status === "used" ? "这张展示券已经核销，可在卡包查看记录。"
      : !active ? "这张展示券已到期或尚未生效，可在卡包查看记录。"
      : newlyIssued ? "展示券已保存到卡包。" : "已有展示券，直接打开即可。");
    refresh(); if (newlyIssued && active) onNewReward?.(coupon); onOpenReward(coupon);
  }
  async function grant() {
    if (lock.current || intent.current || working || unresolved || game.recordingCouponAllowed !== true || !game.player.accountAuthenticated) return;
    if (existing) { onOpenReward(existing); return; }
    lock.current = true; setPhase("submitting"); setError(""); setMessage("正在添加展示券…");
    let submitted: Intent | null = null;
    try {
      const requestId = newRequestId(), payload = Object.freeze({ requestId });
      submitted = Object.freeze({ playerId: scope, requestId, payload });
      memory()?.set(scope, submitted); intent.current = submitted;
      const response = await onAction("recordingCouponGrant", payload) as Partial<RecordingCouponResult> | null;
      if (!response || response.requestId !== requestId || typeof response.newlyIssued !== "boolean" || !validDemo(response.coupon))
        throw new GameApiError("展示券添加结果还待核对，请核对原申请。", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: true });
      showCoupon(response.coupon, requestId, response.newlyIssued);
    } catch (failure) {
      if (submitted && (isUncertainResult(failure) || !isGameApiError(failure))) {
        if (alive.current) { setPhase("uncertain"); setMessage("添加可能已保存，请核对原申请；不会自动重复添加。"); setError(failure instanceof Error ? failure.message : "添加结果暂未确认。"); }
      } else {
        if (submitted) clearIntent(submitted.requestId);
        if (alive.current) { setPhase("idle"); setMessage(""); setError(failure instanceof Error ? failure.message : "未能添加展示券，请重试。"); }
      }
    } finally { lock.current = false; }
  }
  async function checkStatus() {
    const saved = intent.current;
    if (lock.current || !saved || saved.playerId !== scope) return;
    lock.current = true; setPhase("checking"); setError("");
    try {
      const response = await onAction("recordingCouponStatus", { requestId: saved.requestId }) as Partial<RecordingCouponStatus> | null;
      if (!response || response.requestId !== saved.requestId || typeof response.found !== "boolean") throw new Error("核对结果无法识别，请稍后再核对。");
      if (!alive.current) return;
      if (response.found && validDemo(response.coupon)) showCoupon(response.coupon, saved.requestId, !game.coupons.some(item => item.id === response.coupon?.id));
      else { setPhase("uncertain"); setMessage(response.found ? "查询结果与展示券不一致，请刷新卡包核对。" : "暂未查到原申请，可能仍在处理。请稍后核对，不会自动重新添加。"); }
    } catch (failure) { if (alive.current) { setPhase("uncertain"); setError(failure instanceof Error ? failure.message : "暂时无法核对展示券。"); } }
    finally { lock.current = false; }
  }

  return <section className="recording-coupon-control" aria-label="演示展示券" aria-busy={working}>
    <div className="recording-coupon-heading"><Clapperboard size={22} /><div><h3>演示展示券</h3><p>查看完整卡包与商家核销流程。</p></div></div>
    <p className="recording-coupon-note">功能展示，不可实际消费，不计入寻宝记录。</p>
    {error && <p className="recording-coupon-error" role="alert">{error}</p>}
    {message && <p className="recording-coupon-status" role="status">{message}</p>}
    <div className="recording-coupon-actions">
      {!unresolved && phase !== "checking" && <button type="button" className="outline-button" disabled={working} onClick={() => void grant()}>
        {working ? <RefreshCw size={18} /> : existing ? <Ticket size={18} /> : <Plus size={18} />}
        {working ? "正在添加展示券…" : existing ? "查看展示券" : "添加展示券"}
      </button>}
      {(unresolved || phase === "checking") && <button type="button" className="outline-button" disabled={working} onClick={() => void checkStatus()}><RefreshCw size={18} />{phase === "checking" ? "正在核对原申请…" : "核对展示券添加结果"}</button>}
    </div>
  </section>;
}
