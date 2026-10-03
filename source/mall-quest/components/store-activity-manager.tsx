"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Edit3, MapPin, Megaphone, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { request, isUncertainResult } from "@/lib/game-api";
import { validCoordinates, validRadius, type StoreGeofence } from "@/lib/geofence";
import type { Store } from "@/lib/game-types";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import { STORE_ACTIVITY_TITLE_LIMIT, STORE_ACTIVITY_DESCRIPTION_LIMIT, STORE_ACTIVITY_REVIEW_NOTE_LIMIT, type StoreActivity, type StoreActivityFilter, type StoreActivitiesState, type StoreActivityState, type StoreActivityMutationResult } from "@/lib/store-activity-types";
import { ChoiceField } from "./common/WorkbenchFields";
import "./store-activity-manager.css";

type Props = {
  scope: { role: string; storeId: string | null };
  stores: Store[];
  reviewRequired: boolean;
  onConfigureFence: () => void;
  onBusyChange?: (busy: boolean) => void;
};
type Draft = { id?: string; revision: number; requestId: string; title: string; description: string; start: string; end: string };
type Attempt = { action: string; payload: Record<string, unknown>; checked: boolean; retryable: boolean };
const statusLabels = { pending: "待审核", published: "已发布", rejected: "已退回", offline: "已下架" };
const phaseLabels = { upcoming: "尚未开始", active: "进行中", expired: "已结束" };
const activityFilterOptions = [
  { value: "all", label: "全部活动" }, { value: "pending", label: "待审核" },
  { value: "published", label: "已发布" }, { value: "rejected", label: "已退回" },
  { value: "offline", label: "已下架" }, { value: "expired", label: "已结束" },
] as const;
const activityFilterDescriptions: Record<StoreActivityFilter, string> = {
  all: "查看所有活动记录；审核状态与活动时间分别显示。",
  pending: "活动正在等待运营审核，审核通过前不会公开展示。",
  published: "活动已通过审核或无需审核；公开展示还取决于活动时间、门店状态和门店范围是否有效。",
  rejected: "活动已被运营退回，查看审核说明并修改后可重新提交。",
  offline: "活动已停止公开展示，已有记录仍会保留。",
  expired: "查看已超过结束时间的活动；活动原有的审核状态仍单独保留。",
};
const dateTime = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(value);
// datetime-local is intentionally interpreted in Shanghai, independent of the browser timezone.
const dateField = (value: number) => new Date(value + 8 * 3_600_000).toISOString().slice(0, 16);
const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? Date.parse(`${value}:00+08:00`) : NaN;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || !!document.querySelector('[data-reduce-motion="true"]');
const validFence = (fence: StoreGeofence | undefined | null) => !!fence && fence.enabled && Number.isSafeInteger(fence.revision) && fence.revision > 0 && validCoordinates(fence.latitude, fence.longitude) && validRadius(fence.radiusMeters);
const activityPhase = (activity: StoreActivity, now: number) => activity.endAt <= now ? "expired" : activity.startAt > now ? "upcoming" : "active";
const activityDraft = (activity: StoreActivity): Draft => ({ id: activity.id, revision: activity.revision, requestId: "", title: activity.title, description: activity.description, start: dateField(activity.startAt), end: dateField(activity.endAt) });
const initialDraft = (): Draft => { const now = Math.ceil(Date.now() / 60_000) * 60_000; return { revision: 0, requestId: crypto.randomUUID(), title: "", description: "", start: dateField(now), end: dateField(now + 24 * 3_600_000) }; };

function Feedback({ error, notice }: { error: string; notice: string }) {
  return <>{error && <p className="sa-feedback error" role="alert"><AlertTriangle size={17} />{error}</p>}{notice && <p className="sa-feedback" role="status"><CheckCircle2 size={17} />{notice}</p>}</>;
}
function ActivityFacts({ activity }: { activity: StoreActivity }) {
  return <dl className="sa-facts"><div><dt>门店</dt><dd>{activity.storeName}</dd></div><div><dt>开始时间</dt><dd>{dateTime(activity.startAt)}</dd></div><div><dt>结束时间</dt><dd>{dateTime(activity.endAt)}</dd></div></dl>;
}
function ActivityTags({ activity, now }: { activity: StoreActivity; now: number }) {
  return <div className="sa-tags"><span className={`sa-status ${activity.status}`}><ShieldCheck size={14} />{statusLabels[activity.status]}</span><span className="sa-status"><CalendarDays size={14} />{phaseLabels[activityPhase(activity, now)]}</span></div>;
}

function ActivityDialog({ activity, admin, busy, mutationDisabled, loading, uncertain, error, notice, publishable, onClose, onReview, now }: {
  activity: StoreActivity; admin: boolean; busy: boolean; mutationDisabled: boolean; loading: boolean; uncertain: boolean; error: string; notice: string; publishable: boolean; now: number;
  onClose: () => void; onReview: (activity: StoreActivity, decision: "publish" | "reject" | "offline", reason?: string) => void;
}) {
  const panel = useRef<HTMLDialogElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [closing, setClosing] = useState(false), [reason, setReason] = useState("");
  const close = () => {
    if (busy || closing) return;
    if (reducedMotion()) { onCloseRef.current(); return; }
    setClosing(true); timer.current = setTimeout(() => onCloseRef.current(), 230);
  };
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    const release = acquireOverlayScroll();
    dialog.showModal();
    return () => { clearTimeout(timer.current); dialog.close(); release(); };
  }, []);
  return <dialog ref={panel} className={`sa-dialog${closing ? " is-closing" : ""}`} aria-label="活动公告详情" aria-modal="true" onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target === panel.current) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); }
  }}>
    <div className="sa-dialog-head"><div><span className="muted">{admin ? "运营审核 · 门店公告" : "本店活动公告"}</span><h2>{activity.title}</h2></div><button type="button" className="sa-close" aria-label="关闭活动公告详情" disabled={busy || closing} onClick={close}><X size={20} /></button></div>
    <div className="sa-dialog-content"><ActivityTags activity={activity} now={now} /><ActivityFacts activity={activity} /><p className="sa-summary">{activity.description}</p>{activity.reviewNote && <div className="sa-note"><AlertTriangle size={18} /><div><strong>审核说明</strong><p>{activity.reviewNote}</p></div></div>}
      <p className="muted">公告使用门店已保存的电子围栏位置，仅介绍活动。它不会生成金币任务、发券或扣减库存。</p>
      {loading && <p role="status">正在核对最新公告与门店范围…</p>}<Feedback error={error} notice={notice} />
      {uncertain && <p className="sa-feedback">操作结果尚未确认，请关闭详情，在列表上方核对后台记录。</p>}
      {admin && activity.status === "pending" && <><label><span className="sa-field-head">退回原因<small className="muted">退回时必填 · {reason.length}/{STORE_ACTIVITY_REVIEW_NOTE_LIMIT}</small></span><textarea aria-label="活动退回原因" maxLength={STORE_ACTIVITY_REVIEW_NOTE_LIMIT} rows={3} placeholder="说明需要商家修改的具体内容，至少 2 字" value={reason} disabled={mutationDisabled} onChange={event => setReason(event.target.value)} /></label>{!loading && !publishable && <p className="sa-feedback error">门店围栏未启用或活动已结束，暂不能通过；可退回让商家修改。</p>}<div className="sa-actions"><button type="button" className="outline-button" disabled={mutationDisabled || closing} onClick={() => onReview(activity, "reject", reason)}>退回修改</button><button type="button" className="gold-button" disabled={mutationDisabled || closing || !publishable} onClick={() => onReview(activity, "publish")}><CheckCircle2 size={17} />{busy ? "正在保存…" : "审核通过"}</button></div></>}
      {admin && activity.status === "published" && <div className="sa-confirm"><p>下架后公告立即退出公开展示，保留已有记录。</p><div className="sa-actions"><button type="button" className="outline-button" disabled={mutationDisabled || closing} onClick={() => onReview(activity, "offline")}>下架公告</button></div></div>}
    </div>
  </dialog>;
}

/** A keyed inner workspace prevents stale requests from a previous authenticated scope replacing this one. */
export function StoreActivityManager(props: Props) {
  return <ActivityWorkspace key={`${props.scope.role}:${props.scope.storeId || ""}`} {...props} />;
}

function ActivityWorkspace({ scope, stores, reviewRequired, onConfigureFence, onBusyChange }: Props) {
  const admin = scope.role === "admin", merchant = scope.role === "merchant";
  const fieldId = useId(), publishReasonId = `${fieldId}-publish-reason`, submitReasonId = `${fieldId}-submit-reason`, filterDescriptionId = `${fieldId}-filter-description`;
  const [data, setData] = useState<StoreActivitiesState | null>(null), [filter, setFilter] = useState<StoreActivityFilter>(admin ? "pending" : "all");
  const [storeFilter, setStoreFilter] = useState(""), [page, setPage] = useState(1), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<StoreActivity | null>(null), [withdraw, setWithdraw] = useState<StoreActivity | null>(null), [uncertain, setUncertain] = useState<Attempt | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailFailed, setDetailFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true), sequence = useRef(0), detailSequence = useRef(0), writeLock = useRef(false), draftPanel = useRef<HTMLElement>(null);
  const onBusyRef = useRef(onBusyChange);
  useEffect(() => { onBusyRef.current = onBusyChange; }, [onBusyChange]);
  const invalidateReads = useCallback(() => { sequence.current++; detailSequence.current++; }, []);
  useEffect(() => { alive.current = true; const tick = setInterval(() => setNow(Date.now()), 30_000); return () => { alive.current = false; invalidateReads(); clearInterval(tick); onBusyRef.current?.(false); }; }, [invalidateReads]);
  useEffect(() => { onBusyRef.current?.(busy || !!uncertain); }, [busy, uncertain]);
  const load = useCallback(async () => {
    if (!admin && (!merchant || !scope.storeId)) { setLoading(false); return; }
    const ticket = ++sequence.current; setLoading(true);
    try {
      const next = await request<StoreActivitiesState>("storeActivities", { manage: true, ...(admin ? storeFilter ? { storeId: storeFilter } : {} : { storeId: scope.storeId }), filter, page }, "workspace");
      if (!next || !Array.isArray(next.activities) || !Array.isArray(next.fences) || !next.pagination) throw new Error("活动列表响应不完整，请刷新后再试。");
      if (alive.current && ticket === sequence.current) {
        // A mutation can remove the last record on the last filtered page.
        const lastPage = Math.max(1, next.pagination.totalPages);
        if (page > lastPage) { setPage(lastPage); return next; }
        setData(next); return next;
      }
    } catch (cause) { if (alive.current && ticket === sequence.current) setError(cause instanceof Error ? cause.message : "活动列表暂时无法读取。"); }
    finally { if (alive.current && ticket === sequence.current) setLoading(false); }
  }, [admin, merchant, scope.storeId, storeFilter, filter, page]);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) { setData(null); setError(""); void load(); } }); return () => { cancelled = true; }; }, [load]);
  const draftFocusKey = draft ? draft.id || draft.requestId : null;
  useEffect(() => { if (draftFocusKey) { draftPanel.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "instant" : "smooth" }); draftPanel.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true }); } }, [draftFocusKey]);
  const fence = data?.fences.find(item => item.storeId === scope.storeId);
  const store = stores.find(item => item.id === scope.storeId);
  const canPublish = validFence(fence) && store?.status !== "inactive" && !!store;
  const latestDraftRecord = draft?.id ? data?.activities.find(item => item.id === draft.id) : undefined;
  const draftChanged = !!latestDraftRecord && latestDraftRecord.revision !== draft?.revision;
  const locked = busy || !!uncertain;
  const storePublishReason = !store ? "未找到当前绑定的门店，请刷新列表或确认账号的门店信息。"
    : store.status === "inactive" ? "门店已下线，请联系运营恢复门店状态后再发布活动。"
    : !fence ? "尚未保存门店位置与范围，请先设置门店范围。"
    : !fence.enabled ? "门店范围尚未启用，请在设置中启用并保存。"
    : !validFence(fence) ? "门店范围数据无效，请重新定位并保存有效的位置和半径。" : "";
  const publishDisabledReason = busy ? "正在保存或核对操作，请等待完成后再发布。"
    : uncertain ? "上次操作结果尚未确认，请先核对后台记录，避免重复提交。"
    : loading ? "正在读取门店范围与活动数据，读取完成后才能发布。"
    : !data ? "活动数据暂时无法读取，请先刷新列表重试。" : storePublishReason;
  const submitDisabledReason = publishDisabledReason || (draftChanged ? "后台公告已被更新，请先重新载入后台内容，再提交修改。" : "");
  const rangeNoticeTitle = !store ? "未找到当前门店" : store.status === "inactive" ? "门店已下线"
    : !fence ? "尚未设置门店范围" : !fence.enabled ? "门店范围尚未启用" : "门店范围无效";
  const clearFeedback = () => { setError(""); setNotice(""); };
  const openEditor = (activity?: StoreActivity) => { if (writeLock.current || uncertain) return; clearFeedback(); setWithdraw(null); setDraft(activity ? activityDraft(activity) : initialDraft()); };
  const openDetail = async (activity: StoreActivity) => {
    if (writeLock.current || uncertain) return;
    const ticket = ++detailSequence.current; clearFeedback(); setSelected(activity); setDetailLoading(true); setDetailFailed(false);
    try {
      const result = await request<StoreActivityState>("storeActivityState", { manage: true, id: activity.id }, "workspace");
      if (!result?.activity || !Array.isArray(result.fences)) throw new Error("该活动公告已不可读取，请刷新列表后核对。");
      if (alive.current && ticket === detailSequence.current) { setSelected(result.activity); setData(current => current ? { ...current, fences: result.fences, ugcReview: result.ugcReview } : current); }
    } catch (cause) { if (alive.current && ticket === detailSequence.current) { setDetailFailed(true); setError(cause instanceof Error ? cause.message : "公告详情暂时无法读取。"); } }
    finally { if (alive.current && ticket === detailSequence.current) setDetailLoading(false); }
  };

  const mutate = async (attempt: Attempt) => {
    if (writeLock.current) return;
    writeLock.current = true; setBusy(true); clearFeedback();
    try {
      const result = await request<StoreActivityMutationResult>(attempt.action, attempt.payload, "workspace");
      if (!result?.activity?.id || typeof result.message !== "string") throw new Error("操作响应不完整，请先核对后台状态。");
      if (!alive.current) return;
      setUncertain(null); setWithdraw(null); if (attempt.action === "storeActivitySave") setDraft(null);
      if (selected?.id === result.activity.id) setSelected(result.activity);
      await load();
      if (alive.current) setNotice(result.message);
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : "操作未完成，请稍后再试。");
      if (isUncertainResult(cause) || (cause instanceof Error && cause.message === "操作响应不完整，请先核对后台状态。")) setUncertain({ ...attempt, checked: false, retryable: false });
      else await load();
    } finally { writeLock.current = false; if (alive.current) setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!draft || locked || loading || draftChanged) return;
    if (!canPublish) { setError(storePublishReason); return; }
    const title = draft.title.trim(), description = draft.description.trim(), startAt = dateValue(draft.start), endAt = dateValue(draft.end);
    if (!title || title.length > STORE_ACTIVITY_TITLE_LIMIT || !description || description.length > STORE_ACTIVITY_DESCRIPTION_LIMIT) { setError("请填写活动标题（1–40 字）与活动说明（1–500 字）。"); return; }
    if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || dateField(startAt) !== draft.start || dateField(endAt) !== draft.end || endAt <= startAt || endAt <= Date.now()) { setError("请填写有效的北京时间，结束时间需晚于开始时间及当前时间。"); return; }
    void mutate({ action: "storeActivitySave", payload: { storeId: scope.storeId, title, description, startAt, endAt, expectedRevision: draft.revision, ...(draft.id ? { id: draft.id } : { requestId: draft.requestId }) }, checked: false, retryable: false });
  };
  const review = (activity: StoreActivity, decision: "publish" | "reject" | "offline", reason = "") => {
    if (locked) return;
    if (decision === "reject" && (reason.trim().length < 2 || reason.trim().length > STORE_ACTIVITY_REVIEW_NOTE_LIMIT)) { setError("请填写 2–160 字的具体退回原因。"); return; }
    void mutate({ action: "storeActivityReview", payload: { id: activity.id, expectedRevision: activity.revision, decision, ...(decision === "reject" ? { reviewNote: reason.trim() } : {}) }, checked: false, retryable: false });
  };
  const reconcile = async () => {
    if (!uncertain || writeLock.current) return;
    writeLock.current = true; setBusy(true); clearFeedback();
    try {
      const { payload, action } = uncertain;
      const result = await request<StoreActivityState>("storeActivityState", { manage: true, ...(payload.id ? { id: payload.id } : { storeId: payload.storeId, requestId: payload.requestId }) }, "workspace");
      if (!result || !Object.hasOwn(result, "activity") || !Array.isArray(result.fences)) throw new Error("后台状态响应不完整，暂不能核对操作结果。");
      if (!alive.current) return;
      const record = result.activity, expected = Number(payload.expectedRevision);
      const savedContent = action === "storeActivitySave" && !!record && record.title === payload.title && record.description === payload.description && record.startAt === payload.startAt && record.endAt === payload.endAt;
      const savedStatus = action === "storeActivityWithdraw" ? record?.status === "offline" : action === "storeActivityReview" ? record?.status === ({ publish: "published", reject: "rejected", offline: "offline" } as Record<string, string>)[String(payload.decision)] && (payload.decision !== "reject" || record.reviewNote === payload.reviewNote) : savedContent;
      const confirmed = !!record && (payload.id ? record.revision > expected && savedStatus : record.requestId === payload.requestId);
      const retryable = payload.id ? !!record && record.revision === expected : record === null;
      if (confirmed) { setUncertain(null); setWithdraw(null); if (action === "storeActivitySave") setDraft(null); setNotice("已核对后台记录，这次操作已保存。"); }
      else { setUncertain({ ...uncertain, checked: true, retryable }); setNotice(retryable ? "后台尚未显示这次修改。核对后可重试原操作；请求编号与版本保持不变。" : "后台记录已发生变化，请先查看最新公告，再重新编辑或审核。"); }
      if (record) setSelected(current => current?.id === record.id ? record : current);
      await load();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "暂时无法核对操作结果。"); }
    finally { writeLock.current = false; if (alive.current) setBusy(false); }
  };
  if (!admin && (!merchant || !scope.storeId)) return <section className="store-activity-manager"><div className="sa-panel"><p>请使用已绑定门店的商家身份或运营身份管理活动公告。</p></div></section>;
  const requireReview = data?.ugcReview ?? reviewRequired;
  return <div className="store-activity-manager" aria-label={admin ? "运营活动公告审核" : "门店活动公告管理"}>
    <section className="sa-panel"><div className="sa-heading"><div><span className="pill"><Megaphone size={15} />{admin ? "活动公告审核" : "本店有活动"}</span><h2>{admin ? "门店活动审核" : "门店活动公告"}</h2><p className="muted">{admin ? "核对活动内容与门店范围，审核通过后按活动时间公开展示。" : "告诉玩家本店正在开展的活动，公告位置使用已保存的门店围栏。"}</p></div><div className="sa-actions"><button type="button" className="outline-button" disabled={loading || locked} onClick={() => { clearFeedback(); void load(); }}><RefreshCw size={17} />刷新列表</button>{merchant && <button type="button" className="gold-button" disabled={loading || locked || !canPublish} aria-describedby={publishDisabledReason ? publishReasonId : undefined} title={publishDisabledReason || undefined} onClick={() => openEditor()}><Plus size={17} />发布活动公告</button>}</div></div>
      {merchant && publishDisabledReason && <p id={publishReasonId} className="muted" role="status">暂不能发布：{publishDisabledReason}</p>}
      <Feedback error={error} notice={notice} />
      {uncertain && <div className="sa-confirm" role="status"><p>这次操作的结果尚未确认，先查询后台记录，避免重复提交。</p><div className="sa-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => void reconcile()}><RefreshCw size={16} />{busy ? "正在核对…" : "核对操作结果"}</button>{uncertain.checked && uncertain.retryable && <button type="button" className="outline-button" disabled={busy} onClick={() => void mutate(uncertain)}>重试原操作</button>}{uncertain.checked && !uncertain.retryable && <button type="button" className="outline-button" disabled={busy} onClick={() => { setUncertain(null); setDraft(null); setWithdraw(null); setNotice("已读取最新列表，请重新打开公告进行核对。"); }}>查看最新公告</button>}</div></div>}
      {merchant && !loading && data && <div className="sa-note"><MapPin size={19} /><div><strong>{canPublish ? `使用${store?.name || "本店"}已保存的门店范围` : rangeNoticeTitle}</strong><p>{canPublish ? `半径 ${Math.round(fence!.radiusMeters!)} 米。${requireReview ? "提交和编辑后需运营审核通过，才能公开展示。" : "当前无需运营审核；保存后按活动时间公开展示。"}` : storePublishReason}</p><div className="sa-actions"><button type="button" className="outline-button" disabled={locked} onClick={onConfigureFence}>设置门店范围</button></div></div></div>}
    </section>
    {draft && <section className="sa-panel sa-form-panel" ref={draftPanel} aria-label="活动公告编辑"><div className="sa-heading"><div><h2>{draft.id ? "编辑活动公告" : "发布本店活动"}</h2><p className="muted">{requireReview ? "保存后重新进入待审核，审核通过前不公开展示。" : "当前无需审核，保存后按开始时间展示活动预告或进行中的活动。"}</p></div></div><form className="sa-form" aria-label="活动公告表单" onSubmit={save}>{draftChanged && latestDraftRecord && <div className="sa-confirm"><p>后台公告已被更新，当前编辑内容尚未覆盖最新记录。请先重新载入，再修改。</p><div className="sa-actions"><button type="button" className="outline-button" disabled={locked} onClick={() => openEditor(latestDraftRecord)}>重新载入后台内容</button></div></div>}<Feedback error={error} notice={notice} /><fieldset disabled={locked || loading || !canPublish}><label><span className="sa-field-head">活动标题<small className="muted">{draft.title.length}/{STORE_ACTIVITY_TITLE_LIMIT}</small></span><input name="title" aria-label="活动标题" maxLength={STORE_ACTIVITY_TITLE_LIMIT} required value={draft.title} placeholder="例如：周末茶香探索活动" onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label><span className="sa-field-head">活动说明<small className="muted">{draft.description.length}/{STORE_ACTIVITY_DESCRIPTION_LIMIT}</small></span><textarea aria-label="活动说明" rows={5} maxLength={STORE_ACTIVITY_DESCRIPTION_LIMIT} required value={draft.description} placeholder="说明活动内容、参与条件与注意事项；不要填写个人敏感信息。" onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><div className="sa-fields"><label>开始时间（北京时间）<input aria-label="活动开始时间" type="datetime-local" required step={60} value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label><label>结束时间（北京时间）<input aria-label="活动结束时间" type="datetime-local" required step={60} value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label></div><p className="muted">可以发布正在进行的活动或未来预告；结束时间须晚于当前时间。活动公告与寻宝任务、优惠券库存分别管理。</p></fieldset><div className="sa-actions"><button type="button" className="outline-button" disabled={locked} onClick={() => { setDraft(null); clearFeedback(); }}>取消编辑</button><button type="submit" className="gold-button" disabled={locked || loading || !canPublish || draftChanged} aria-describedby={submitDisabledReason ? submitReasonId : undefined} title={submitDisabledReason || undefined}><Send size={17} />{busy ? "正在提交…" : requireReview ? "提交审核" : "保存公告"}</button></div>{submitDisabledReason && <p id={submitReasonId} className="muted" role="status">暂不能提交：{submitDisabledReason}</p>}</form></section>}
    <section className="sa-panel" aria-label="活动公告列表">
      <div className="sa-heading"><div><h3>{admin && filter === "pending" ? "待审核公告" : "活动公告记录"}</h3><p className="muted">{!loading && data ? `共 ${data.pagination.total} 条 · ` : ""}状态与活动时间分别显示</p></div></div>
      <div className="sa-filters"><ChoiceField label="筛选活动" value={filter} options={activityFilterOptions} disabled={locked} describedBy={filterDescriptionId} onChange={value => { setFilter(value as StoreActivityFilter); setPage(1); setWithdraw(null); }} />{admin && <ChoiceField label="筛选门店" value={storeFilter} options={[{ value: "", label: "全部门店" }, ...stores.map(item => ({ value: item.id, label: item.name }))]} disabled={locked} onChange={value => { setStoreFilter(value); setPage(1); }} />}</div>
      <p id={filterDescriptionId} className="muted">{activityFilterDescriptions[filter]}</p>
      {loading ? <p role="status">正在读取活动公告…</p> : !data ? <p className="muted">活动列表暂时无法读取，请使用上方刷新按钮重试。</p> : <>{data.activities.length ? <div className="sa-records">{data.activities.map(activity => <article className="sa-record" key={activity.id} data-activity-id={activity.id}><ActivityTags activity={activity} now={now} /><h3>{activity.title}</h3><p className="sa-summary muted">{activity.description}</p><ActivityFacts activity={activity} />{activity.reviewNote && <p className="sa-feedback error">审核说明：{activity.reviewNote}</p>}{activity.status === "published" && !validFence(data.fences.find(item => item.storeId === activity.storeId)) && <p className="muted">门店围栏当前不可用，公告暂停公开展示。</p>}<div className="sa-actions"><button type="button" className="outline-button" aria-haspopup="dialog" disabled={locked} onClick={() => void openDetail(activity)}>查看详情</button>{merchant && <><button type="button" className="outline-button" disabled={locked || !canPublish} onClick={() => openEditor(activity)}><Edit3 size={16} />编辑</button>{activity.status !== "offline" && <button type="button" className="text-button" disabled={locked} onClick={() => { clearFeedback(); setWithdraw(activity); }}>下架</button>}</>}</div>{withdraw?.id === activity.id && <div className="sa-confirm" role="alertdialog" aria-label="下架活动公告"><p>确认下架「{activity.title}」？公告将停止公开展示，已有记录保留。</p><div className="sa-actions"><button type="button" className="outline-button" disabled={locked} onClick={() => setWithdraw(null)}>取消</button><button type="button" className="gold-button" disabled={locked} onClick={() => void mutate({ action: "storeActivityWithdraw", payload: { id: activity.id, expectedRevision: withdraw.revision }, checked: false, retryable: false })}>确认下架</button></div></div>}</article>)}</div> : <div className="sa-empty"><Megaphone size={28} /><h3>{filter === "pending" ? "没有待审核的活动公告" : filter === "rejected" ? "没有被退回的活动公告" : filter === "published" ? "没有已发布的活动公告" : filter === "offline" ? "没有已下架的活动公告" : filter === "expired" ? "没有已结束的活动公告" : "还没有活动公告"}</h3><p className="muted">{merchant ? "设置门店范围后，可在上方发布本店活动。" : "公告提交后会出现在相应状态中，可切换筛选查看其他记录。"}</p></div>}{data.pagination.totalPages > 1 && <div className="sa-pagination"><p className="muted">第 {data.pagination.page} / {data.pagination.totalPages} 页</p><div className="sa-actions"><button type="button" className="outline-button" aria-label="活动公告上一页" disabled={locked || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} />上一页</button><button type="button" className="outline-button" aria-label="活动公告下一页" disabled={locked || page >= data.pagination.totalPages} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={16} /></button></div></div>}</> }</section>
    {selected && <ActivityDialog activity={selected} admin={admin} busy={busy} mutationDisabled={locked || detailLoading || detailFailed} loading={detailLoading} uncertain={!!uncertain} error={error} notice={notice} publishable={validFence(data?.fences.find(item => item.storeId === selected.storeId)) && selected.endAt > now && stores.find(item => item.id === selected.storeId)?.status !== "inactive"} now={now} onClose={() => { detailSequence.current++; setDetailLoading(false); setSelected(null); if (!uncertain) clearFeedback(); }} onReview={review} />}
  </div>;
}
