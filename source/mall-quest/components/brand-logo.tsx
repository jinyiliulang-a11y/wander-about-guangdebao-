"use client";

import Image from "next/image";
import "./brand-logo.css";

/** Decorative artwork; the adjacent wordmark supplies the accessible name. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return <Image src="/brand/wander-about-logo-v1.png" alt="" aria-hidden="true"
    width={44} height={44} unoptimized priority
    className={`quest-brand-logo${className ? ` ${className}` : ""}`} />;
}
