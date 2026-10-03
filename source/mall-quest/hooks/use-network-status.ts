"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GAME_API_NETWORK_EVENT, getGameNetworkStatus, type GameNetworkEventDetail } from "@/lib/game-api";

export type NetworkPhase = "unknown" | "healthy" | "offline" | "unavailable" | "recovering" | "recovered";
export type NetworkStatusState = { phase: NetworkPhase; lastConfirmedAt: number | null };
const initial: NetworkStatusState = { phase: "unknown", lastConfirmedAt: null };

/** Browser online only means a local connection. An API response separately
 * verifies that the application server can actually be reached. */
export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatusState>(initial);
  const latest = useRef(status);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((next: NetworkStatusState) => { latest.current = next; setStatus(next); }, []);
  const clearRecovery = useCallback(() => {
    if (recoveryTimer.current !== null) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
  }, []);
  useEffect(() => {
    let disposed = false;
    const browserOffline = () => { clearRecovery(); update({ ...latest.current, phase: "offline" }); };
    const browserOnline = () => { clearRecovery(); update({ ...latest.current, phase: "recovering" }); };
    const applyApiStatus = (detail: GameNetworkEventDetail | null) => {
      if (!detail || !["reachable", "unavailable", "offline"].includes(detail.state)) return;
      if (detail.state !== "reachable") {
        clearRecovery();
        update({ ...latest.current, phase: navigator.onLine === false || detail.state === "offline" ? "offline" : "unavailable" });
        return;
      }
      const previous = latest.current.phase;
      const recovering = ["offline", "unavailable", "recovering", "recovered"].includes(previous);
      update({ phase: recovering ? "recovered" : "healthy", lastConfirmedAt: Date.now() });
      if (recovering && previous !== "recovered") {
        clearRecovery();
        recoveryTimer.current = setTimeout(() => { recoveryTimer.current = null; update({ ...latest.current, phase: "healthy" }); }, 5_000);
      }
    };
    const apiEvent = (event: Event) => applyApiStatus((event as CustomEvent<GameNetworkEventDetail>).detail);
    window.addEventListener("offline", browserOffline);
    window.addEventListener("online", browserOnline);
    window.addEventListener(GAME_API_NETWORK_EVENT, apiEvent);
    queueMicrotask(() => {
      if (disposed) return;
      if (navigator.onLine === false) browserOffline();
      else {
        const previous = getGameNetworkStatus();
        if (previous?.state === "offline") browserOnline();
        else applyApiStatus(previous);
      }
    });
    return () => {
      disposed = true; clearRecovery();
      window.removeEventListener("offline", browserOffline);
      window.removeEventListener("online", browserOnline);
      window.removeEventListener(GAME_API_NETWORK_EVENT, apiEvent);
    };
  }, [clearRecovery, update]);
  const beginCheck = useCallback(() => {
    clearRecovery();
    if (navigator.onLine === false) { update({ ...latest.current, phase: "offline" }); return false; }
    update({ ...latest.current, phase: "recovering" });
    return true;
  }, [clearRecovery, update]);
  const finishCheck = useCallback(() => {
    if (latest.current.phase === "recovering") update({ ...latest.current, phase: "unavailable" });
  }, [update]);
  return { status, beginCheck, finishCheck };
}
