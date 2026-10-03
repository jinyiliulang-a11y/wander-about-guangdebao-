"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import "./network-status.css";

export function NetworkStatus({ onRefresh, busy = false }: { onRefresh: () => Promise<unknown>; busy?: boolean }) {
  const { status, beginCheck, finishCheck } = useNetworkStatus();
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (status.phase === "unknown" || status.phase === "healthy") return null;
  const offline = status.phase === "offline", recovered = status.phase === "recovered";
  const Icon = offline ? WifiOff : recovered ? CheckCircle2 : CloudOff;
  const title = offline ? "当前设备已离线" : recovered ? "已重新连通服务器" : status.phase === "recovering" ? "网络已连接，等待服务确认" : "暂时无法确认服务器连接";
  const description = offline ? "连接网络后，可刷新确认最新状态。" : recovered ? "保存、领奖和核销结果以最新记录为准。" : "如刚提交过操作，请先核对记录，再决定是否重试。";
  return <aside className="quest-network-notice" data-network-phase={status.phase} role="status" aria-live="polite" aria-atomic="true">
    <Icon size={20} aria-hidden="true" />
    <div><strong>{title}</strong><p>{description}</p></div>
    <button type="button" disabled={offline || checking || busy} onClick={async () => {
      if (checkingRef.current || busy || !beginCheck()) return;
      checkingRef.current = true; setChecking(true);
      try { await onRefresh(); } catch { /* The shared transport and owning screen explain errors. */ }
      finally { checkingRef.current = false; if (mounted.current) { finishCheck(); setChecking(false); } }
    }}><RefreshCw size={15} aria-hidden="true" />{checking ? "确认中" : "刷新确认"}</button>
  </aside>;
}
