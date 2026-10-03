"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalHistory } from "@/hooks/use-modal-history";
import { acquireOverlayScroll, preserveOverlayHistoryScroll } from "@/lib/overlay-scroll";
import "./drawer.css";

const ENTER_MS = 300;
const EXIT_MS = 240;
const reducedMotion = () => document.documentElement.dataset.questReduceMotion === "true" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const offscreen = () => window.matchMedia("(min-width: 768px)").matches ? "translateX(calc(100% + 2px))" : "translateY(calc(100% + 2px))";

/** Mount only while open. History closes first; the parent unmounts after the reverse motion. */
export function Drawer({ title, historyKey, busy = false, onBeforeClose, onClose, children }: {
  title: string; historyKey: string; busy?: boolean; onBeforeClose?: () => boolean | Promise<boolean>; onClose: () => void; children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const headingId = useId();
  const panel = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose), busyRef = useRef(busy);
  const guardRef = useRef(onBeforeClose), historyCloseRef = useRef<() => void>(() => {});
  const guardRunning = useRef(false), guardApproved = useRef(false);
  const historyRestoring = useRef(false);
  const mounted = useRef(false), finished = useRef(false), closing = useRef(false), requested = useRef(false);
  const backdropPointer = useRef(false);
  const motion = useRef<Animation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [exiting, setExiting] = useState(false);
  const [guarding, setGuarding] = useState(false), [closeError, setCloseError] = useState("");
  const [historyGeneration, setHistoryGeneration] = useState(0);
  useEffect(() => { onCloseRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => { guardRef.current = onBeforeClose; }, [onBeforeClose]);

  const checkBeforeClose = useCallback(async () => {
    if (!mounted.current || guardRunning.current || closing.current || finished.current) return;
    guardRunning.current = true; setGuarding(true); setCloseError("");
    let allowed = false;
    try { allowed = (await guardRef.current?.()) !== false; }
    catch { if (mounted.current) setCloseError("离开前的保存未完成，请检查提示后重试。"); }
    if (!mounted.current) return;
    guardRunning.current = false; setGuarding(false);
    if (!allowed || closing.current || finished.current) return;
    // The child's flush completed. Consume the current modal history boundary
    // only now, so another Back cannot skip a save still in flight.
    guardApproved.current = true; requested.current = true;
    if (!historyRestoring.current) historyCloseRef.current();
  }, []);

  const finish = useCallback(() => {
    if (!mounted.current || finished.current) return;
    finished.current = true;
    clearTimeout(timer.current);
    motion.current?.cancel(); motion.current = null;
    // Native dialog restores its opener. Never schedule an old-page focus restoration.
    const scrollX = window.scrollX, scrollY = window.scrollY;
    if (panel.current?.open) panel.current.close();
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    onCloseRef.current();
  }, []);
  const exit = useCallback(() => {
    if (!mounted.current || closing.current || finished.current) return;
    preserveOverlayHistoryScroll();
    if (guardRunning.current) { historyRestoring.current = true; setHistoryGeneration(value => value + 1); return; }
    if (busyRef.current && !requested.current) { setHistoryGeneration(value => value + 1); return; }
    if (guardRef.current && !guardApproved.current) {
      // Native Back already consumed the modal entry. Restore it while the
      // same-page close waits for its draft flush, including a failed flush.
      historyRestoring.current = true; setHistoryGeneration(value => value + 1);
      void checkBeforeClose();
      return;
    }
    requested.current = true; closing.current = true;
    const dialog = panel.current;
    if (!dialog?.open || reducedMotion() || typeof dialog.animate !== "function") { finish(); return; }
    const current = getComputedStyle(dialog);
    const transform = current.transform, opacity = current.opacity;
    const backdropOpacity = getComputedStyle(dialog, "::backdrop").opacity;
    dialog.style.setProperty("--drawer-backdrop-start", backdropOpacity);
    dialog.dataset.phase = "closing";
    setExiting(true);
    // Capture the currently drawn position before cancelling an unfinished entrance.
    motion.current?.cancel();
    motion.current = dialog.animate([{ transform, opacity }, { transform: offscreen(), opacity: 1 }], {
      duration: EXIT_MS, easing: "cubic-bezier(.4,0,.8,.35)", fill: "both",
    });
    motion.current.onfinish = finish;
    timer.current = setTimeout(finish, EXIT_MS + 40);
  }, [checkBeforeClose, finish]);
  const closeHistory = useModalHistory(`${historyKey}:${historyGeneration}`, exit);
  useEffect(() => {
    historyCloseRef.current = closeHistory;
    if (!historyRestoring.current) return;
    // useModalHistory's preceding effect has installed the replacement entry.
    // A clean draft may approve in one microtask, before this effect runs.
    historyRestoring.current = false;
    if (guardApproved.current && requested.current) closeHistory();
  }, [closeHistory, historyGeneration]);
  const close = useCallback(() => {
    if (busyRef.current || guardRunning.current || requested.current || closing.current || finished.current) return;
    if (guardRef.current && !guardApproved.current) { void checkBeforeClose(); return; }
    requested.current = true;
    closeHistory();
  }, [checkBeforeClose, closeHistory]);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    mounted.current = true; finished.current = false; closing.current = false; requested.current = false;
    guardRunning.current = false; guardApproved.current = false;
    historyRestoring.current = false;
    const release = acquireOverlayScroll({ preserveHistoryScroll: true });
    const scrollX = window.scrollX, scrollY = window.scrollY;
    dialog.showModal();
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    closeButton.current?.focus({ preventScroll: true });
    if (!reducedMotion() && typeof dialog.animate === "function") {
      motion.current = dialog.animate([{ transform: offscreen(), opacity: .96 }, { transform: "translate(0,0)", opacity: 1 }], {
        duration: ENTER_MS, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both",
      });
      motion.current.onfinish = () => {
        if (!closing.current) { motion.current?.cancel(); motion.current = null; }
      };
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => {
      if (!reducedMotion()) return;
      if (closing.current) finish();
      else { motion.current?.cancel(); motion.current = null; }
    };
    const observer = new MutationObserver(preference);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-quest-reduce-motion"] });
    media.addEventListener("change", preference);
    return () => {
      mounted.current = false;
      observer.disconnect(); media.removeEventListener("change", preference);
      clearTimeout(timer.current); motion.current?.cancel(); motion.current = null;
      const active = document.activeElement;
      const outsideFocus = active instanceof HTMLElement && active !== document.body && !dialog.contains(active) ? active : null;
      if (dialog.open) dialog.close();
      release();
      // A route may already have focused its new content. Closing must preserve it.
      if (outsideFocus?.isConnected && document.activeElement !== outsideFocus) outsideFocus.focus({ preventScroll: true });
    };
  }, [finish]);

  const outside = (x: number, y: number) => {
    const rect = panel.current?.getBoundingClientRect();
    return !!rect && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom);
  };
  // The render prop receives an event callback; no callback ref is read until a close event.
  // eslint-disable-next-line react-hooks/refs -- Passing close to children does not invoke close during rendering.
  const content = typeof children === "function" ? children(close) : children;
  return <dialog ref={panel} className="quest-drawer" aria-labelledby={headingId} aria-modal="true" data-phase={exiting ? "closing" : "open"}
    onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]"))
        .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0);
      const first = nodes[0], last = nodes.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) { event.preventDefault(); first.focus({ preventScroll: true }); }
    }}
    onPointerDown={event => { backdropPointer.current = event.target === event.currentTarget && outside(event.clientX, event.clientY); }}
    onClick={event => {
      if (event.target === event.currentTarget && backdropPointer.current && outside(event.clientX, event.clientY)) close();
      backdropPointer.current = false;
    }}>
    <header className="quest-drawer-head"><h2 id={headingId}>{title}</h2><button ref={closeButton} type="button" className="quest-drawer-close"
      aria-label={`关闭${title}`} disabled={busy || guarding || exiting} onClick={close}><X size={20} /></button></header>
    <div className="quest-drawer-body" inert={exiting || guarding} aria-busy={exiting || guarding || undefined}>{closeError && <p role="status">{closeError}</p>}{content}</div>
  </dialog>;
}
