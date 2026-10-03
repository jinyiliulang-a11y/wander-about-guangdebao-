"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CreatorDraftClient, emptyCreatorDraft, type DraftSnapshot } from "@/lib/creator-draft-client";
import type { CreatorDraft } from "@/lib/creator-draft-types";

const initial = (): DraftSnapshot => ({ value: emptyCreatorDraft(), status: "idle", message: "草稿会自动保存到当前账号",
  loaded: false, dirty: false, revision: 0, updatedAt: null });
export function useCreatorDraft(playerId: string | undefined, active: boolean) {
  const [stored, setStored] = useState<{ playerId: string | undefined; snapshot: DraftSnapshot }>(() => ({ playerId: undefined, snapshot: initial() }));
  const client = useRef<CreatorDraftClient | null>(null);
  const scope = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!playerId) return;
    const next = new CreatorDraftClient(playerId, snapshot => setStored({ playerId, snapshot }));
    client.current = next; scope.current = playerId;
    queueMicrotask(() => { if (client.current === next) setStored({ playerId, snapshot: next.snapshot() }); });
    return () => { next.dispose(); if (client.current === next) { client.current = null; scope.current = undefined; } };
  }, [playerId]);
  useEffect(() => {
    if (active && client.current && scope.current === playerId) void client.current.load().catch(() => {});
  }, [active, playerId]);
  useEffect(() => {
    const leaving = () => { if (client.current?.snapshot().dirty) void client.current.flush().catch(() => {}); };
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!client.current?.snapshot().dirty) return;
      leaving(); event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("pagehide", leaving); window.addEventListener("beforeunload", warnUnsaved);
    return () => { window.removeEventListener("pagehide", leaving); window.removeEventListener("beforeunload", warnUnsaved); };
  }, []);
  const current = useCallback(() => {
    if (!client.current || scope.current !== playerId) throw new Error("正在准备当前账号的草稿，请稍后再试。");
    return client.current;
  }, [playerId]);
  const update = useCallback((change: CreatorDraft | ((draft: CreatorDraft) => CreatorDraft)) => current().update(change), [current]);
  const load = useCallback(() => current().load(), [current]);
  const reload = useCallback(() => current().load(true), [current]);
  const flush = useCallback(() => current().flush(), [current]);
  const prepareSubmission = useCallback(() => current().prepareSubmission(), [current]);
  const cancelSubmission = useCallback(() => current().cancelSubmission(), [current]);
  const clear = useCallback(() => current().clear(), [current]);
  const pause = useCallback(() => current().pause(), [current]);
  const resume = useCallback(() => current().resume(), [current]);
  const visible = playerId && stored.playerId === playerId ? stored.snapshot : initial();
  return { ...visible, update, load, reload, flush, prepareSubmission, cancelSubmission, clear, pause, resume };
}
