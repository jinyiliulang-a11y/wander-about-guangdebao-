"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalHistory } from "@/hooks/use-modal-history";
import { acquireOverlayScroll, preserveOverlayHistoryScroll } from "@/lib/overlay-scroll";
import "./form-dialog.css";

const ENTER_MS = 320, EXIT_MS = 260;
const reducedMotion = () => document.documentElement.dataset.questReduceMotion === "true" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A top-layer form, unaffected by transforms on the animated workspace view. */
export function FormDialog({ title, historyKey, busy = false, onClose, children }: {
  title: string; historyKey: string; busy?: boolean; onClose: () => void;
  children: (closeAfterSave: () => void, cancel: () => void) => ReactNode;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose), busyRef = useRef(busy);
  const mounted = useRef(false), finished = useRef(false), closing = useRef(false), requested = useRef(false);
  const backdropPointer = useRef(false), motion = useRef<Animation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [exiting, setExiting] = useState(false);
  const [historyGeneration, setHistoryGeneration] = useState(0);
  useEffect(() => { onCloseRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);

  const finish = useCallback(() => {
    if (!mounted.current || finished.current) return;
    finished.current = true;
    clearTimeout(timer.current); motion.current?.cancel(); motion.current = null;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    if (panel.current?.open) panel.current.close();
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    onCloseRef.current();
  }, []);
  const exit = useCallback(() => {
    if (!mounted.current || closing.current || finished.current) return;
    preserveOverlayHistoryScroll();
    // A same-page browser Back cannot discard a pending write. Recreate its boundary.
    if (busyRef.current && !requested.current) { setHistoryGeneration(value => value + 1); return; }
    closing.current = true;
    const dialog = panel.current;
    if (!dialog?.open || reducedMotion() || typeof dialog.animate !== "function") { finish(); return; }
    const current = getComputedStyle(dialog);
    const transform = current.transform, opacity = current.opacity;
    dialog.style.setProperty("--form-backdrop-start", getComputedStyle(dialog, "::backdrop").opacity);
    dialog.dataset.phase = "closing"; setExiting(true);
    motion.current?.cancel();
    motion.current = dialog.animate([{ transform, opacity }, { transform: "translateY(8px) scale(.995)", opacity: 0 }], {
      duration: EXIT_MS, easing: "cubic-bezier(.4,0,.2,1)", fill: "both",
    });
    motion.current.onfinish = finish;
    timer.current = setTimeout(finish, EXIT_MS + 40);
  }, [finish]);
  const closeHistory = useModalHistory(`${historyKey}:${historyGeneration}`, exit);
  const closeAfterSave = useCallback(() => {
    if (requested.current || closing.current || finished.current) return;
    requested.current = true; closeHistory();
  }, [closeHistory]);
  const cancel = useCallback(() => {
    if (!busyRef.current) closeAfterSave();
  }, [closeAfterSave]);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    mounted.current = true; finished.current = false; closing.current = false; requested.current = false;
    const release = acquireOverlayScroll({ preserveHistoryScroll: true });
    const scrollX = window.scrollX, scrollY = window.scrollY;
    dialog.showModal();
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus({ preventScroll: true });
    if (!reducedMotion() && typeof dialog.animate === "function") {
      motion.current = dialog.animate([{ transform: "translateY(10px) scale(.995)", opacity: 0 }, { transform: "none", opacity: 1 }], {
        duration: ENTER_MS, easing: "cubic-bezier(.22,1,.36,1)", fill: "both",
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
      if (outsideFocus?.isConnected && document.activeElement !== outsideFocus) outsideFocus.focus({ preventScroll: true });
    };
  }, [finish]);

  const outside = (x: number, y: number) => {
    const rect = panel.current?.getBoundingClientRect();
    return !!rect && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom);
  };
  // eslint-disable-next-line react-hooks/refs -- These event callbacks are passed, not invoked, during rendering.
  const content = children(closeAfterSave, cancel);
  return <dialog ref={panel} className="quest-form-dialog" aria-labelledby={headingId} aria-modal="true"
    aria-busy={busy || undefined} data-phase={exiting ? "closing" : "open"}
    onCancel={event => { event.preventDefault(); cancel(); }}
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
      if (event.target === event.currentTarget && backdropPointer.current && outside(event.clientX, event.clientY)) cancel();
      backdropPointer.current = false;
    }}>
    <header className="quest-form-dialog-head"><h2 id={headingId}>{title}</h2><button type="button" className="quest-form-dialog-close"
      aria-label={`关闭${title}`} disabled={busy || exiting} onClick={cancel}><X size={20} /></button></header>
    <div className="quest-form-dialog-body" inert={exiting}>{content}</div>
  </dialog>;
}
