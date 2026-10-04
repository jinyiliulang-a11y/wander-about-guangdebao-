"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Plus, RefreshCw, Ticket } from "lucide-react";
import { GameApiError, isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { Coupon, GameState, RecordingCouponResult, RecordingCouponStatus } from "@/lib/game-types";
import { HARDWARE_DEMO_INSTANCE } from "@/lib/application-scope";
import "./recording-coupon-control.css";

export type RecordingCouponControlProps = {
  game: GameState;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onOpenReward: (coupon: Coupon) => void;
  onNewReward?: (coupon: Coupon) => void;
  onRefresh?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};
type Intent = { playerId: string; requestId: string; payload: Record<string, unknown>; checked: boolean };
type Phase = "idle" | "submitting" | "uncertain" | "checking";
const memoryKey = Symbol.for("mall-quest.recording-coupon-intent.v2353");

/** This memory stores transport intent only; the backend owns every display coupon. */
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
  return !!coupon && validDemo(coupon) && coupon.redeemedAt === null && coupon.status === "unused" &&
    coupon.validStart! <= now && coupon.validEnd! > now;
}

export function RecordingCouponControl(props: RecordingCouponControlProps) {
  const { game } = props;
  if (game.recordingShortcutAllowed !== true || !game.player.accountAuthenticated) return null;
  return <>
    {HARDWARE_DEMO_INSTANCE && game.recordingCouponAllowed === true && <RecordingCouponControlContent key={`${game.player.id}:${game.player.accountId || ""}`} {...props} />}
    <section className="recording-coupon-control" aria-label="设备联动演示">
      <div className="recording-coupon-heading"><Clapperboard size={22} /><div><h3>设备联动演示</h3><p>需要验证真实设备流程时，仍按以下步骤领取。</p></div></div>
      <ol className="recording-coupon-device-steps">
        <li>碰金币 NFC 进入任务，允许定位并保存待领申请。{HARDWARE_DEMO_INSTANCE && "演示仅记录定位，不校验门店范围；商家确认时间为10分钟。"}</li>
        <li>把金币交给商家。商家在“金币领取确认”中扫描设备码 <code>GTB-DEVICE:coin-tea-01</code>。</li>
        <li>商家核对玩家和领取编号，收到金币后点击“确认领取”。</li>
        <li>领取成功后，奖励进入当前玩家的卡包；定位许可过期时，先更新定位再请商家刷新。</li>
        <li>消费时出示卡包中的个人优惠券码，由对应门店另外确认核销。</li>
      </ol>
      <p className="recording-coupon-note">设备扫码只查询待领申请；个人券码用于之后的核销。奖励以门店当前活动配置为准。</p>
    </section>
  </>;
}

function RecordingCouponControlContent({ game, onAction, onOpenReward, onNewReward, onRefresh, onBusyChange }: RecordingCouponControlProps) {
  const scope = `${game.player.id}:${game.player.accountId || ""}`;
  const [recovered] = useState(() => memory()?.get(scope) || null);
  const [phase, setPhase] = useState<Phase>(recovered ? "uncertain" : "idle");
  const [issued, setIssued] = useState<Coupon | null>(null), [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(""), [message, setMessage] = useState(recovered ? "上次领取结果还待核对，请先核对原申请。" : "");
  const [retryAllowed, setRetryAllowed] = useState(recovered?.checked === true);
  const alive = useRef(false), lock = useRef(false), intent = useRef<Intent | null>(recovered);
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
    catch { /* A refresh failure cannot undo the confirmed display coupon. */ }
  }
  function showCoupon(coupon: Coupon, id: string, newlyIssued: boolean) {
    clearIntent(id);
    if (!alive.current) return;
    setIssued(coupon); setPhase("idle"); setRetryAllowed(false); setError("");
    const active = activeDemo(coupon, Date.now());
    setMessage(coupon.redeemedAt || coupon.status === "used" ? "这张展示券已完成演示核销，可在卡包查看记录。"
      : !active ? "这张展示券已到期或尚未生效，可在卡包查看记录。"
      : newlyIssued ? "展示券已进入演示卡包，无需商家审核；仅供功能展示。" : "已有展示券，直接打开即可。");
    refresh();
    // Presentation callbacks must never turn a confirmed server result into a retryable write.
    try { if (newlyIssued && active) onNewReward?.(coupon); }
    catch { setError("展示券已保存，奖励动画未能自动打开，请从演示卡包查看。"); }
    try { onOpenReward(coupon); }
    catch { setError("展示券已保存，请从演示卡包打开查看。"); }
  }
  async function send(saved: Intent) {
    if (lock.current) return;
    lock.current = true;
    const submitted = Object.freeze({ ...saved, checked: false });
    memory()?.set(scope, submitted); intent.current = submitted;
    setPhase("submitting"); setRetryAllowed(false); setError(""); setMessage("正在领取展示券…");
    try {
      const response = await onAction("recordingCouponGrant", submitted.payload) as Partial<RecordingCouponResult> | null;
      if (!response || response.requestId !== submitted.requestId || typeof response.newlyIssued !== "boolean" || !validDemo(response.coupon))
        throw new GameApiError("展示券领取结果还待核对，请核对原申请。", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: true });
      showCoupon(response.coupon, submitted.requestId, response.newlyIssued);
    } catch (failure) {
      if (isUncertainResult(failure) || !isGameApiError(failure)) {
        if (alive.current) { setPhase("uncertain"); setMessage("领取可能已保存，请核对原申请；不会自动重复领取。"); setError(failure instanceof Error ? failure.message : "领取结果暂未确认。"); }
      } else {
        clearIntent(submitted.requestId);
        if (alive.current) { setPhase("idle"); setMessage(""); setError(failure instanceof Error ? failure.message : "未能领取展示券，请重试。"); }
      }
    } finally { lock.current = false; }
  }
  async function grant() {
    if (lock.current || intent.current || working || unresolved || !HARDWARE_DEMO_INSTANCE || game.recordingShortcutAllowed !== true || game.recordingCouponAllowed !== true || !game.player.accountAuthenticated) return;
    if (existing) { onOpenReward(existing); return; }
    const requestId = newRequestId();
    await send(Object.freeze({ playerId: game.player.id, requestId, payload: Object.freeze({ requestId }), checked: false }));
  }
  async function checkStatus() {
    const saved = intent.current;
    if (lock.current || !saved || saved.playerId !== game.player.id) return;
    lock.current = true; setPhase("checking"); setRetryAllowed(false); setError("");
    try {
      const response = await onAction("recordingCouponStatus", { requestId: saved.requestId }) as Partial<RecordingCouponStatus> | null;
      if (!response || response.requestId !== saved.requestId || typeof response.found !== "boolean") throw new Error("核对结果无法识别，请稍后再核对。");
      if (!alive.current) return;
      if (response.found && validDemo(response.coupon)) showCoupon(response.coupon, saved.requestId, !game.coupons.some(item => item.id === response.coupon?.id));
      else {
        const checked = Object.freeze({ ...saved, checked: response.found === false });
        memory()?.set(scope, checked); intent.current = checked;
        setPhase("uncertain"); setRetryAllowed(checked.checked);
        setMessage(response.found ? "查询结果与展示券不一致，请刷新卡包核对。" : "暂未查到原申请，可继续核对，或明确重试同一次申请；编号保持不变。");
      }
    } catch (failure) { if (alive.current) { setPhase("uncertain"); setError(failure instanceof Error ? failure.message : "暂时无法核对展示券。"); } }
    finally { lock.current = false; }
  }
  async function retry() {
    const saved = intent.current;
    if (working || lock.current || !saved?.checked || saved.playerId !== game.player.id) return;
    await send(saved);
  }

  return <section className="recording-coupon-control" aria-label="演示展示券" aria-busy={working}>
    <div className="recording-coupon-heading"><Clapperboard size={22} /><div><h3>领取展示券</h3><p>直接体验领券、奖励动画和演示卡包，无需商家审核。</p></div></div>
    <p className="recording-coupon-note">仅独立演示站提供。展示券不可实际消费，不占普通活动库存，不计入正常寻宝记录。</p>
    {error && <p className="recording-coupon-error" role="alert">{error}</p>}
    {message && <p className="recording-coupon-status" role="status">{message}</p>}
    <div className="recording-coupon-actions">
      {!unresolved && phase !== "checking" && <button type="button" className="gold-button" disabled={working} onClick={() => void grant()}>
        {working ? <RefreshCw size={18} /> : existing ? <Ticket size={18} /> : <Plus size={18} />}
        {working ? "正在领取展示券…" : existing ? "查看展示券与演示卡包" : "领取展示券，体验卡包动画"}
      </button>}
      {(unresolved || phase === "checking") && <button type="button" className="outline-button" disabled={working} onClick={() => void checkStatus()}><RefreshCw size={18} />{phase === "checking" ? "正在核对原申请…" : "核对展示券领取结果"}</button>}
      {unresolved && retryAllowed && <button type="button" className="outline-button" disabled={working} onClick={() => void retry()}>重试原申请（同一编号）</button>}
    </div>
  </section>;
}
