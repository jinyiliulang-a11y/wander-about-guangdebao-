"use client";
import { useEffect, useRef } from "react";
import { couponQrMatrix } from "@/lib/coupon-qr";
export function CouponQr({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  let valid = true, dimension = 231;
  try { dimension = (couponQrMatrix(code).length + 8) * 7; } catch { valid = false; }
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !valid) return;
    const matrix = couponQrMatrix(code), scale = 7, quiet = 4;
    context.fillStyle = "#fff"; context.fillRect(0, 0, dimension, dimension);
    context.fillStyle = "#000";
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
  }, [code, valid, dimension]);
  return valid ? <div className="reward-qr"><canvas ref={canvas} width={dimension} height={dimension} role="img" aria-label="奖励券核销二维码" /><small>请商家扫码后核对并确认核销</small></div> : <small>请商家输入上方券码核销</small>;
}
