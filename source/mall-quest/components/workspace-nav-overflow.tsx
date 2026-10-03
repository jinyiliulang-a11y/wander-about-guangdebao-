"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./workspace-nav-overflow.css";

type WorkspaceNavOverflowProps = {
  children: ReactNode;
  navigationRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  reduceMotion?: boolean;
};

/** Keeps the navigation landmark intact and gives hidden mobile items a separate control. */
export function WorkspaceNavOverflow({ children, navigationRef, enabled = true, reduceMotion = false }: WorkspaceNavOverflowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftButtonRef = useRef<HTMLButtonElement>(null);
  const rightButtonRef = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState({ horizontal: false, left: false, right: false });

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current, nav = navigationRef.current;
    if (!container || !nav) return;
    const mobile = window.matchMedia("(max-width: 980px)");
    let frame = 0, disposed = false, previousWidth: number | null = null;

    const measure = () => {
      frame = 0;
      if (disposed) return;
      const horizontal = mobile.matches && nav.scrollWidth > nav.clientWidth + 1;

      // The overlay controls never change the navigation's available width.
      // Re-align only for a changed viewport width, never for ordinary user scrolling.
      if (mobile.matches && nav.clientWidth !== previousWidth) {
        const current = nav.querySelector<HTMLElement>("[aria-current='page']");
        if (current && nav.scrollWidth > nav.clientWidth + 1) {
          const navRect = nav.getBoundingClientRect(), itemRect = current.getBoundingClientRect();
          const target = nav.scrollLeft + itemRect.left - navRect.left - (nav.clientWidth - itemRect.width) / 2;
          const oldBehavior = nav.style.scrollBehavior;
          nav.style.scrollBehavior = "auto";
          nav.scrollLeft = Math.max(0, Math.min(nav.scrollWidth - nav.clientWidth, target));
          nav.style.scrollBehavior = oldBehavior;
        }
      }
      previousWidth = nav.clientWidth;
      const left = horizontal && nav.scrollLeft > 1;
      const right = horizontal && nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 1;
      const focusedLeft = !left && document.activeElement === leftButtonRef.current;
      const focusedRight = !right && document.activeElement === rightButtonRef.current;
      if (focusedLeft || focusedRight) {
        const items = nav.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        items.item(focusedLeft ? 0 : items.length - 1)?.focus({ preventScroll: true });
      }
      setOverflow(previous => previous.horizontal === horizontal && previous.left === left && previous.right === right ? previous : { horizontal, left, right });
    };
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observeSizes = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(container);
      resizeObserver?.observe(nav);
      for (const item of nav.children) resizeObserver?.observe(item);
    };
    const mutationObserver = new MutationObserver(() => { observeSizes(); schedule(); });
    observeSizes();
    mutationObserver.observe(nav, { childList: true, subtree: true, characterData: true });
    nav.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    mobile.addEventListener("change", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      nav.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mobile.removeEventListener("change", schedule);
    };
  }, [enabled, navigationRef]);

  if (!enabled) return children;
  const scroll = (direction: -1 | 1) => {
    const nav = navigationRef.current;
    if (!nav) return;
    const reduced = reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({ left: direction * Math.max(120, nav.clientWidth * .75), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className="workspace-nav-overflow" ref={containerRef} data-overflow={overflow.horizontal || undefined}>
      <button
        ref={leftButtonRef}
        type="button"
        className="workspace-nav-more workspace-nav-left"
        aria-label="向左查看更多导航"
        title="向左查看更多导航"
        aria-hidden={!overflow.left}
        disabled={!overflow.left}
        tabIndex={overflow.left ? 0 : -1}
        data-visible={overflow.left || undefined}
        onClick={() => scroll(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      {children}
      <button
        ref={rightButtonRef}
        type="button"
        className="workspace-nav-more workspace-nav-right"
        aria-label="向右查看更多导航"
        title="向右查看更多导航"
        aria-hidden={!overflow.right}
        disabled={!overflow.right}
        tabIndex={overflow.right ? 0 : -1}
        data-visible={overflow.right || undefined}
        onClick={() => scroll(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
