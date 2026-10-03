"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LocateFixed, RefreshCw, Ticket, Trash2 } from "lucide-react";
import { readBrowserLocation } from "@/lib/browser-location";
import type { Coupon, GameState } from "@/lib/game-types";
import type { NfcDraft, NfcClaimStatus } from "@/lib/game-types";
import { draftActorKey, draftRequestId, useDraftMutation, validDraft, validDraftCoupon } from "./nfc-draft-client";
import "./nfc-draft-panels.css";

export function NfcDraftDetail({ game, draft, onAction, onChange, onOpenReward }: {
  game: GameState; draft: NfcDraft; onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onChange: (draft: NfcDraft) => void; onOpenReward: (coupon: Coupon) => void;
}) {
  const operation = useDraftMutation(draftActorKey(game.player.id, game.player.accountId), onAction);
  const [now, setNow] = useState(Date.now), [reading, setReading] = useState(false), [locating, setLocating] = useState(false);
  const [error, setError] = useState(""), [deleteAsked, setDeleteAsked] = useState(false), [reward, setReward] = useState<Coupon | null>(() => draft.coupon || null);
  const alive = useRef(false), readingLock = useRef(false), sequence = useRef(0);
  useEffect(() => {
    alive.current = true; const requestSequence = sequence; const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; requestSequence.current++; clearInterval(tick); };
  }, []);
  const remaining = Math.max(0, Math.ceil((draft.permitUntil - now) / 1000));
  const busy = operation.busy || reading || locating, blocked = busy || !!operation.pending;
  const owns = draft.playerId === game.player.id && game.player.accountAuthenticated;
  async function check() {
    if (readingLock.current || busy || !owns) return;
    readingLock.current = true; setReading(true); setError("");
    const attempt = ++sequence.current;
    try {
      const result = operation.pending ? await operation.recover() : await onAction("nfcClaimStatus", { requestId: draft.requestId }) as NfcClaimStatus;
      if (!alive.current || attempt !== sequence.current || !result) return;
      if (!result.found || !validDraft(result.draft) || result.draft.playerId !== game.player.id ||
          !operation.pending && (result.requestId !== draft.requestId || result.draft.id !== draft.id) ||
          result.draft.state === "issued" && !validDraftCoupon(result.coupon ?? result.draft.coupon, result.draft)) throw new Error("暂时无法核对这条待领记录，请稍后再查询。");
      onChange(result.draft);
      const coupon = result.coupon || result.draft.coupon;
      if (coupon && validDraftCoupon(coupon, result.draft)) setReward(coupon);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "暂时无法核对领取结果。"); }
    finally { readingLock.current = false; if (alive.current) setReading(false); }
  }
  async function revalidate() {
    if (readingLock.current || blocked || !owns || draft.state !== "pending") return;
    readingLock.current = true; setLocating(true); setError(""); const attempt = ++sequence.current;
    try {
      const location = await readBrowserLocation();
      if (!alive.current || attempt !== sequence.current) return;
      const result = await operation.run("nfcDraftRevalidate", { draftId: draft.id, requestId: draftRequestId(), expectedRevision: draft.revision, location: Object.freeze({ ...location }) }, next => next.id === draft.id && next.playerId === game.player.id);
      if (alive.current && result) onChange(result.draft);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "未能更新到店位置。"); }
    finally { readingLock.current = false; if (alive.current) setLocating(false); }
  }
  async function remove() {
    if (blocked || !owns || draft.state !== "pending" || !deleteAsked) return;
    const result = await operation.run("nfcDraftDelete", { draftId: draft.id, requestId: draftRequestId(), expectedRevision: draft.revision }, next => next.id === draft.id && next.playerId === game.player.id && next.state === "deleted");
    if (alive.current && result) { setDeleteAsked(false); onChange(result.draft); }
  }
  async function retry() {
    const result = await operation.retry(next => next.playerId === game.player.id);
    if (alive.current && result) onChange(result.draft);
  }
  const issued = draft.state === "issued";
  const coupon = reward && validDraftCoupon(reward, draft) ? reward : draft.coupon && validDraftCoupon(draft.coupon, draft) ? draft.coupon : null;
  return <section className="nfc-draft-detail" aria-label="待领记录详情" aria-busy={busy}>
    <span className="pill">{issued ? "已发放" : draft.state === "deleted" ? "已删除" : "待商家确认"}</span>
    <h3>{draft.reward}</h3><p>{draft.storeName} · {draft.taskTitle}</p><p className="muted">{draft.conditions}</p>
    <dl><div><dt>领取编号</dt><dd>{draft.id.slice(-8).toUpperCase()}</dd></div><div><dt>金币设备</dt><dd>{draft.deviceId}</dd></div></dl>
    {draft.state === "pending" && <div className="nfc-draft-notice"><strong>请让商家扫描金币设备码，选择你的待领记录</strong><p>商家核对玩家、接收金币并确认发券后，正式奖励才进入卡包。关闭窗口会保留这条草稿。</p><p>{draft.canConfirm && remaining > 0 ? `本次到店许可剩余约 ${remaining} 秒，请及时交给商家确认。` : "到店许可需要更新。请在门店范围内点击重新定位，再请商家发券。"}</p></div>}
    {issued && <p className="nfc-draft-notice"><CheckCircle2 size={18} />{draft.rewardType === "points" ? "积分奖励已入账，无需优惠券核销。" : "正式券已进入卡包，稍后消费时再出示个人券二维码核销。"}</p>}
    {draft.state === "deleted" && <p className="nfc-draft-notice">领取草稿已删除，没有发放奖励。</p>}
    {(error || operation.error) && <p className="inline-error" role="alert">{error || operation.error}</p>}
    <div className="nfc-draft-actions">
      {operation.pending ? <button type="button" className="gold-button" disabled={busy} onClick={() => void check()}><RefreshCw size={17} />核对原操作结果</button> : draft.state !== "deleted" && <button type="button" className="outline-button" disabled={busy} onClick={() => void check()}><RefreshCw size={17} />{reading ? "正在核对…" : "核对领取结果"}</button>}
      {operation.pending?.checked && <button type="button" className="outline-button" disabled={busy} onClick={() => void retry()}>重试同一次操作</button>}
      {draft.state === "pending" && <button type="button" className="gold-button" disabled={blocked} onClick={() => void revalidate()}><LocateFixed size={17} />{locating ? "正在定位…" : "重新定位，更新到店许可"}</button>}
      {issued && coupon && <button type="button" className="gold-button" disabled={busy} onClick={() => onOpenReward(coupon)}><Ticket size={17} />查看正式奖励</button>}
      {draft.state === "pending" && <button type="button" className="text-button danger-button" disabled={blocked} onClick={() => setDeleteAsked(true)}><Trash2 size={17} />删除领取草稿</button>}
    </div>
    {deleteAsked && draft.state === "pending" && <div className="nfc-draft-delete"><p>删除这条尚未发券的领取草稿？已发放的券不能在这里删除。</p><div className="nfc-draft-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => setDeleteAsked(false)}>保留草稿</button><button type="button" className="gold-button" disabled={blocked} onClick={() => void remove()}>确认删除草稿</button></div></div>}
  </section>;
}
