"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Pause, RotateCcw, SwitchCamera, X } from "lucide-react";
import { decodeCouponImage, parseCouponCode } from "@/lib/qr-decoder";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = { new (options: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
type CameraChoice = { id: string; label: string };

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("原生二维码识别超时")), milliseconds); })]);
  } finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}

function cameraMessage(issue: unknown): string {
  const name = (issue as DOMException)?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "相机权限未开启。请在浏览器设置中允许相机，或上传券码图片识别。";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "没有找到可用相机。请上传券码图片识别，或关闭后手动输入券码。";
  if (name === "NotReadableError" || name === "TrackStartError") return "相机可能被其他应用占用。请关闭正在使用相机的应用后重试，或上传券码图片识别。";
  if (name === "OverconstrainedError") return "当前镜头不可用，请切换其他相机，或上传券码图片识别。";
  if (name === "AbortError") return "相机启动被中断。请重试，或上传券码图片识别。";
  if (name === "SecurityError") return "浏览器阻止了相机访问。请检查网站相机权限，或上传券码图片识别。";
  return "暂时无法打开相机，请重试或上传券码图片识别。";
}

export function CouponScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null), video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null), timer = useRef<number | undefined>(undefined);
  const cameraGeneration = useRef(0), fileGeneration = useRef(0), mounted = useRef(false), delivered = useRef(false);
  const callbacks = useRef({ onCode, onClose }), selectedCamera = useRef("");
  const [error, setError] = useState(""), [cameraReady, setCameraReady] = useState(false);
  const [readingFile, setReadingFile] = useState(false), [startingCamera, setStartingCamera] = useState(false);
  const [cameras, setCameras] = useState<CameraChoice[]>([]), [cameraId, setCameraId] = useState("");

  useEffect(() => { callbacks.current = { onCode, onClose }; }, [onCode, onClose]);

  const stopCamera = useCallback(() => {
    cameraGeneration.current++;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }, []);

  const emitCode = useCallback((code: string) => {
    if (!mounted.current || delivered.current) return;
    delivered.current = true;
    fileGeneration.current++;
    stopCamera();
    setCameraReady(false); setStartingCamera(false); setReadingFile(false);
    callbacks.current.onCode(code);
  }, [stopCamera]);

  const pauseCamera = useCallback((message = "相机已暂停，可重试相机或上传券码图片。") => {
    fileGeneration.current++;
    stopCamera();
    if (mounted.current) { setCameraReady(false); setStartingCamera(false); setReadingFile(false); setError(message); }
  }, [stopCamera]);

  const startCamera = useCallback(async (requestedId = selectedCamera.current) => {
    if (!mounted.current || delivered.current) return;
    stopCamera(); fileGeneration.current++;
    const generation = cameraGeneration.current;
    const active = () => mounted.current && !delivered.current && generation === cameraGeneration.current;
    setError(""); setCameraReady(false); setReadingFile(false); setStartingCamera(true);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStartingCamera(false);
      setError("相机扫码需要 HTTPS 或电脑本机地址。当前可上传券码图片识别，或关闭后手动输入券码。");
      return;
    }
    try {
      const request = (id: string) => navigator.mediaDevices.getUserMedia({
        video: { ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      let media: MediaStream;
      try { media = await request(requestedId); }
      catch (issue) {
        if (!active()) return;
        if (requestedId && (issue as DOMException).name === "OverconstrainedError") {
          selectedCamera.current = ""; setCameraId(""); media = await request("");
        } else throw issue;
      }
      if (!active()) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const element = video.current;
      if (!element) { stopCamera(); return; }
      media.getVideoTracks().forEach(track => { track.onended = () => { if (active()) pauseCamera("相机已断开，请重试或上传券码图片识别。"); }; });
      element.srcObject = media; await element.play();
      if (!active()) return;
      setCameraReady(true); setStartingCamera(false);
      const actualId = media.getVideoTracks()[0]?.getSettings().deviceId || requestedId;
      if (actualId) { selectedCamera.current = actualId; setCameraId(actualId); }
      // Device names become available after permission; scanning need not wait for this list.
      if (navigator.mediaDevices.enumerateDevices) {
        void navigator.mediaDevices.enumerateDevices().then(devices => {
          if (active()) setCameras(devices.filter(device => device.kind === "videoinput" && device.deviceId).map((device, index) => ({ id: device.deviceId, label: device.label || `相机 ${index + 1}` })));
        }).catch(() => { /* The default rear camera still works if enumeration is restricted. */ });
      }
      let detector: Detector | null = null;
      try {
        const Constructor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
        if (Constructor && (!Constructor.getSupportedFormats || (await withTimeout(Constructor.getSupportedFormats(), 2_000)).includes("qr_code"))) detector = new Constructor({ formats: ["qr_code"] });
      } catch { /* Local jsQR works in browsers without native QR support. */ }
      let lastTime = element.currentTime, lastFrameAt = Date.now();
      const scan = async () => {
        if (!active()) return;
        try {
          const rawValues: string[] = [];
          if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
            if (element.currentTime !== lastTime) { lastTime = element.currentTime; lastFrameAt = Date.now(); }
            if (Date.now() - lastFrameAt > 12_000) { pauseCamera("相机画面已暂停，请重试相机或上传券码图片。"); return; }
            if (detector) {
              try { rawValues.push(...(await withTimeout(detector.detect(element), 900)).map(result => result.rawValue)); }
              catch { detector = null; }
            }
            if (!active()) return;
            const nativeCode = rawValues.map(parseCouponCode).find(Boolean);
            if (nativeCode) { emitCode(nativeCode); return; }
            // Some native implementations return no result for a valid frame.
            const softwareRaw = await decodeCouponImage(element, element.videoWidth, element.videoHeight, { maxDimension: 960 });
            if (softwareRaw) rawValues.push(softwareRaw);
          }
          if (!active()) return;
          const code = rawValues.map(parseCouponCode).find(Boolean);
          if (code) { emitCode(code); return; }
          if (rawValues.length) setError("这不是优惠券核销码，请扫描用户卡包中“发现卡”的核销二维码。");
        } catch (issue) { if (active()) setError((issue as Error).message || "二维码识别失败，请重试或上传券码图片。"); }
        if (active()) timer.current = window.setTimeout(scan, 300);
      };
      await scan();
    } catch (issue) {
      if (!active()) return;
      stopCamera(); setCameraReady(false); setStartingCamera(false); setError(cameraMessage(issue));
    }
  }, [emitCode, pauseCamera, stopCamera]);

  useEffect(() => {
    let cancelled = false;
    const files = fileGeneration;
    mounted.current = true;
    panel.current?.scrollIntoView({ block: "start" });
    queueMicrotask(() => { if (!cancelled) void startCamera(); });
    const hidden = () => { if (document.hidden) pauseCamera("切换到后台后相机已暂停。返回后可重试相机，或上传券码图片。"); };
    const leaving = () => pauseCamera();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leaving);
    return () => { cancelled = true; mounted.current = false; files.current++; stopCamera(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); };
  }, [pauseCamera, startCamera, stopCamera]);

  async function readFile(file: File | undefined) {
    if (!file || delivered.current) return;
    stopCamera(); setCameraReady(false); setStartingCamera(false); setReadingFile(false);
    const generation = ++fileGeneration.current;
    const active = () => mounted.current && !delivered.current && generation === fileGeneration.current;
    if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.type) || file.size > 10 * 1024 * 1024) {
      setError("请选择 PNG、JPG 或 WebP 等图片，大小不超过 10MB。"); return;
    }
    setReadingFile(true); setError("");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图片读取失败，请换一张清晰的券码图片")); image.src = url; });
      if (!active()) return;
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("图片尺寸太大，请裁剪二维码附近后重试");
      const raw = await decodeCouponImage(image, image.naturalWidth, image.naturalHeight);
      if (!active()) return;
      const code = raw && parseCouponCode(raw);
      if (code) emitCode(code);
      else setError(raw ? "图片里的二维码不是优惠券核销码，请上传用户卡包的核销二维码。" : "没有识别到二维码，请上传清晰、完整的券码图片。");
    } catch (issue) { if (active()) setError((issue as Error).message); }
    finally { URL.revokeObjectURL(url); if (active()) setReadingFile(false); }
  }

  const close = () => { fileGeneration.current++; stopCamera(); setCameraReady(false); setStartingCamera(false); setReadingFile(false); callbacks.current.onClose(); };
  const cycleCamera = () => {
    const index = cameras.findIndex(camera => camera.id === selectedCamera.current);
    const next = cameras[(index + 1) % cameras.length];
    if (next) { selectedCamera.current = next.id; setCameraId(next.id); void startCamera(next.id); }
  };

  return <section ref={panel} className="scanner-card panel" role="region" aria-label="扫描奖励券码">
    <div className="section-heading"><h3><Camera size={18} /> 扫码核销优惠券</h3><button type="button" className="icon-button" aria-label="关闭扫码" onClick={close}><X size={18} /></button></div>
    <div className="scanner-view"><video ref={video} muted playsInline hidden={!cameraReady} aria-label="扫码相机画面" />{!cameraReady && <div className="scanner-placeholder"><Camera size={30} /><span>{readingFile ? "正在识别图片…" : startingCamera ? "正在打开相机…" : "可使用相机或上传券码图片"}</span></div>}</div>
    {cameras.length > 1 && <label className="field-label scanner-device">扫码镜头<select aria-label="选择扫码镜头" value={cameraId} disabled={startingCamera || readingFile} onChange={event => { selectedCamera.current = event.currentTarget.value; setCameraId(event.currentTarget.value); void startCamera(event.currentTarget.value); }}><option value="">自动选择后置镜头</option>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select></label>}
    <p>请对准用户“我的卡包 → 查看发现卡”中的核销二维码。识别后先核对券信息，再确认核销。</p>
    {error && <p className="inline-error" role="status">{error}</p>}
    <div className="scanner-actions">
      <button type="button" className="outline-button" disabled={startingCamera || readingFile} onClick={() => void startCamera()}><RotateCcw size={16} /> 重试相机</button>
      {cameras.length > 1 && <button type="button" className="outline-button" disabled={startingCamera || readingFile} onClick={cycleCamera}><SwitchCamera size={16} /> 切换镜头</button>}
      {(cameraReady || startingCamera) && <button type="button" className="outline-button" onClick={() => pauseCamera()}><Pause size={16} /> 暂停相机</button>}
      <label className="outline-button scanner-upload"><ImagePlus size={16} /> {readingFile ? "识别中…" : "上传二维码图片"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" aria-label="上传券码图片" disabled={readingFile} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void readFile(file); }} /></label>
    </div>
    <small>相机与图片仅在当前浏览器识别，不上传画面。关闭后可手动输入券码。</small>
  </section>;
}
