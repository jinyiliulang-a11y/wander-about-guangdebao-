"use client";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

export function BackButton({ to, onNavigate, label = "返回上一页", navigationKey = "", showLabel = false }: {
  to?: string;
  onNavigate?: (path: string) => void;
  label?: string;
  navigationKey?: string;
  showLabel?: boolean;
}) {
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    const update = () => setCanGoBack(window.history.length > 1 && window.history.state?.mallQuestDepth > 0);
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [navigationKey]);
  if (!to && !canGoBack) return null;
  return <button className={`back-button${showLabel ? " with-label" : ""}`} type="button" aria-label={label} title={label} onClick={() => {
    if (to) {
      if (onNavigate) onNavigate(to);
      else window.location.assign(to);
    } else window.history.back();
  }}><span><ArrowLeft size={19} /></span>{showLabel && label}</button>;
}
