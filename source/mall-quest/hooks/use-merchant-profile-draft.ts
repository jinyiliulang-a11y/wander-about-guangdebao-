"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { isGameApiError, isUncertainResult, request } from "@/lib/game-api";
import type { MerchantProfileDraftForm, MerchantProfileDraftState } from "@/lib/merchant-profile-draft-types";

type Intent = Readonly<{ action: "merchantProfileDraftSave" | "merchantProfileDraftDelete"; requestId: string; expectedRevision: number; draft?: Readonly<MerchantProfileDraftForm> }>;
const intents = new Map<string, Intent>(); // Page memory only, partitioned by the captured actor and store.
const fields = ["name", "logo", "category", "floor", "address", "phone", "imageURL", "artwork", "expectedImageRevision"] as const;
export const sameProfileDraft = (a: MerchantProfileDraftForm | null, b: MerchantProfileDraftForm | null) => a === b || !!a && !!b && fields.every(key => a[key] === b[key]);
const uuid = () => crypto.randomUUID();
function validForm(value: unknown): value is MerchantProfileDraftForm {
  if (!value || typeof value !== "object") return false;
  const form = value as MerchantProfileDraftForm;
  return fields.slice(0, 7).every(key => typeof form[key] === "string") && Number.isInteger(form.artwork) && form.artwork >= 0 && form.artwork <= 2
    && Number.isSafeInteger(form.expectedImageRevision) && form.expectedImageRevision >= 0;
}
function checkedState(value: unknown, storeId: string): MerchantProfileDraftState {
  const state = value as MerchantProfileDraftState | null;
  if (!state || state.storeId !== storeId || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !(state.updatedAt === null || typeof state.updatedAt === "number" && Number.isFinite(state.updatedAt) && state.updatedAt > 0)
    || !(state.lastRequestId === null || typeof state.lastRequestId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(state.lastRequestId))
    || !(state.draft === null || validForm(state.draft))) throw new Error("草稿查询结果无法确认，请留在当前表单核对。");
  return { ...state, draft: state.draft ? { ...state.draft } : null };
}

export function useMerchantProfileDraft({ storeId, operatorId, initialForm, enabled }: {
  storeId: string; operatorId: string; initialForm: MerchantProfileDraftForm; enabled: boolean;
}) {
  const key = operatorId + ":" + storeId;
  const rememberedForm = intents.get(key)?.draft || initialForm;
  const initial = useRef(initialForm), formRef = useRef<MerchantProfileDraftForm>({ ...rememberedForm });
  const [form, updateForm] = useState<MerchantProfileDraftForm>({ ...rememberedForm });
  const [base, setBase] = useState(initialForm), [hasEdited, setHasEdited] = useState(false), [ready, setReady] = useState(false);
  const [state, updateState] = useState<MerchantProfileDraftState>({ storeId, revision: 0, updatedAt: null, draft: null, lastRequestId: null });
  const stateRef = useRef(state), edited = useRef(false), alive = useRef(true), loaded = useRef(false);
  const readEpoch = useRef(0), editEpoch = useRef(0), reading = useRef(false);
  const work = useRef<Promise<boolean> | null>(null), pause = useRef(false);
  const flushing = useRef<Promise<boolean> | null>(null);
  const correctionRequired = useRef(false);
  const pendingRef = useRef<Intent | null>(intents.get(key) || null);
  const [pending, updatePending] = useState<Intent | null>(() => intents.get(key) || null);
  const [loading, setLoading] = useState(!!operatorId), [busy, setBusy] = useState(false), [writing, setWriting] = useState(false), [error, setError] = useState(operatorId ? "" : "正在核对商家身份，请刷新工作台后再编辑。");
  const [notice, setNotice] = useState(""), [canRetry, setCanRetry] = useState(false);
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [conflict, setConflict] = useState<MerchantProfileDraftState | null>(null);
  const publish = useCallback((next: MerchantProfileDraftState) => {
    stateRef.current = next;
    if (alive.current) updateState(next);
  }, []);
  const remember = useCallback((next: Intent | null) => {
    const previous = pendingRef.current;
    pendingRef.current = next;
    if (next) intents.set(key, next);
    else if (previous && intents.get(key)?.requestId === previous.requestId) intents.delete(key);
    if (alive.current) updatePending(next);
  }, [key]);
  const setForm = useCallback((next: SetStateAction<MerchantProfileDraftForm>) => {
    const value = typeof next === "function" ? next(formRef.current) : next;
    edited.current = true; editEpoch.current++; formRef.current = { ...value };
    if (correctionRequired.current && !pendingRef.current) {
      correctionRequired.current = false; pause.current = false;
      if (alive.current) { setNeedsCorrection(false); setError(""); }
    }
    if (alive.current) { updateForm(formRef.current); setHasEdited(true); setNotice(""); }
  }, []);
  const dirtyNow = useCallback(() => edited.current && !sameProfileDraft(formRef.current, stateRef.current.draft || initial.current), []);
  const read = useCallback(async () => checkedState(await request("merchantProfileDraftGet", {}, "workspace", { expectedPlayerId: operatorId }), storeId), [operatorId, storeId]);
  const adopt = useCallback((next: MerchantProfileDraftState, restore: boolean) => {
    publish(next);
    if (restore) {
      formRef.current = { ...(next.draft || initial.current) }; edited.current = false; editEpoch.current++;
      if (alive.current) { updateForm(formRef.current); setHasEdited(false); }
    }
  }, [publish]);

  useEffect(() => {
    alive.current = true;
    const epoch = ++readEpoch.current, editAtStart = editEpoch.current;
    if (!operatorId) return () => { alive.current = false; };
    void read().then(next => {
      if (!alive.current || epoch !== readEpoch.current) return;
      adopt(next, !pendingRef.current && editAtStart === editEpoch.current && !edited.current); loaded.current = true; setReady(true); setLoading(false);
      if (pendingRef.current) { pause.current = true; setError("上次草稿操作结果尚待核对，请先核对原草稿请求。"); }
    }).catch(cause => { if (alive.current && epoch === readEpoch.current) { setLoading(false); setError(cause instanceof Error ? cause.message : "暂时无法读取草稿。"); } });
    return () => { alive.current = false; };
  }, [adopt, operatorId, read]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirtyNow() && !pendingRef.current && !work.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirtyNow]);

  const acknowledge = useCallback((next: MerchantProfileDraftState, intent: Intent) => {
    if (next.lastRequestId !== intent.requestId || next.revision !== intent.expectedRevision + 1
      || !sameProfileDraft(next.draft, intent.action === "merchantProfileDraftDelete" ? null : intent.draft!)) throw new Error("草稿返回结果与原请求不一致，请先核对原请求。");
    publish(next); remember(null); pause.current = false; correctionRequired.current = false;
    if (intent.action === "merchantProfileDraftDelete") {
      edited.current = false; formRef.current = { ...initial.current };
      if (alive.current) { updateForm(formRef.current); setHasEdited(false); }
    }
    if (alive.current) { setConflict(null); setCanRetry(false); setNeedsCorrection(false); setError(""); setNotice(intent.action === "merchantProfileDraftDelete" ? "草稿已删除。" : "草稿已自动保存。"); }
  }, [publish, remember]);
  const send = useCallback((intent: Intent) => {
    if (work.current) return work.current;
    if (!alive.current || reading.current) return Promise.resolve(false);
    readEpoch.current++;
    const run = async () => {
      if (alive.current) { setBusy(true); setWriting(true); setError(""); setCanRetry(false); }
      remember(intent);
      try {
        const next = checkedState(await request(intent.action, { requestId: intent.requestId, expectedRevision: intent.expectedRevision,
          ...(intent.draft ? { draft: intent.draft } : {}) }, "workspace", { expectedPlayerId: operatorId }), storeId);
        acknowledge(next, intent); return alive.current;
      } catch (cause) {
        pause.current = true;
        if (!isUncertainResult(cause) && isGameApiError(cause)) {
          if ([400, 413, 422].includes(cause.status || 0)) {
            // A definitive validation rejection did not commit. Keep all raw
            // editing, release only this failed intent, and wait for the user
            // to correct it before making another request.
            remember(null); correctionRequired.current = true;
            if (alive.current) setNeedsCorrection(true);
          }
          // A definitive response proves this attempt did not commit. Keep the
          // frozen intent until the user checks its revision or explicitly retries.
          else if (alive.current) setCanRetry(cause.status !== 409 && cause.status !== 401 && cause.status !== 403);
        }
        if (alive.current) setError(cause instanceof Error ? cause.message : "草稿保存结果未知，请先核对原请求。");
        return false;
      } finally { if (alive.current) { setBusy(false); setWriting(false); } }
    };
    const promise = run(); work.current = promise;
    void promise.finally(() => { if (work.current === promise) work.current = null; });
    return promise;
  }, [acknowledge, operatorId, remember, storeId]);

  const recover = useCallback(async () => {
    if (reading.current || !alive.current) return false;
    reading.current = true;
    if (work.current) await work.current;
    if (!alive.current) { reading.current = false; return false; }
    const epoch = ++readEpoch.current, editAtStart = editEpoch.current;
    if (alive.current) { setBusy(true); setError(""); }
    try {
      const next = await read(), intent = pendingRef.current;
      if (!alive.current || epoch !== readEpoch.current) return false;
      loaded.current = true; setReady(true); setLoading(false);
      if (!intent) { adopt(next, editAtStart === editEpoch.current && !edited.current); return true; }
      if (next.lastRequestId === intent.requestId && sameProfileDraft(next.draft, intent.action === "merchantProfileDraftDelete" ? null : intent.draft!)) {
        acknowledge(next, intent); return true;
      }
      if (next.revision === intent.expectedRevision) {
        if (alive.current) { setCanRetry(true); setError("尚未找到原草稿请求的保存结果。可明确重试原请求，参数和编号保持不变。"); }
      } else if (alive.current) { setConflict(next); setCanRetry(false); setError("草稿已在其他窗口更新。请选择加载最新草稿，或核对后保留当前内容。"); }
      return false;
    } catch (cause) { if (alive.current && epoch === readEpoch.current) setError(cause instanceof Error ? cause.message : "草稿状态暂时无法核对。"); return false; }
    finally { reading.current = false; if (alive.current) setBusy(false); }
  }, [acknowledge, adopt, read]);

  const flush = useCallback(() => {
    if (flushing.current) return flushing.current;
    const run = async () => {
      if (work.current && !await work.current) return false;
      if (!alive.current || !loaded.current || pendingRef.current || pause.current) return false;
      // All callers await this whole serial loop, not just its first request.
      // A close during autosave must include later edits in the same flush.
      while (dirtyNow()) {
        if (!alive.current) return false;
        const intent: Intent = Object.freeze({ action: "merchantProfileDraftSave", requestId: uuid(), expectedRevision: stateRef.current.revision,
          draft: Object.freeze({ ...formRef.current }) });
        if (!await send(intent)) return false;
        if (!alive.current) return false;
      }
      return alive.current;
    };
    const promise = run(); flushing.current = promise;
    void promise.finally(() => { if (flushing.current === promise) flushing.current = null; });
    return promise;
  }, [dirtyNow, send]);
  useEffect(() => {
    if (!enabled || loading || busy || pending || conflict || pause.current || !dirtyNow()) return;
    const timer = setTimeout(() => { void flush(); }, 800);
    return () => clearTimeout(timer);
  }, [enabled, loading, busy, pending, conflict, form, dirtyNow, flush]);

  const remove = useCallback(async (expectedRevision = stateRef.current.revision) => {
    if (work.current) await work.current;
    if (!alive.current || !loaded.current || pendingRef.current) return false;
    const success = await send(Object.freeze({ action: "merchantProfileDraftDelete", requestId: uuid(), expectedRevision }));
    if (success) {
      edited.current = false; formRef.current = { ...initial.current };
      if (alive.current) { updateForm(formRef.current); setHasEdited(false); }
    }
    return success;
  }, [send]);
  const retry = useCallback(async () => canRetry && pendingRef.current ? send(pendingRef.current) : false, [canRetry, send]);
  const resolveConflict = useCallback((restore: boolean) => {
    if (!conflict || work.current) return;
    adopt(conflict, restore); remember(null); pause.current = false;
    if (!restore) { edited.current = true; if (alive.current) setHasEdited(true); }
    if (alive.current) { setConflict(null); setCanRetry(false); setError(""); setNotice(restore ? "已加载最新草稿。" : "已保留当前内容，后续保存将以最新草稿版本为基础。"); }
  }, [adopt, conflict, remember]);
  const resetBase = useCallback((next: MerchantProfileDraftForm) => {
    initial.current = { ...next }; edited.current = false; editEpoch.current++; formRef.current = { ...next };
    if (alive.current) { updateForm(formRef.current); setBase({ ...next }); setHasEdited(false); }
  }, []);
  const snapshot = useCallback(() => ({ form: { ...formRef.current }, state: { ...stateRef.current, draft: stateRef.current.draft ? { ...stateRef.current.draft } : null } }), []);
  return { form, setForm, state, loading, busy, writing, error, notice, pending, canRetry, conflict,
    dirty: hasEdited && !sameProfileDraft(form, state.draft || base), ready, needsCorrection, flush, recover, retry, remove, resolveConflict, resetBase, snapshot };
}
