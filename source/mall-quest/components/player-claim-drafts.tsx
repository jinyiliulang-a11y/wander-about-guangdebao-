"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileClock, RefreshCw } from "lucide-react";
import type { Coupon, GameState } from "@/lib/game-types";
import type { NfcDraft, NfcDraftPage } from "@/lib/nfc-draft-types";
import { Drawer } from "./common/Drawer";
import { NfcDraftDetail } from "./nfc-draft-detail";
import { draftActorKey, useDraftMutation, validDraftCoupon, validDraftPage } from "./nfc-draft-client";
import "./nfc-draft-panels.css";

type Props = { game: GameState; onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>; onOpenReward: (coupon: Coupon) => void; onNewReward?: (coupon: Coupon) => void; onRefresh?: () => void | Promise<void> };
export function PlayerClaimDrafts(props: Props) { return <PlayerClaimDraftsContent key={[props.game.player.id, props.game.player.accountId || ""].join(":")} {...props} />; }
function PlayerClaimDraftsContent({ game, onAction, onOpenReward, onNewReward, onRefresh }: Props) {
  const [open, setOpen] = useState(false), [page, setPage] = useState<NfcDraftPage | null>(null), [selected, setSelected] = useState<NfcDraft | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), sequence = useRef(0), rewardAfterClose = useRef<Coupon | null>(null);
  const operation = useDraftMutation(draftActorKey(game.player.id, game.player.accountId), onAction);
  useEffect(() => { alive.current = true; const requestSequence = sequence; return () => { alive.current = false; requestSequence.current++; }; }, []);
  async function loadPage(number: number) {
    const attempt = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await onAction("nfcDrafts", { page: number, pageSize: 20 });
      if (!alive.current || attempt !== sequence.current) return;
      if (!validDraftPage(result) || result.items.some(row => row.playerId !== game.player.id || row.state !== "pending")) throw new Error("领取草稿列表无法核对，请刷新当前账号后重试。");
      setPage(result);
      // Explicitly opening/refreshing the list also refreshes the formal wallet:
      // a merchant may have issued a draft from another browser in the meantime.
      await onRefresh?.();
    } catch (cause) { if (alive.current && attempt === sequence.current) setError(cause instanceof Error ? cause.message : "草稿列表暂时无法读取。"); }
    finally { if (alive.current && attempt === sequence.current) setLoading(false); }
  }
  function changed(draft: NfcDraft) {
    setSelected(draft);
    setPage(current => current ? { ...current, items: current.items.map(row => row.id === draft.id ? draft : row).filter(row => row.state === "pending") } : current);
    if (draft.state === "issued") {
      if (draft.coupon && validDraftCoupon(draft.coupon, draft) && !game.coupons.some(row => row.id === draft.coupon?.id)) onNewReward?.(draft.coupon);
      try { const result = onRefresh?.(); if (result) void result.catch(() => {}); } catch { /* The issued result remains visible. */ }
    }
  }
  async function recover() {
    const result = await operation.recover();
    if (alive.current && result?.draft && result.draft.playerId === game.player.id) changed(result.draft);
  }
  async function retry() {
    const result = await operation.retry(draft => draft.playerId === game.player.id);
    if (alive.current && result) changed(result.draft);
  }
  if (!game.player.accountAuthenticated) return null;
  return <>
    <button type="button" className="player-claim-drafts-trigger" aria-haspopup="dialog" onClick={() => { setOpen(true); setSelected(null); void loadPage(1); }}><FileClock size={23} /><span><strong>领取草稿</strong><small>待商家确认的奖励，可继续领取或删除</small></span><ChevronRight size={20} /></button>
    {open && <Drawer title={selected ? "待领记录详情" : "领取草稿"} historyKey="player-claim-drafts" onClose={() => { setOpen(false); sequence.current++; setLoading(false); const coupon = rewardAfterClose.current; rewardAfterClose.current = null; if (coupon) onOpenReward(coupon); }}>{close => <div className="player-claim-drafts-list">
      {selected ? <><div className="nfc-draft-actions"><button type="button" className="outline-button" onClick={() => { setSelected(null); void loadPage(page?.page || 1); }}><ArrowLeft size={17} />返回草稿列表</button></div><NfcDraftDetail key={selected.id} game={game} draft={selected} onAction={onAction} onChange={changed} onOpenReward={coupon => { rewardAfterClose.current = coupon; close(); }} /></>
        : <>
          <p>这些记录还没有正式发券。商家确认后才进入卡包；关闭抽屉不会删除草稿。</p>
          <div className="nfc-draft-actions"><button type="button" className="outline-button" disabled={loading || operation.busy} onClick={() => void loadPage(page?.page || 1)}><RefreshCw size={17} />{loading ? "读取中…" : "刷新领取草稿"}</button></div>
          {operation.pending && <div className="nfc-draft-notice"><p>原领取操作结果尚未确认，先核对同一个请求。</p><div className="nfc-draft-actions"><button type="button" className="gold-button" disabled={operation.busy} onClick={() => void recover()}>核对原操作结果</button>{operation.pending.checked && <button type="button" className="outline-button" disabled={operation.busy} onClick={() => void retry()}>重试同一次操作</button>}</div></div>}
          {page?.items.map(draft => <button type="button" key={draft.id} onClick={() => setSelected(draft)}><strong>{draft.reward}</strong><small>{draft.storeName} · {draft.taskTitle}</small><small>领取编号 {draft.id.slice(-8).toUpperCase()} · {draft.canConfirm && draft.permitUntil > Date.now() ? "可请商家确认" : "继续时需重新定位"}</small><small>保存于 {new Date(draft.createdAt).toLocaleString("zh-CN")}</small></button>)}
          {!loading && page && !page.items.length && <p className="nfc-draft-notice">这里空空如也。碰金币 NFC 申请奖励后，尚未发券的记录会保存在这里。</p>}
          {page && page.totalPages > 1 && <nav className="nfc-draft-pagination" aria-label="领取草稿分页"><button type="button" className="outline-button" disabled={loading || page.page <= 1} onClick={() => void loadPage(page.page - 1)}>上一页</button><span>第 {page.page} / {page.totalPages} 页</span><button type="button" className="outline-button" disabled={loading || page.page >= page.totalPages} onClick={() => void loadPage(page.page + 1)}>下一页</button></nav>}
        </>}
      {(error || operation.error) && <p className="inline-error" role="alert">{error || operation.error}</p>}
    </div>}</Drawer>}
  </>;
}
