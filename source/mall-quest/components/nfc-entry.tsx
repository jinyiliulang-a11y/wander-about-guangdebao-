"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { StaffState, Store } from "@/lib/game-types";
import { ChoiceField } from "./common/WorkbenchFields";

export type NfcEntryDevice = { id: string; storeId: string; enabled: boolean; boundTaskId: string | null };
export function NfcEntry({ store, data, devices }: { store: Store; data: StaffState; devices?: NfcEntryDevice[] }) {
  const [origin, setOrigin] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    const loopback = host === "localhost" || host.endsWith(".localhost") ||
      host === "localhost.localdomain" || /^127\./.test(host) ||
      host === "[::1]" || host === "0.0.0.0";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLocalOnly(loopback);
      if (!loopback) setOrigin(window.location.origin);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setMessage(""); });
    return () => { cancelled = true; };
  }, [store.id]);
  const task = data.tasks.find(item => item.storeId === store.id &&
    item.id === `quest-${store.id}` && item.status === "published");
  const boundDevices = task ? devices?.filter(item => item.storeId === store.id && item.enabled && item.boundTaskId === task.id) : undefined;
  const deviceId = boundDevices?.length === 1 ? boundDevices[0].id : boundDevices?.find(item => item.id === selectedDevice)?.id;
  const deviceReady = !task?.requiresNfcClaim || !!deviceId;
  const link = origin && task && deviceReady ? `${origin}/client/${task.requiresNfcClaim ? "nfc" : "coin"}/${encodeURIComponent(task.id)}${task.requiresNfcClaim && deviceId ? `?device=${encodeURIComponent(deviceId)}` : ""}` : "";

  async function copyLink() {
    if (!link) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("manual_copy");
      await navigator.clipboard.writeText(link);
      setMessage("入口网址已复制。请在 NFC 标签工具中添加 URL 记录并写入。");
    } catch {
      field.current?.focus();
      field.current?.select();
      try {
        if (document.execCommand("copy")) {
          setMessage("入口网址已复制。请在 NFC 标签工具中添加 URL 记录并写入。");
          return;
        }
      } catch { /* The selected text remains available for manual copying. */ }
      setMessage("网址已选中，请手动复制，再在 NFC 标签工具中写入。");
    }
  }

  return <div className="share-channel-guide">
    <h3>NFC 碰一碰入口</h3>
    <p>将下方网址作为 URL 记录写入金币 NFC 标签。顾客碰 NFC 并通过门店范围校验后建立待领记录；商家扫描金币设备码、核对玩家并接收金币，再确认发券。</p>
    {task?.requiresNfcClaim && boundDevices && <ChoiceField label="选择已绑定金币设备" value={deviceId || ""}
      options={[{ value: "", label: boundDevices.length ? "请选择写入标签对应的设备" : "没有启用且绑定本任务的金币" },
        ...boundDevices.map(item => ({ value: item.id, label: item.id }))]}
      onChange={value => { setSelectedDevice(value); setMessage(""); }} disabled={!boundDevices.length} />}
    {task?.requiresNfcClaim && deviceId && <p className="muted">商家扫描的固定设备码：<code style={{ overflowWrap: "anywhere" }}>{`GTB-DEVICE:${deviceId}`}</code>。它只识别设备，不是个人券，也不证明实物已交回。</p>}
    {link ? <>
      <label className="field-label">{task?.title}
        <textarea ref={field} readOnly rows={2} value={link} aria-label="NFC 任务入口网址"
          onFocus={event => event.target.select()} />
      </label>
      <button className="outline-button" type="button" onClick={copyLink}>
        <Copy size={16} />复制 NFC 入口
      </button>
    </> : <p className="muted">{localOnly
      ? "当前网址只能在这台电脑访问。请用手机可访问的局域网或线上网址进入商家端，再配置 NFC 入口。"
      : task && !deviceReady ? devices === undefined ? "设备列表尚未读取，请刷新商家工作台后选择具体金币。" : "请先选择启用且绑定当前任务的金币设备，再复制入口。" : "请先上线本店的演示任务，再配置金币入口。"}</p>}
    <p className="muted">写入后请用手机读回网址核对；地址或任务变化时重新写标签。玩家卡包二维码用于商家核销，不写入金币标签。手机定位需要 HTTPS；独立网页任务保留观察题。</p>
    {message && <p role="status">{message}</p>}
  </div>;
}
