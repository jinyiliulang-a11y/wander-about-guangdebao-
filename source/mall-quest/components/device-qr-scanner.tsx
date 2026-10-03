"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Pause, X } from "lucide-react";
import { decodeCouponImage } from "@/lib/qr-decoder";
import "./device-qr-scanner.css";

/** Reads raw fixed device identity; authorization and issuance stay on the server. */
export function DeviceQrScanner({ onValue, onClose }: { onValue: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const generation = useRef(0), alive = useRef(false), delivered = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState("");
  const stop = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }, []);
  const pause = useCallback(() => { stop(); if (alive.current) { setBusy(false); setRunning(false); } }, [stop]);
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", pause);
    return () => { alive.current = false; stop(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", pause); };
  }, [pause, stop]);
  function deliver(raw: string) {
    if (!alive.current || delivered.current) return;
    const value = raw.trim();
    if (!value || value.length > 2048) { setError("设备二维码内容无效，请扫描金币屏幕上的设备码。"); return; }
    if (/^GTB-(?:D-)?[0-9A-F]+$/i.test(value)) { setError("这是个人优惠券码。这里需要金币设备码；个人券请在下方核销。"); return; }
    delivered.current = true; pause(); onValue(value);
  }
  async function start() {
    if (busy || delivered.current) return;
    stop(); const id = generation.current;
    const active = () => alive.current && !delivered.current && generation.current === id;
    setError(""); setBusy(true);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setBusy(false); setError("相机需要 HTTPS 或电脑本机地址。可以上传设备码图片，或关闭后粘贴设备码内容。"); return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!active()) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      if (!video.current) { pause(); return; }
      media.getVideoTracks().forEach(track => { track.onended = () => { if (active()) { pause(); setError("相机已断开，可以重新开启相机或上传图片。"); } }; });
      video.current.srcObject = media; await video.current.play();
      if (!active()) return;
      setBusy(false); setRunning(true);
      const scan = async () => {
        if (!active()) return;
        try {
          const element = video.current;
          if (element && element.readyState >= 2 && element.videoWidth && element.videoHeight) {
            const raw = await decodeCouponImage(element, element.videoWidth, element.videoHeight, { maxDimension: 960 });
            if (active() && raw) deliver(raw);
          }
        } catch { if (active()) setError("暂时无法识别，请调整二维码位置或上传清晰图片。"); }
        if (active()) timer.current = setTimeout(() => void scan(), 350);
      };
      void scan();
    } catch (cause) {
      if (!active()) return;
      pause();
      const name = (cause as DOMException)?.name;
      setError(name === "NotAllowedError" ? "相机权限未开启。请允许相机，或上传设备码图片。" : name === "NotFoundError" ? "没有可用相机。请上传设备码图片或粘贴内容。" : "相机无法启动。请重试，或上传设备码图片。");
    }
  }
  async function readFile(file?: File) {
    if (!file || delivered.current) return;
    pause(); const id = generation.current;
    const active = () => alive.current && !delivered.current && generation.current === id;
    if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.type) || file.size > 10 * 1024 * 1024) { setError("请选择不超过 10MB 的二维码图片。"); return; }
    setBusy(true); setError(""); const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图片无法读取，请换一张清晰图片。")); image.src = url; });
      if (!active()) return;
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("图片尺寸太大，请裁剪到设备二维码附近。");
      const raw = await decodeCouponImage(image, image.naturalWidth, image.naturalHeight);
      if (active()) { if (raw) deliver(raw); else setError("没有识别到二维码，请上传清晰、完整的设备码图片。"); }
    } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : "图片识别失败。"); }
    finally { URL.revokeObjectURL(url); if (active()) setBusy(false); }
  }
  return <section className="device-qr-scanner" aria-label="扫描金币设备码">
    <div className="device-qr-scanner-head"><h3><Camera size={19} />扫描金币设备码</h3><button type="button" className="icon-button" aria-label="关闭设备扫码" onClick={() => { pause(); onClose(); }}><X size={19} /></button></div>
    <p>扫描金币屏幕上的设备码。识别后还需核对待领记录，并由你确认发券。</p>
    <div className="device-qr-scanner-view"><video ref={video} muted playsInline hidden={!running} aria-label="设备扫码相机画面" />{!running && <span>{busy ? "正在处理…" : "点击开启相机后开始扫描"}</span>}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="device-qr-scanner-actions"><button type="button" className="outline-button" disabled={busy || running} onClick={() => void start()}><Camera size={17} />开启相机</button>{(running || busy) && <button type="button" className="outline-button" onClick={pause}><Pause size={17} />暂停相机</button>}<label className="outline-button"><ImagePlus size={17} />上传设备码图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" aria-label="上传金币设备码图片" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void readFile(file); }} /></label></div>
    <small>画面与图片只在当前浏览器识别，不上传；关闭时停止相机。</small>
  </section>;
}
