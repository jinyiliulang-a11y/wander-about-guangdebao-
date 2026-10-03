"use client";
import { OfficialSiteLink } from "./official-site-link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Store } from "@/lib/game-types";
import { ThemeToggle } from "./theme-toggle";
import { BrandLogo } from "./brand-logo";
import { ClientWordmark } from "./client-wordmark";
import { AccountAccess } from "./account-access";
import "./client-login-motion.css";

export function RoleLoginScreen({ title, subtitle, kind, onBack, children, statusNotice, theme = "light", reduceMotion = false, onThemeToggle, navigationBlocked = false, onBlockedBack, showWorkspaceEntryBack = true }: {
  title: string; subtitle: string; kind: "hunter" | "explorer" | "merchant" | "admin";
  onBack: () => void; children: React.ReactNode; statusNotice?: React.ReactNode; theme?: "light" | "dark"; reduceMotion?: boolean; onThemeToggle: () => void;
  navigationBlocked?: boolean; onBlockedBack?: () => void;
  showWorkspaceEntryBack?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const pendingBack = useRef(false);
  const backCompleted = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  const finishBack = useCallback(() => {
    if (!pendingBack.current || backCompleted.current) return;
    backCompleted.current = true;
    pendingBack.current = false;
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    onBackRef.current();
  }, []);
  const returnToEntry = useCallback(() => {
    if (navigationBlocked) { onBlockedBack?.(); return; }
    if (pendingBack.current || backCompleted.current) return;
    pendingBack.current = true;
    if (reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishBack();
      return;
    }
    setLeaving(true);
    // Finish once even if animationend is suppressed by a browser or stylesheet.
    leaveTimer.current = setTimeout(finishBack, 200);
  }, [finishBack, reduceMotion, navigationBlocked, onBlockedBack]);
  const workspaceBack = () => { if (navigationBlocked) onBlockedBack?.(); else onBack(); };
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => { if (media.matches) finishBack(); };
    media.addEventListener("change", motionChanged);
    return () => {
      media.removeEventListener("change", motionChanged);
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      pendingBack.current = false;
    };
  }, [finishBack]);
  useEffect(() => { if (reduceMotion) finishBack(); }, [finishBack, reduceMotion]);

  if (kind === "hunter" || kind === "explorer") return <main className={`auth-shell client-shell reference-client quest-client-login${leaving ? " is-leaving" : ""}`} data-client-theme={theme} data-reduce-motion={reduceMotion || undefined} aria-busy={leaving || undefined}><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><section className="auth-panel" inert={leaving} onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === "quest-login-exit") finishBack(); }}><div className="quest-theme-auth-actions"><OfficialSiteLink blocked={navigationBlocked || leaving} onBlockedNavigate={onBlockedBack} /><button className="reference-auth-back" onClick={returnToEntry} aria-label="返回角色入口" disabled={leaving} type="button"><ArrowLeft size={18}/>返回入口</button></div><ClientWordmark onHome={returnToEntry} className="auth-brand-intro quest-auth-wordmark"/><div className="auth-content-intro"><h1>{title}</h1><p className="auth-lead">{subtitle}</p><div className="auth-mode-content mode-login">{children}</div></div></section>{statusNotice}</main>;
  return <main className={`role-login-screen reference-workspace-login login-${kind}`} data-client-theme={theme} data-reduce-motion={reduceMotion || undefined}><header className="quest-theme-login-header"><button className="brand" onClick={workspaceBack} aria-label="返回首页" type="button"><BrandLogo /><span>逛道宝<small className="brand-english">wander about</small></span></button><div className="quest-theme-header-actions"><OfficialSiteLink blocked={navigationBlocked} onBlockedNavigate={onBlockedBack} /><ThemeToggle theme={theme} onToggle={onThemeToggle}/>{showWorkspaceEntryBack && <button className="outline-button" onClick={workspaceBack}><ArrowLeft size={16} /> 返回入口</button>}</div></header><div className="role-login-intro"><span className="eyebrow">wander about · {kind === "admin" ? "OPERATIONS" : "MERCHANT"}</span><h1>{title}</h1><p>{subtitle}</p></div>{children}{statusNotice}</main>;
}

export function WorkspaceLogin({ admin, busy, onAction, onDone, onRegistrationPendingChange, recordingShortcutAllowed }: {
  admin: boolean; stores: Store[]; busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onDone: () => void; currentAccount?: string;
  onRegistrationPendingChange?: (pending: boolean) => void;
  recordingShortcutAllowed?: boolean;
}) {
  return <AccountAccess accountRole={admin ? "admin" : "merchant"} busy={busy} onAction={onAction} onDone={onDone} onRegistrationPendingChange={onRegistrationPendingChange} recordingShortcutAllowed={recordingShortcutAllowed} />;
}
