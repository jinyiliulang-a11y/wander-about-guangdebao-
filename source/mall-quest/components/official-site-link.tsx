"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import "./official-site-link.css";

export function OfficialSiteLink({
  blocked = false,
  onBlockedNavigate,
}: {
  blocked?: boolean;
  onBlockedNavigate?: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitRoot = useRef<HTMLElement | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    exitRoot.current?.classList.remove("official-page-leaving");
  }, []);
  return (
    <a
      href="/official/"
      className="official-site-link"
      aria-disabled={blocked || leaving || undefined}
      aria-busy={leaving || undefined}
      onClick={event => {
        if (blocked || leaving || timer.current !== null) {
          event.preventDefault();
          if (blocked) onBlockedNavigate?.();
          return;
        }
        // Modified clicks retain normal anchor behavior, including opening another tab.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const reduce = document.documentElement.dataset.questReduceMotion === "true"
          || !!event.currentTarget.closest('[data-reduce-motion="true"]')
          || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) return;
        event.preventDefault();
        setLeaving(true);
        exitRoot.current = event.currentTarget.closest("main");
        exitRoot.current?.classList.add("official-page-leaving");
        timer.current = setTimeout(() => {
          timer.current = null;
          window.location.assign("/official/");
        }, 160);
      }}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      <span>返回官网</span>
    </a>
  );
}
