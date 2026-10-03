"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { inspectStoreImage, STORE_IMAGE_MAX_BYTES, STORE_IMAGE_MAX_DIMENSION, STORE_IMAGE_TYPES, validateStoreImageURL } from "@/lib/store-image";
import "./store-image.css";

const labels = ["茶饮小店", "文具书房", "手作空间"];
export type StoreImageProps = { imageURL?: string; artwork?: number; alt?: string; className?: string };
export function StoreImage({ imageURL, artwork = 0, alt, className = "" }: StoreImageProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = useMemo(() => { try { return imageURL ? validateStoreImageURL(imageURL) : ""; } catch { return ""; } }, [imageURL]);
  const index = Number.isInteger(artwork) ? ((artwork % 3) + 3) % 3 : 0;
  return <div className={`store-art store-image${safe && failed !== safe ? " store-image-custom" : ""}${className ? ` ${className}` : ""}`} style={{ backgroundPosition: `${index * 50}% center` }} role={safe && failed !== safe ? undefined : "img"} aria-label={safe && failed !== safe ? undefined : alt || labels[index]}>
    {/* Stored data URIs are already compressed; no external image loader is used. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {safe && failed !== safe && <img src={safe} alt={alt || "门店图片"} onError={() => setFailed(safe)} loading="lazy" decoding="async" />}
  </div>;
}
async function compressedImage(file: File) {
  if (!STORE_IMAGE_TYPES.includes(file.type as typeof STORE_IMAGE_TYPES[number]) || file.size > 8 * 1024 * 1024) throw new Error("请选择不超过 8MB 的 PNG、JPEG 或 WebP 图片。");
  inspectStoreImage(new Uint8Array(await file.arrayBuffer()), file.type, 8 * 1024 * 1024, 16384);
  const objectURL = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图片无法打开，请换一张有效图片。")); image.src = objectURL; });
    let dimension = STORE_IMAGE_MAX_DIMENSION;
    for (let step = 0; step < 5; step++, dimension = Math.floor(dimension * .8)) {
      const ratio = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d"); if (!context) throw new Error("当前浏览器无法处理图片，请换用手机或电脑浏览器。");
      context.fillStyle = "#f5f7ef"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.88, .75, .6, .45]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob || blob.size > STORE_IMAGE_MAX_BYTES) continue;
        const result = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败，请重新选择。")); reader.readAsDataURL(blob); });
        return validateStoreImageURL(result);
      }
    }
    throw new Error("图片压缩后仍超过 500KB，请选择更小的图片。");
  } finally { URL.revokeObjectURL(objectURL); }
}
export function StoreImagePicker({ imageURL, artwork, disabled = false, onChange, onBusyChange }: { imageURL: string; artwork: number; disabled?: boolean; onChange: (next: { imageURL: string; artwork: number }) => void; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), sequence = useRef(0), input = useRef<HTMLInputElement>(null), busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { alive.current = true; const currentSequence = sequence; return () => { alive.current = false; currentSequence.current++; busyCallback.current?.(false); }; }, []);
  async function upload(file?: File) {
    if (!file || disabled || busy) return;
    const attempt = ++sequence.current; setBusy(true); setError(""); onBusyChange?.(true);
    try { const result = await compressedImage(file); if (alive.current && sequence.current === attempt) onChange({ imageURL: result, artwork }); }
    catch (failure) { if (alive.current && sequence.current === attempt) setError(failure instanceof Error ? failure.message : "未能处理图片，请重试。"); }
    finally { if (alive.current && sequence.current === attempt) { setBusy(false); onBusyChange?.(false); } if (input.current) input.current.value = ""; }
  }
  return <section className="store-image-picker" aria-label="门店展示图片" aria-busy={busy}>
    <div className="store-image-picker-intro"><h3>门店展示图片</h3><p>使用示例图，或上传一张自己的门店图片。替换后只保留新图片。</p></div>
    <div className="store-image-preview"><StoreImage imageURL={imageURL} artwork={artwork} alt="当前门店图片预览" /></div>
    <div className="store-image-samples" role="radiogroup" aria-label="选择示例门店图片">{labels.map((label, index) => <button key={label} type="button" role="radio" aria-checked={!imageURL && artwork === index} disabled={disabled || busy} onClick={() => { setError(""); onChange({ imageURL: "", artwork: index }); }}><StoreImage artwork={index} /><span>{label}</span></button>)}</div>
    <input ref={input} hidden className="store-image-file" type="file" aria-label="上传门店图片" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={event => void upload(event.target.files?.[0])} />
    <div className="store-image-picker-actions"><button type="button" className="outline-button" disabled={disabled || busy} onClick={() => input.current?.click()}><ImagePlus size={18} />{busy ? "正在处理图片…" : imageURL ? "替换门店图片" : "上传门店图片"}</button>{imageURL && <button type="button" className="outline-button" disabled={disabled || busy} onClick={() => { setError(""); onChange({ imageURL: "", artwork }); }}><RotateCcw size={18} />恢复示例图</button>}</div>
    <p className="store-image-picker-hint">支持 PNG、JPEG、WebP；保存时自动压缩到 500KB 内，最长边不超过 1280 像素。</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
