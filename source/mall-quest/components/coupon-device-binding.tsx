"use client";

import { useRef, useState } from "react";
import { Coins, RefreshCw } from "lucide-react";
import { deviceDisplayName } from "@/lib/device-display";
import { GameApiError, isGameApiError, isUncertainResult } from "@/lib/game-api";
import type { CouponTemplate, WorkbenchAction, WorkbenchData } from "./workbench-pages";
import { FormDialog } from "./common/FormDialog";

type Binding = { deviceId: string; templateId: string; expectedTaskId: string; expectedCouponId: string | null };
export function CouponDeviceBinding({ coupon, data, onAction, onClose }: {
  coupon: CouponTemplate; data: WorkbenchData; onAction: WorkbenchAction; onClose: () => void;
}) {
  const devices = data.devices.filter(device => device.storeId === coupon.storeId && device.enabled && device.boundTask);
  const [deviceId, setDeviceId] = useState(() => devices[0]?.id || "");
  const [pending, setPending] = useState<Binding | null>(null), [retryAvailable, setRetryAvailable] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const selected = devices.find(device => device.id === deviceId);
  async function save(event: React.FormEvent, close: () => void) {
    event.preventDefault();
    if (lock.current || pending || !selected?.boundTaskId) return;
    const payload: Binding = { deviceId: selected.id, templateId: coupon.id, expectedTaskId: selected.boundTaskId, expectedCouponId: selected.boundTask?.rewardCouponId || null };
    await submit(payload, close);
  }
  async function submit(payload: Binding, close: () => void) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setRetryAvailable(false); setError("");
    try {
      const result = await onAction("deviceCouponBind", payload) as { bound?: boolean; deviceId?: string; templateId?: string } | null;
      if (!result?.bound || result.deviceId !== payload.deviceId || result.templateId !== payload.templateId) throw new GameApiError("绑定结果还待核对，请查询当前设备状态。", { kind: "invalid-response", method: "POST", resultUncertain: true, requestSent: true });
      close();
    } catch (cause) {
      if (isUncertainResult(cause) || !isGameApiError(cause)) setPending(payload);
      else setPending(null);
      setError(cause instanceof Error ? cause.message : "绑定未完成，请保留窗口并核对。");
    } finally { lock.current = false; setBusy(false); }
  }
  async function check(close: () => void) {
    if (lock.current || !pending) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const current = await onAction("workbenchState", { range: data.stats.range }) as WorkbenchData | null;
      if (!current?.scope || current.scope.role !== data.scope.role || current.scope.storeId !== data.scope.storeId || !Array.isArray(current.devices)) throw new Error("当前门店身份或查询结果已变化，请回到原账号核对。");
      const device = current.devices.find(item => item.id === pending.deviceId && item.storeId === coupon.storeId);
      if (!device) throw new Error("当前设备状态暂时无法核对，请稍后查询。");
      if (device.boundTaskId === pending.expectedTaskId && device.boundTask?.rewardCouponId === pending.templateId) { setPending(null); close(); }
      else { setRetryAvailable(true); setError("已查询：设备当前未绑定这张券。可再次核对，或明确重试原绑定；重试保持原来的设备、券和活动。"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "绑定结果尚待核对。"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <FormDialog title="绑定金币设备" historyKey={`coupon-device:${coupon.id}`} busy={busy || !!pending} onClose={onClose}>
    {(close, cancel) => <form className="wb-form" onSubmit={event => void save(event, close)}>
      <p>将“{coupon.title}”用于这台金币的后续领取。已发出的券保持原条款。</p>
      <fieldset disabled={busy || !!pending}><label className="field-label">选择金币<select data-dialog-autofocus value={deviceId} onChange={event => setDeviceId(event.target.value)} required>
        {!devices.length && <option value="">暂无已接入的可用金币</option>}
        {devices.map(device => <option key={device.id} value={device.id}>{deviceDisplayName(device.id)} · {device.id}</option>)}
      </select></label>
      {selected?.boundTask && <p className="wb-note">当前活动：{selected.boundTask.title}。固定设备码：GTB-DEVICE:{selected.id}</p>}
      {!devices.length && <p>新设备接入后，可在这个窗口选择并绑定。请先使用本店已登记的测试金币。</p>}
      </fieldset>
      {error && <p className="wb-error" role="alert">{error}</p>}
      <div className="wb-actions">{pending ? <><button type="button" className="gold-button" disabled={busy} onClick={() => void check(close)}><RefreshCw size={16} />核对绑定结果</button>{retryAvailable && <button type="button" className="outline-button" disabled={busy} onClick={() => void submit(pending, close)}>重试原绑定</button>}</> : <>
        <button type="button" className="outline-button" disabled={busy} onClick={cancel}>取消</button>
        <button type="submit" className="gold-button" disabled={busy || !selected || coupon.status !== "active" || coupon.remaining <= 0}><Coins size={16} />{busy ? "绑定中…" : "确认绑定"}</button>
      </>}</div>
    </form>}
  </FormDialog>;
}
