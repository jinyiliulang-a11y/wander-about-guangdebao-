"use client";
import { isAppPath, stripAppPath } from "@/lib/application-scope";

import { useEffect, useRef, useState } from "react";
import { Nfc, RefreshCw, Ticket, X } from "lucide-react";
import { readBrowserLocation } from "@/lib/browser-location";
import type { Coupon, GameState, Task } from "@/lib/game-types";
import type { NfcDraft } from "@/lib/nfc-draft-types";
import { Drawer } from "./common/Drawer";
import { NfcDraftDetail } from "./nfc-draft-detail";
import { draftActorKey, draftRequestId, useDraftMutation } from "./nfc-draft-client";
import "./nfc-coupon-flow.css";

export type NfcCouponFlowProps = {
  game: GameState; task: Task;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onOpenReward: (coupon: Coupon) => void; onNewReward?: (coupon: Coupon) => void;
  tagEntry?: boolean; entryToken?: string; deviceId?: string;
  onRefresh?: () => void | Promise<void>; onBusyChange?: (busy: boolean) => void; onLogin?: () => void;
};
type NdefRecord = { recordType: string; data: DataView };
type NdefReading = Event & { message: { records: NdefRecord[] } };
type NdefReader = EventTarget & { scan: (options: { signal: AbortSignal }) => Promise<void> };
type NfcSource = { entryToken?: string; deviceId?: string };
function source(url: URL): NfcSource {
  const tokens = url.searchParams.getAll("entry"), devices = [...url.searchParams.getAll("device"), ...url.searchParams.getAll("deviceId")];
  if (tokens.length > 1 || tokens.some(token => !token || token.length > 512) || devices.length > 1 || devices.some(id => !/^[A-Za-z0-9_-]{3,64}$/.test(id))) throw new Error("金币入口参数不明确，请重新配置正确的 NFC 网址。");
  return { ...(tokens.length ? { entryToken: tokens[0] } : {}), ...(devices.length ? { deviceId: devices[0] } : {}) };
}
function matchingNfcRecord(reading: NdefReading, task: Task): NfcSource | null {
  for (const record of reading.message.records) {
    if (record.recordType !== "url") continue;
    try {
      const url = new URL(new TextDecoder().decode(record.data));
      if (url.origin !== window.location.origin || url.username || url.password || url.hash) continue;
      if (!isAppPath(url.pathname)) continue;
      const route = /^\/client\/(?:nfc|coin)\/([^/]+)\/?$/.exec(stripAppPath(url.pathname));
      if (!route) continue;
      const id = decodeURIComponent(route[1]);
      if (id === task.id || id === "quest-" + task.storeId) return source(url);
    } catch { /* Unrelated or ambiguous tag contents cannot start a request. */ }
  }
  return null;
}
export function NfcCouponFlow(props: NfcCouponFlowProps) {
  return <NfcCouponFlowContent key={[props.game.player.id, props.game.player.accountId || "", props.task.id].join(":")} {...props} />;
}
function NfcCouponFlowContent({ game, task, onAction, onOpenReward, onNewReward, tagEntry = false, entryToken, deviceId, onRefresh, onBusyChange, onLogin }: NfcCouponFlowProps) {
  const operation = useDraftMutation(draftActorKey(game.player.id, game.player.accountId), onAction);
  const [draft, setDraft] = useState<NfcDraft | null>(null), [draftOpen, setDraftOpen] = useState(false);
  const [supported, setSupported] = useState(false), [secure, setSecure] = useState(true);
  const [scanning, setScanning] = useState(false), [locating, setLocating] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), sequence = useRef(0), lock = useRef(false), scanner = useRef<AbortController | null>(null);
  const scannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null), rewardAfterClose = useRef<Coupon | null>(null);
  const existing = game.coupons.find(item => !item.demo && item.storeId === task.storeId);
  const working = operation.busy || scanning || locating;
  function stopScanner() { scanner.current?.abort(); scanner.current = null; if (scannerTimer.current) clearTimeout(scannerTimer.current); scannerTimer.current = null; }
  useEffect(() => {
    const requestSequence = sequence;
    alive.current = true;
    queueMicrotask(() => { if (alive.current) { setSecure(window.isSecureContext); setSupported(window.isSecureContext && "NDEFReader" in window); } });
    return () => { alive.current = false; requestSequence.current++; stopScanner(); };
  }, []);
  useEffect(() => { onBusyChange?.(working || !!operation.pending); }, [working, operation.pending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function prepare(read?: NfcSource) {
    if (lock.current || operation.pending || !task.requiresNfcClaim || !game.player.accountAuthenticated) return;
    lock.current = true; stopScanner(); setScanning(false); setLocating(true); setError(""); const attempt = ++sequence.current;
    try {
      const tag = read || (tagEntry ? source(new URL(window.location.href)) : {});
      const location = await readBrowserLocation();
      if (!alive.current || sequence.current !== attempt) return;
      const token = tag.entryToken ?? entryToken, selectedDevice = tag.deviceId ?? deviceId;
      const id = draftRequestId();
      const result = await operation.run("nfcClaim", { taskId: task.id, requestId: id, location: Object.freeze({ ...location }), ...(token === undefined ? {} : { entryToken: token }), ...(selectedDevice === undefined ? {} : { deviceId: selectedDevice }) }, next => next.id === id && next.playerId === game.player.id && next.taskId === task.id && next.storeId === task.storeId);
      if (alive.current && result) { setDraft(result.draft); setDraftOpen(true); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "未能建立待领记录。"); }
    finally { lock.current = false; if (alive.current) setLocating(false); }
  }
  async function scan() {
    if (working || operation.pending || lock.current) return;
    if (!window.isSecureContext || !("NDEFReader" in window)) { setError("当前浏览器无法在网页内读取 NFC，请碰已配置的领取网址标签。定位仍需要 HTTPS。"); return; }
    const Constructor = (window as unknown as { NDEFReader: new () => NdefReader }).NDEFReader;
    const reader = new Constructor(), controller = new AbortController(); scanner.current = controller; setScanning(true); setError("");
    const onReading = (event: Event) => {
      if (scanner.current !== controller || controller.signal.aborted || !alive.current) return;
      const match = matchingNfcRecord(event as NdefReading, task);
      if (!match) { setError("读到的 NFC 标签与当前门店不匹配，请碰这家店的金币标签。"); return; }
      stopScanner(); void prepare(match);
    };
    const onError = () => { if (alive.current && scanner.current === controller) setError("暂时无法读取标签，请调整手机位置重试。"); };
    reader.addEventListener("reading", onReading); reader.addEventListener("readingerror", onError);
    controller.signal.addEventListener("abort", () => { reader.removeEventListener("reading", onReading); reader.removeEventListener("readingerror", onError); }, { once: true });
    try {
      await reader.scan({ signal: controller.signal });
      if (controller.signal.aborted || scanner.current !== controller) return;
      scannerTimer.current = setTimeout(() => { stopScanner(); if (alive.current) { setScanning(false); setError("本次没有读到金币标签，请开启 NFC 后重新碰一碰。"); } }, 45_000);
    } catch (cause) {
      if (controller.signal.aborted) return;
      stopScanner(); if (alive.current) { setScanning(false); setError(cause instanceof Error && cause.name === "NotAllowedError" ? "请允许本网站读取 NFC，或使用标签网址入口。" : "NFC 读取无法启动，请检查手机与浏览器支持情况。"); }
    }
  }
  async function recover() {
    const result = await operation.recover();
    if (alive.current && result?.draft && result.draft.playerId === game.player.id) { setDraft(result.draft); setDraftOpen(true); }
  }
  async function retry() {
    const result = await operation.retry(next => next.playerId === game.player.id);
    if (alive.current && result) { setDraft(result.draft); setDraftOpen(true); }
  }
  function changed(next: NfcDraft) {
    setDraft(next);
    if (next.state === "issued") {
      if (next.coupon && !game.coupons.some(item => item.id === next.coupon?.id)) onNewReward?.(next.coupon);
      try { const result = onRefresh?.(); if (result) void result.catch(() => {}); } catch { /* The exact saved result remains visible. */ }
    }
  }
  if (!task.requiresNfcClaim) return null;
  if (!game.player.accountAuthenticated) return <section className="nfc-coupon-flow" aria-label="NFC 领取奖励"><div className="nfc-coupon-flow-heading"><Nfc size={21} /><div><h3>登录后申请奖励</h3><p>寻宝者和探索者使用同一个玩家账号。</p></div></div><p>登录后主动检查门店范围，建立待商家确认的领取记录。</p>{onLogin && <button type="button" className="gold-button" onClick={onLogin}>登录领取</button>}</section>;
  return <>
    <section className="nfc-coupon-flow" aria-label="NFC 领取奖励" aria-busy={working}>
      <div className="nfc-coupon-flow-heading"><Nfc size={21} /><div><h3>碰 NFC，申请这份奖励</h3><p>进入门店范围后保存待领记录；商家扫描金币设备码、核对玩家并确认发券，正式奖励才会进入卡包。</p></div></div>
      {tagEntry && !draft && !existing && <p className="nfc-coupon-flow-notice">已打开 NFC 领取入口。点击下方按钮授权定位并建立待领记录；打开网址本身不证明实际碰触。</p>}
      {!tagEntry && !supported && !existing && <p className="nfc-coupon-flow-notice">当前浏览器不支持网页内 NFC 读取。请碰已配置的标签领取网址；iPhone 使用标签网址入口。</p>}
      {(error || operation.error) && <p className="nfc-coupon-flow-error" role="alert">{error || operation.error}</p>}
      {!!operation.pending && <p className="nfc-coupon-flow-notice">原操作结果尚未确认。先查询原请求；确认未找到后才可明确重试同一个编号及原输入。</p>}
      <div className="nfc-coupon-flow-actions">
        {operation.pending ? <><button type="button" className="gold-button" disabled={working} onClick={() => void recover()}><RefreshCw size={18} />核对原申请</button>{operation.pending.checked && <button type="button" className="outline-button" disabled={working} onClick={() => void retry()}>重试同一次申请</button>}</>
          : existing ? <button type="button" className="gold-button" onClick={() => onOpenReward(existing)}><Ticket size={18} />查看已有正式奖励</button>
          : draft && draft.state !== "deleted" ? <button type="button" className="gold-button" onClick={() => setDraftOpen(true)}><Ticket size={18} />继续查看待领记录</button>
          : <button type="button" className="gold-button" disabled={working || !secure || !tagEntry && !supported} onClick={() => { if (tagEntry) void prepare(); else void scan(); }}><Nfc size={18} />{scanning ? "请贴近 NFC 标签…" : locating ? "正在检查门店范围…" : operation.busy ? "正在保存待领记录…" : tagEntry ? "检查范围并申请奖励" : "碰 NFC，申请奖励"}</button>}
        {scanning && <button type="button" className="outline-button" onClick={() => { stopScanner(); setScanning(false); }}><X size={18} />停止读取</button>}
      </div>
      <small>待领记录不发券、不扣库存。关闭后可从“我的卡包 → 领取草稿”继续或删除；正式券以后再核销。</small>
    </section>
    {draftOpen && draft && <Drawer title="待领取奖励" historyKey={"nfc-pending-" + draft.id} onClose={() => { setDraftOpen(false); const coupon = rewardAfterClose.current; rewardAfterClose.current = null; if (coupon) onOpenReward(coupon); }}>{close => <><NfcDraftDetail key={draft.id} game={game} draft={draft} onAction={onAction} onChange={changed} onOpenReward={coupon => { rewardAfterClose.current = coupon; close(); }} /><div className="nfc-draft-actions" style={{ marginTop: 20 }}><button type="button" className="outline-button" onClick={close}>{draft.state === "pending" ? "关闭并保留草稿" : "关闭"}</button></div></>}</Drawer>}
  </>;
}
