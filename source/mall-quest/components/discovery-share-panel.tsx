"use client";
import { useState } from "react";
import { Copy, Download, Image, MessageCircle, Share2 } from "lucide-react";
import { discoveryShare } from "@/lib/discovery-share";
import type { Coupon } from "@/lib/game-types";
import "./discovery-share-panel.css";

export function DiscoverySharePanel({ coupon, origin, onCopy, notify, onGenerated }: {
  coupon: Coupon;
  origin: string;
  onCopy: (value: string) => Promise<boolean>;
  notify: (message: string) => void;
  onGenerated?: () => Promise<unknown>;
}) {
  const [channel, setChannel] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const share = discoveryShare(coupon, origin);
  async function poster() {
    setBusy(true); setError("");
    try { const { downloadDiscoveryPoster } = await import("@/lib/discovery-poster"); await downloadDiscoveryPoster(coupon); notify("发现卡图片已生成"); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function choose(value: string) {
    setChannel(value); setError("");
    if (onGenerated) {
      try { await onGenerated(); }
      catch { setError("分享文案已生成，次数暂未同步。可以继续发送。"); }
    }
    if (value === "复制链接") await onCopy(share.link);
    if (value === "生成海报") await poster();
    if (value === "微信好友" && navigator.share) {
      setBusy(true);
      try { await navigator.share({ title: `逛道宝 · ${share.title}`, text: share.text.replace(`\n${share.link}`, ""), url: share.link }); }
      catch (e) {
        if ((e as Error).name === "AbortError") notify("已取消系统分享");
        else setError("暂时无法打开系统分享，可复制文案后发送。");
      } finally { setBusy(false); }
    }
  }
  return <div className="discovery-share-panel">
    <p className="muted">把发现带给朋友。分享内容不包含你的奖励码。</p>
    <div className="share-channel-grid">{[
      { label: "微信好友", description: "系统分享或复制文案", icon: MessageCircle },
      { label: "朋友圈", description: "保存图片后发布", icon: Share2 },
      { label: "复制链接", description: "发送这条谜题", icon: Copy },
      { label: "生成海报", description: "保存发现卡图片", icon: Image },
    ].map(item => <button className={channel === item.label ? "selected" : ""} key={item.label} disabled={busy} onClick={() => choose(item.label)} aria-pressed={channel === item.label}>
      <item.icon size={24} /><strong>{item.label}</strong><small>{item.description}</small>
    </button>)}</div>
    {channel && <section className="share-channel-guide" aria-live="polite">
      <h3>{channel}</h3>
      <p>{channel === "朋友圈" ? "保存发现卡，再打开微信朋友圈选择图片并粘贴文案。" : channel === "微信好友" ? "可用系统分享选择微信；也可以复制下方文案，在微信里发送给好友。" : channel === "生成海报" ? "图片会保存到浏览器的下载位置，再通过你常用的聊天工具发送。" : "链接指向这条谜题。若无法自动复制，可手动选择下方文案。"}</p>
      <label className="field-label">分享文案<textarea readOnly aria-label="发现分享文案" rows={5} value={share.text} onFocus={e => e.target.select()} /></label>
      <div className="share-guide-actions"><button className="outline-button" disabled={busy} onClick={() => onCopy(share.text)}><Copy size={16} /> 复制分享文案</button>{(channel === "朋友圈" || channel === "生成海报") && <button className="gold-button" disabled={busy} onClick={poster}><Download size={16} />{busy ? "正在生成…" : "保存海报"}</button>}</div>
    </section>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <p className="share-limit-note">生成分享文案计入站内分享成就，同任务每天记一次；这不代表好友已收到。微信与朋友圈由你选择发送，本机链接需换成朋友可访问的网址。</p>
  </div>;
}
