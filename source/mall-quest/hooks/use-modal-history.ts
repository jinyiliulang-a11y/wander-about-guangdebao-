"use client";
import { useCallback, useEffect, useRef } from "react";
import { browserRequestId } from "@/lib/browser-id";
import { interceptHistory } from "@/lib/history-interceptor";

// Task details already have their own URL. This hook covers same-page dialogs.
export function useModalHistory(key: string, onDismiss: () => void) {
  const activeId = useRef<string | null>(null);
  const openedUrl = useRef<string | null>(null);
  const backRequested = useRef(false);
  useEffect(() => {
    if (key) {
      if (activeId.current && window.history.state?.mallQuestModal === activeId.current) {
        window.history.replaceState({ ...window.history.state, mallQuestModalKind: key }, "");
      } else {
        const id = browserRequestId();
        activeId.current = id;
        openedUrl.current = window.location.href;
        backRequested.current = false;
        window.history.pushState({ ...window.history.state, mallQuestModal: id, mallQuestModalKind: key }, "");
      }
    } else if (activeId.current) {
      const id = activeId.current;
      if (window.history.state?.mallQuestModal === id) {
        if (!backRequested.current) { backRequested.current = true; window.history.back(); }
      } else { activeId.current = null; openedUrl.current = null; backRequested.current = false; }
    }
  }, [key]);
  useEffect(() => {
    const dismiss = () => {
      activeId.current = null;
      openedUrl.current = null;
      backRequested.current = false;
      onDismiss();
    };
    const release = interceptHistory({
      matches: () => !!activeId.current && window.history.state?.mallQuestModal !== activeId.current && window.location.href === openedUrl.current,
      onPop: dismiss,
    });
    const back = () => {
      if (activeId.current && window.history.state?.mallQuestModal !== activeId.current) {
        // A different URL is real navigation and must remain visible to the router.
        dismiss();
      }
    };
    window.addEventListener("popstate", back);
    return () => { release(); window.removeEventListener("popstate", back); };
  }, [onDismiss]);
  // Keep the dialog present until its own back event arrives. This prevents a
  // new navigation from being cancelled by a delayed popstate after closing.
  return useCallback(() => {
    if (activeId.current && window.history.state?.mallQuestModal === activeId.current) {
      if (!backRequested.current) { backRequested.current = true; window.history.back(); }
    }
    else onDismiss();
  }, [onDismiss]);
}
