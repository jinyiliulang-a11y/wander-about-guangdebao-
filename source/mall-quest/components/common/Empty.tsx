import { AlertCircle, Compass, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Empty({ icon, title, body, action, variant = "empty", className = "" }: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  variant?: "empty" | "loading" | "error";
  className?: string;
}) {
  const Icon = icon || (variant === "loading" ? LoaderCircle : variant === "error" ? AlertCircle : Compass);
  return <div className={`empty-state state-${variant} ${variant === "loading" ? "loading-state" : ""} ${className}`} role={variant === "loading" ? "status" : variant === "error" ? "alert" : undefined}>
    <Icon size={36} className={variant === "loading" ? "spin" : undefined} aria-hidden="true" />
    <h2>{title}</h2>{body && <p>{body}</p>}{action}
  </div>;
}
