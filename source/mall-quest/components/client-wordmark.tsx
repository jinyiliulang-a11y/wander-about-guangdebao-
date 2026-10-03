"use client";

import { BrandLogo } from "./brand-logo";

/** One client wordmark for the map, wallet, profile and explorer pages. */
export function ClientWordmark({ onHome, className = "" }: { onHome?: () => void; className?: string }) {
  const classes = `reference-wordmark quest-brand-lockup${className ? ` ${className}` : ""}`;
  const label = <><BrandLogo /><span className="quest-brand-copy">逛道宝<small className="brand-english">wander about</small></span></>;
  return onHome
    ? <button className={classes} aria-label="返回首页" onClick={onHome} type="button">{label}</button>
    : <span className={classes}>{label}</span>;
}
