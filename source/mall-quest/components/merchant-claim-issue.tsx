"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardPaste, FileClock, RefreshCw, ScanLine } from "lucide-react";
import type { Coupon, GameState } from "@/lib/game-types";
import type { MerchantIssueClaimResult, MerchantPendingClaims, NfcDraft, NfcDraftPage } from "@/lib/nfc-draft-types";
import { Drawer } from "./common/Drawer";
import { DeviceQrScanner } from "./device-qr-scanner";
import { draftActorKey, draftRequestId, useDraftMutation, validDraftCoupon, validDraftPage } from "./nfc-draft-client";
import "./nfc-draft-panels.css";

const devicePattern = /^GTB-DEVICE:([A-Za-z0-9_-]{3,64})$/;
type Props = { game: GameState; onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>; onIssued?: (coupon: Coupon) => void };
export function MerchantClaimIssue(props: Props) { return <MerchantClaimIssueContent key={[props.game.player.id, props.game.player.accountId || "", props.game.staff?.storeId || ""].join(":")} {...props} />; }
function MerchantClaimIssueContent({ game, onAction, onIssued }: Props) {
  const storeId = game.staff?.storeId || "";
  const operation = useDraftMutation(draftActorKey(game.player.id, game.player.accountId, storeId), onAction);
  const [code, setCode] = useState(""), [scanner, setScanner] = useState(false), [open, setOpen] = useState(false);
  const [view, setView] = useState<"queue" | "device">("device");
  const [data, setData] = useState<MerchantPendingClaims | null>(null), [queue, setQueue] = useState<NfcDraftPage | null>(null), [selected, setSelected] = useState<NfcDraft | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [issued, setIssued] = useState<Coupon | null>(null), [now, setNow] = useState(Date.now);
  const alive = useRef(false), sequence = useRef(0), lock = useRef(false);
  useEffect(() => { alive.current = true; const requestSequence = sequence; const timer = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; requestSequence.current++; clearInterval(timer); }; }, []);
  async function load(value: string, page = 1, show = false) {
    const deviceCode = value.trim(), match = devicePattern.exec(deviceCode);
    if (!match) { setError("请扫描或粘贴专用金币设备码（GTB-DEVICE:设备编号），不要使用任务网址或个人优惠券码。"); return; }
    const attempt = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await onAction("merchantPendingClaims", { deviceCode, page, pageSize: 20 }) as Partial<MerchantPendingClaims> | null;
      if (!alive.current || attempt !== sequence.current) return;
      const device = result?.device;
      if (!validDraftPage(result) || !device || device.code !== deviceCode || device.id !== match[1] || device.storeId !== storeId ||
          typeof device.name !== "string" || typeof device.storeName !== "string" || typeof device.taskId !== "string" ||
          result.items.some(row => row.storeId !== storeId || row.deviceId !== device.id || row.taskId !== device.taskId || row.state !== "pending")) throw new Error("设备与待领申请无法核对，请刷新本店工作台。");
      setData({ ...result, device }); setCode(deviceCode); setView("device"); setSelected(null); setIssued(null);
      if (show) { setOpen(true); setScanner(false); }
    } catch (cause) { if (alive.current && attempt === sequence.current) setError(cause instanceof Error ? cause.message : "暂时无法读取这枚金币的待领申请。"); }
    finally { if (alive.current && attempt === sequence.current) setLoading(false); }
  }
  async function loadQueue(page = 1, show = false) {
    const attempt = ++sequence.current; setLoading(true); setError("");
    try {
      const result = await onAction("merchantPendingQueue", { page, pageSize: 20 });
      if (!alive.current || attempt !== sequence.current) return;
      if (!validDraftPage(result) || result.items.some(row => row.storeId !== storeId || row.state !== "pending")) throw new Error("本店待领申请无法核对，请刷新商家工作台。");
      setQueue(result); setView("queue"); setSelected(null); setIssued(null);
      if (show) { setOpen(true); setScanner(false); }
    } catch (cause) { if (alive.current && attempt === sequence.current) setError(cause instanceof Error ? cause.message : "暂时无法读取待领申请。"); }
    finally { if (alive.current && attempt === sequence.current) setLoading(false); }
  }
  const ready = view === "device" && !!selected && selected.state === "pending" && selected.canConfirm && selected.permitUntil > now && !!data && selected.deviceId === data.device.id;
  const blocked = loading || operation.busy || !!operation.pending;
  const currentPage = view === "queue" ? queue : data;
  function accept(draft: NfcDraft, result: Record<string, unknown>, requestId: string, draftId: string) {
    return draft.id === draftId && draft.storeId === storeId && draft.state === "issued" && validDraftCoupon(result.coupon, draft) && result.coupon.id === requestId;
  }
  function finish(draft: NfcDraft, coupon: Coupon) {
    setSelected(draft); setIssued(coupon);
    setData(current => current ? { ...current, items: current.items.filter(row => row.id !== draft.id) } : current);
    setQueue(current => current ? { ...current, items: current.items.filter(row => row.id !== draft.id) } : current);
    onIssued?.(coupon);
  }
  async function confirm() {
    if (lock.current || blocked || !ready || !selected || !data) return;
    lock.current = true; setError(""); const requestId = draftRequestId(), draftId = selected.id;
    try {
      const result = await operation.run("merchantIssueClaim", { draftId, requestId, expectedRevision: selected.revision, deviceCode: data.device.code, receivedDevice: true }, (draft, reply) => accept(draft, reply, requestId, draftId)) as MerchantIssueClaimResult | null;
      if (alive.current && result) finish(result.draft, result.coupon);
    } finally { lock.current = false; }
  }
  async function recover() {
    const result = await operation.recover();
    if (alive.current && result?.draft && result.draft.storeId === storeId && result.coupon && validDraftCoupon(result.coupon, result.draft)) finish(result.draft, result.coupon);
  }
  async function retry() {
    const original = operation.pending;
    if (!original || typeof original.payload.draftId !== "string") return;
    const draftId = original.payload.draftId, requestId = original.requestId;
    const result = await operation.retry((draft, reply) => accept(draft, reply, requestId, draftId)) as MerchantIssueClaimResult | null;
    if (alive.current && result) finish(result.draft, result.coupon);
  }
  if (game.staff?.role !== "merchant" || !storeId) return null;
  const recovery = operation.pending && <div className="nfc-draft-notice"><p>原领取确认结果尚未确定。请先查询原确认编号，避免重复确认。</p><div className="nfc-draft-actions"><button type="button" className="gold-button" disabled={operation.busy} onClick={() => void recover()}><RefreshCw size={17} />核对原确认结果</button>{operation.pending.checked && <button type="button" className="outline-button" disabled={operation.busy} onClick={() => void retry()}>重试同一次确认</button>}</div></div>;
  const scanPanel = scanner && <DeviceQrScanner onValue={value => { setCode(value); setScanner(false); void load(value, 1, true); }} onClose={() => setScanner(false)} />;
  const codeInput = <><label className="field-label">金币专用设备码<textarea aria-label="金币专用设备码" rows={2} maxLength={100} placeholder="GTB-DEVICE:coin-tea-01" value={code} disabled={!!operation.pending || operation.busy} onChange={event => setCode(event.target.value)} /></label><div className="nfc-draft-actions"><button type="button" className="outline-button" disabled={blocked || !code.trim()} onClick={() => void load(code, 1, true)}><ClipboardPaste size={17} />{loading ? "正在核对设备…" : "识别设备，查看待领申请"}</button></div></>;
  return <section className="surface merchant-claim-panel" aria-label="金币领取确认">
    <h2>金币领取确认</h2><p>扫描金币设备码，核对玩家并确认收到金币后，奖励会进入玩家卡包。玩家以后使用优惠券时，在下方办理核销。</p>
    <div className="nfc-draft-actions"><button type="button" className="outline-button" disabled={blocked} onClick={() => void loadQueue(1, true)}><FileClock size={19} />查看待领申请</button><button type="button" className="gold-button" disabled={blocked || scanner} onClick={() => { setScanner(true); setError(""); }}><ScanLine size={19} />扫描金币设备码</button>{data && <button type="button" className="outline-button" disabled={loading || operation.busy} onClick={() => void load(data.device.code, data.page, true)}>查看这枚金币的待领申请</button>}</div>
    {codeInput}
    <small>设备码固定且可重复扫描，只识别已登记金币；扫码本身不会自动确认领取，也不证明实物已经交回。</small>
    {!open && scanPanel}
    {recovery}
    {(error || operation.error) && <p className="inline-error" role="alert">{error || operation.error}</p>}
    {open && currentPage && <Drawer title={view === "queue" ? "待领申请" : data!.device.name + " · 待领申请"} historyKey="merchant-claim-list" onClose={() => { setOpen(false); setScanner(false); sequence.current++; setLoading(false); }}><div className="merchant-claim-panel">
      <p>{view === "queue" ? (game.stores.find(store => store.id === storeId)?.name || "当前门店") + " · 全部待领申请" : data!.device.storeName + " · " + data!.device.id}</p><p>{view === "queue" ? "可以查看待领申请和玩家编号。确认领取前，请扫描对应金币的设备码；选择申请不会自动生成设备码，也不会将奖励放入玩家卡包。" : "请核对领取编号与玩家，确认已收到实物金币后，再点击“确认领取”。"}</p>
      <div className="nfc-draft-actions"><button type="button" className="outline-button" disabled={loading || operation.busy} onClick={() => { if (view === "queue") void loadQueue(currentPage.page); else if (data) void load(data.device.code, currentPage.page); }}><RefreshCw size={17} />{loading ? "正在刷新…" : view === "queue" ? "刷新待领申请" : "刷新该设备待领申请"}</button></div>
      {issued && selected && <div className="nfc-draft-notice" role="status"><strong><CheckCircle2 size={18} />奖励已发放</strong><p>{selected.playerNickname} · {issued.reward}</p><p>{issued.rewardType === "points" ? "积分已经入账，无需个人券核销。" : issued.redeemedAt ? "该券已发放，当前已核销。" : "正式券已进入玩家卡包，当前尚未核销；消费时再扫描个人券码。"}</p></div>}
      {currentPage.items.map(draft => <button type="button" className="merchant-claim-choice" key={draft.id} aria-pressed={selected?.id === draft.id} disabled={operation.busy || !!operation.pending} onClick={() => { setSelected(draft); setIssued(null); setError(""); }}><strong>{draft.playerNickname} · 领取编号 {draft.id.slice(-8).toUpperCase()}</strong><small>{draft.reward} · {draft.taskTitle}</small><small>{view === "queue" ? "金币 " + draft.deviceId + " · " : ""}{draft.canConfirm && draft.permitUntil > now ? "到店许可有效" : "请玩家主动更新到店定位"} · {new Date(draft.createdAt).toLocaleString("zh-CN")}</small></button>)}
      {!loading && !currentPage.items.length && <p className="nfc-draft-notice">{view === "queue" ? "本店暂无待领申请。玩家碰 NFC 保存申请后会显示在这里。" : "这枚金币目前没有待领申请。请玩家先碰 NFC 建立申请，再刷新这里。"}</p>}
      {selected?.state === "pending" && <div className="nfc-draft-notice"><strong>已选：{selected.playerNickname} · {selected.id.slice(-8).toUpperCase()}</strong><p>{selected.reward}</p><p>金币设备：{selected.deviceId}</p>{view === "queue" ? <><p>请扫描这枚金币的设备码。识别后将显示该设备的最新待领申请，再次选择正确申请，核对领取编号与玩家，收到实物金币后再点击“确认领取”。</p><div className="nfc-draft-actions"><button type="button" className="gold-button" disabled={blocked || scanner} onClick={() => { setScanner(true); setError(""); }}><ScanLine size={18} />扫描此金币继续确认</button></div></> : <><p>{ready ? "请当面核对领取编号与玩家，确认已收到实物金币后，再点击“确认领取”。" : "当前到店许可失效。请玩家重新定位，再刷新待领申请。"}</p><div className="nfc-draft-actions"><button type="button" className="gold-button" disabled={blocked || !ready} onClick={() => void confirm()}>{operation.busy ? "正在确认…" : "确认领取"}</button></div></>}</div>}
      {scanPanel}
      {view === "queue" && scanner && <div className="merchant-claim-manual"><p>相机无法使用时，可以原样粘贴金币屏幕上的设备码；不会采用申请列表里的编号代替扫码。</p>{codeInput}</div>}
      {recovery}
      {(error || operation.error) && <p className="inline-error" role="alert">{error || operation.error}</p>}
      {currentPage.totalPages > 1 && <nav className="nfc-draft-pagination" aria-label={view === "queue" ? "待领申请分页" : "设备待领申请分页"}><button type="button" className="outline-button" disabled={loading || operation.busy || currentPage.page <= 1} onClick={() => { if (view === "queue") void loadQueue(currentPage.page - 1); else if (data) void load(data.device.code, currentPage.page - 1); }}>上一页</button><span>第 {currentPage.page} / {currentPage.totalPages} 页</span><button type="button" className="outline-button" disabled={loading || operation.busy || currentPage.page >= currentPage.totalPages} onClick={() => { if (view === "queue") void loadQueue(currentPage.page + 1); else if (data) void load(data.device.code, currentPage.page + 1); }}>下一页</button></nav>}
    </div></Drawer>}
  </section>;
}
