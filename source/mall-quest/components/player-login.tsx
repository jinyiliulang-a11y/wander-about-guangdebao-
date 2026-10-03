"use client";
import type { Role } from "@/lib/game-types";
import { AccountAccess } from "./account-access";

export function PlayerLogin({ role, busy, onAction, onDone, onBack, onRegistrationPendingChange, recordingShortcutAllowed }: {
  role: Role;
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onDone: () => void;
  onGuest: () => void;
  onBack: () => void;
  currentAccount?: string;
  onRegistrationPendingChange?: (pending: boolean) => void;
  recordingShortcutAllowed?: boolean;
}) {
  return <AccountAccess accountRole="player" explorer={role === "explorer"} busy={busy} onAction={onAction} onDone={onDone} onBack={onBack} onRegistrationPendingChange={onRegistrationPendingChange} recordingShortcutAllowed={recordingShortcutAllowed} />;
}
