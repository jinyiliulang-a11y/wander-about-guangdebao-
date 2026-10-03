"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import "./coupon-controls.css";
import "./my-feedback.css";

export type CardOrigin = { x: number; y: number; scale: number };
export function cardOrigin(element?: HTMLElement): CardOrigin {
  if (!element) return { x: 0, y: 0, scale: .72 };
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 - window.innerWidth / 2, y: rect.top + rect.height / 2 - window.innerHeight / 2, scale: Math.max(.16, Math.min(1, rect.width / Math.min(window.innerWidth * .88, 390))) };
}

export function ReferenceRouteLoader() {
  return <div className="route-loader" role="status" aria-live="polite" aria-label="正在加载"><div className="route-loader-card"><div className="route-animation"><svg viewBox="0 0 160 160" aria-hidden="true"><defs><clipPath id="reference-coin-mask"><circle cx="80" cy="80" r="58" /></clipPath></defs><circle className="coin-paper" cx="80" cy="80" r="58" /><g clipPath="url(#reference-coin-mask)"><path className="coin-crayon" pathLength={1} d="M28 20L28 140 46 20 46 140 64 20 64 140 82 20 82 140 100 20 100 140 118 20 118 140 136 20 136 140" /><circle className="route-runner" cx="0" cy="0" r="4"><animateMotion dur=".58s" fill="freeze" path="M28 20L28 140 46 20 46 140 64 20 64 140 82 20 82 140 100 20 100 140 118 20 118 140 136 20 136 140" /></circle></g><circle className="coin-rim" cx="80" cy="80" r="58" /></svg><div className="coin-stamp"><span>¥</span></div></div></div></div>;
}

/** Keep the dialog mounted until its reverse animation finishes. URL/history belongs to the parent. */
export function ReferenceCardModal({ title, kind, origin, onClose, children, reduceMotion = false }: {
  title: string; kind: "treasure" | "coupon"; origin: CardOrigin; onClose: () => void; children: ReactNode; reduceMotion?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const finished = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useCallback(() => { if (!finished.current) { finished.current = true; clearTimeout(timer.current); onClose(); } }, [onClose]);
  const close = useCallback(() => {
    if (reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { dismiss(); return; }
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, 600);
  }, [dismiss, reduceMotion]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const releaseScroll = acquireOverlayScroll();
    panel.current?.querySelector<HTMLElement>(".modal-close")?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === "Tab") {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>("button,input,textarea,select,[tabindex='0']") || []).filter(node => !node.hasAttribute("disabled") && node.offsetParent !== null);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); clearTimeout(timer.current); releaseScroll(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [close]);
  const vars = { [`--${kind}-x`]: `${origin.x}px`, [`--${kind}-y`]: `${origin.y}px`, [`--${kind}-scale`]: origin.scale } as CSSProperties;
  return <div className={`${kind}-modal reference-card-modal${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    <button className={`${kind}-backdrop`} onClick={close} aria-label={`关闭${kind === "treasure" ? "宝藏详情" : "优惠券"}`} tabIndex={-1} />
    <article ref={panel} className={`${kind === "treasure" ? "treasure-detail" : "enlarged-coupon"} modal`} style={vars} onAnimationEnd={event => { if (closing && event.target === event.currentTarget) dismiss(); }}>
      <div className="reference-card-close-anchor">
        <button className={`${kind === "treasure" ? "treasure-close" : "coupon-close"} modal-close`} onClick={close} aria-label="关闭"><X size={20} /></button>
      </div>
      {children}
    </article>
  </div>;
}
