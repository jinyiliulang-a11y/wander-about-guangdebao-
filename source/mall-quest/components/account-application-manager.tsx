"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, RefreshCw, ShieldCheck, Store, Ticket, UserRound, X } from "lucide-react";
import type { AccountApplication, AccountApplicationsResult, AccountStatus, MerchantRegistration, RegistrationCoupon } from "@/lib/account-types";
import { isUncertainResult } from "@/lib/game-api";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import "./account-application-manager.css";

type Props = {
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown | null>;
  busy: boolean;
  onRefresh?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};
type Filter = AccountStatus | "all";
type ReviewPayload = { id: string; expectedRevision: number; status: "approved" | "rejected"; note: string };
type Attempt = { payload: ReviewPayload; checked: boolean; retryable: boolean; latest: AccountApplication | null };
const statusNames = { pending: "待审核", approved: "已通过", rejected: "已退回" };
const roleNames = { player: "玩家账号", merchant: "商家账号", admin: "运营账号" };
const couponNames = { cash: "满减券", discount: "折扣券", gift: "赠品券" };
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || !!document.querySelector('[data-reduce-motion="true"]');
const dateTime = (value: number | null) => value === null ? "未设限制" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(value);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
const optionalTime = (value: unknown): value is number | null => value === null || timestamp(value);

// Copy only the shared public DTO fields. Credentials or extra transport fields never enter component state.
function safeCoupon(value: unknown): RegistrationCoupon | null {
  const source = record(value);
  if (!source || typeof source.title !== "string" || !["cash", "discount", "gift"].includes(String(source.type)) || !finite(source.value) || !finite(source.minAmount) || !Number.isSafeInteger(source.totalCount) || typeof source.conditions !== "string" || !optionalTime(source.validStart) || !optionalTime(source.validEnd)) return null;
  return { title: source.title, type: source.type as RegistrationCoupon["type"], value: source.value, minAmount: source.minAmount, totalCount: source.totalCount as number, conditions: source.conditions, validStart: source.validStart, validEnd: source.validEnd };
}
function safeMerchant(value: unknown): MerchantRegistration | null {
  const source = record(value);
  if (!source || !["name", "address", "floor", "area", "category", "phone"].every(key => typeof source[key] === "string") || !finite(source.latitude) || !finite(source.longitude) || !finite(source.radiusMeters)) return null;
  const coupon = safeCoupon(source.coupon);
  return coupon ? { name: source.name as string, address: source.address as string, floor: source.floor as string, area: source.area as string, category: source.category as string, phone: source.phone as string, latitude: source.latitude, longitude: source.longitude, radiusMeters: source.radiusMeters, coupon } : null;
}
function safeApplication(value: unknown): AccountApplication | null {
  const source = record(value);
  if (!source || !["id", "username", "nickname", "reviewNote"].every(key => typeof source[key] === "string") || !["player", "merchant", "admin"].includes(String(source.role)) || !["pending", "approved", "rejected"].includes(String(source.status)) || !Number.isSafeInteger(source.revision) || Number(source.revision) < 1 || !timestamp(source.createdAt) || !timestamp(source.updatedAt) || (source.phoneMasked !== null && typeof source.phoneMasked !== "string") || (source.storeId !== null && typeof source.storeId !== "string") || (source.requestId !== null && typeof source.requestId !== "string")) return null;
  const merchant = source.merchant === null ? null : safeMerchant(source.merchant);
  if (source.role === "merchant" && !merchant) return null;
  return { id: source.id as string, requestId: source.requestId as string | null, username: source.username as string, role: source.role as AccountApplication["role"], nickname: source.nickname as string, phoneMasked: source.phoneMasked as string | null, status: source.status as AccountStatus, reviewNote: source.reviewNote as string, revision: source.revision as number, storeId: source.storeId as string | null, merchant, createdAt: source.createdAt, updatedAt: source.updatedAt };
}
function safeList(value: unknown): AccountApplicationsResult | null {
  const source = record(value), pagination = record(source?.pagination);
  if (!source || !Array.isArray(source.applications) || !pagination || pagination.pageSize !== 20 || !["page", "total", "totalPages"].every(key => Number.isSafeInteger(pagination[key])) || Number(pagination.page) < 1 || Number(pagination.total) < 0 || Number(pagination.totalPages) < 0) return null;
  const applications = source.applications.map(safeApplication);
  if (applications.some(item => item === null)) return null;
  return { applications: applications as AccountApplication[], pagination: { page: pagination.page as number, pageSize: 20, total: pagination.total as number, totalPages: pagination.totalPages as number } };
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  return <>{error && <p className="aa-feedback error" role="alert"><AlertTriangle size={18} />{error}</p>}{notice && <p className="aa-feedback" role="status"><CheckCircle2 size={18} />{notice}</p>}</>;
}
function AccountTags({ application }: { application: AccountApplication }) {
  return <div className="aa-tags"><span className={`aa-tag ${application.status}`}><ShieldCheck size={14} />{statusNames[application.status]}</span><span className="aa-tag">{application.role === "merchant" ? <Store size={14} /> : <UserRound size={14} />}{roleNames[application.role]}</span></div>;
}
function AccountFacts({ application }: { application: AccountApplication }) {
  return <dl className="aa-facts"><div><dt>用户名</dt><dd>{application.username}</dd></div><div><dt>昵称</dt><dd>{application.nickname || "未填写"}</dd></div><div><dt>联系手机</dt><dd>{application.phoneMasked || "未填写"}</dd></div><div><dt>申请时间</dt><dd>{dateTime(application.createdAt)}</dd></div></dl>;
}
function MerchantFacts({ merchant }: { merchant: MerchantRegistration }) {
  const coupon = merchant.coupon;
  return <><section className="aa-detail-block"><h3><MapPin size={18} />门店资料</h3><dl className="aa-facts"><div><dt>门店名称</dt><dd>{merchant.name}</dd></div><div><dt>完整地址</dt><dd>{merchant.address}</dd></div><div><dt>楼层 / 区域</dt><dd>{merchant.floor} / {merchant.area}</dd></div><div><dt>经营类别</dt><dd>{merchant.category}</dd></div><div><dt>门店电话</dt><dd>{merchant.phone || "未填写"}</dd></div><div><dt>门店坐标</dt><dd>{merchant.latitude.toFixed(6)}, {merchant.longitude.toFixed(6)}<small className="muted">WGS84 · 纬度、经度</small></dd></div><div><dt>到店范围</dt><dd>半径 {merchant.radiusMeters} 米</dd></div></dl></section><section className="aa-detail-block"><h3><Ticket size={18} />首张优惠券</h3><dl className="aa-facts"><div><dt>券名称</dt><dd>{coupon.title}</dd></div><div><dt>类型 / 优惠</dt><dd>{couponNames[coupon.type]} · {coupon.type === "cash" ? `减 ${coupon.value} 元` : coupon.type === "discount" ? `${coupon.value} 折` : `赠品参考值 ${coupon.value} 元`}</dd></div><div><dt>消费门槛</dt><dd>{coupon.minAmount > 0 ? `满 ${coupon.minAmount} 元` : "无金额门槛"}</dd></div><div><dt>发放数量</dt><dd>{coupon.totalCount} 张</dd></div><div><dt>有效开始</dt><dd>{dateTime(coupon.validStart)}</dd></div><div><dt>有效截止</dt><dd>{dateTime(coupon.validEnd)}</dd></div><div><dt>使用条件</dt><dd className="aa-preserve">{coupon.conditions || "未填写"}</dd></div></dl></section></>;
}

function ReviewDialog({ application, loading, failed, locked, writing, uncertain, error, notice, onClose, onReview, onReload }: {
  application: AccountApplication; loading: boolean; failed: boolean; locked: boolean; writing: boolean; uncertain: boolean; error: string; notice: string;
  onClose: () => void; onReview: (application: AccountApplication, status: ReviewPayload["status"], note: string) => void; onReload: () => void;
}) {
  const panel = useRef<HTMLDialogElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), closeRef = useRef(onClose);
  const [closing, setClosing] = useState(false), [note, setNote] = useState("");
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const close = () => { if (writing || closing) return; if (reducedMotion()) { closeRef.current(); return; } setClosing(true); timer.current = setTimeout(() => closeRef.current(), 230); };
  useEffect(() => {
    const dialog = panel.current; if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = acquireOverlayScroll(); dialog.showModal();
    return () => { clearTimeout(timer.current); dialog.close(); release(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={panel} className={`aa-dialog${closing ? " is-closing" : ""}`} aria-label="账号申请审核详情" aria-modal="true" onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target === panel.current) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); }
  }}><div className="aa-dialog-head"><div><span className="muted">账号申请 · {roleNames[application.role]}</span><h2>{application.username}</h2></div><button type="button" className="aa-close" aria-label="关闭账号申请详情" disabled={writing || closing} onClick={close}><X size={20} /></button></div><div className="aa-dialog-content" inert={closing || undefined}><AccountTags application={application} /><AccountFacts application={application} />{application.merchant && <MerchantFacts merchant={application.merchant} />}{application.reviewNote && <div className="aa-note"><AlertTriangle size={18} /><div><strong>审核说明</strong><p className="aa-preserve">{application.reviewNote}</p></div></div>}
    {loading && <p role="status">正在核对最新申请资料与版本…</p>}<Feedback error={error} notice={notice} />{failed && <div className="aa-actions"><button type="button" className="outline-button" disabled={locked || loading} onClick={onReload}><RefreshCw size={17} />重新读取最新申请</button></div>}
    {uncertain && <p className="aa-feedback">这次审核的结果尚未确认，草稿已保留。请关闭详情，在列表上方核对后台状态后再决定是否重试。</p>}
    {application.status === "pending" && application.role !== "player" && <><div className="aa-confirm"><p>{application.role === "merchant" ? "通过后创建门店、启用提交的到店范围，并建立首张优惠券。请先核对真实地址、位置与券条件。" : "通过后该账号获得运营后台权限，可审核内容和管理平台。请核对申请人的身份。"}</p></div><label className="aa-reason"><span>审核说明<small className="muted">退回必填 2–160 字 · {note.length}/160</small></span><textarea aria-label="账号审核说明" maxLength={160} rows={3} placeholder="通过时可留说明；退回时请说明需要修改的资料，至少 2 字" value={note} disabled={locked || loading || failed || closing} onChange={event => setNote(event.target.value)} /></label><div className="aa-actions"><button type="button" className="outline-button" disabled={locked || loading || failed || closing} onClick={() => onReview(application, "rejected", note)}>退回申请</button><button type="button" className="gold-button" disabled={locked || loading || failed || closing} onClick={() => onReview(application, "approved", note)}><CheckCircle2 size={17} />{writing ? "正在保存…" : "审核通过"}</button></div></>}
    {application.status !== "pending" && <p className="muted">该申请已{application.status === "approved" ? "通过" : "退回"}，本页保留审核记录，不重复授予权限。</p>}
  </div></dialog>;
}

/** Rendered only in the authorized admin workspace; each API still enforces admin authorization. */
export function AccountApplicationManager({ onAction, busy: externalBusy, onRefresh, onBusyChange }: Props) {
  const [data, setData] = useState<AccountApplicationsResult | null>(null), [filter, setFilter] = useState<Filter>("pending"), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [writing, setWriting] = useState(false), [checking, setChecking] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AccountApplication | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailFailed, setDetailFailed] = useState(false);
  const [uncertain, setUncertain] = useState<Attempt | null>(null);
  const opener = useRef<HTMLElement | null>(null), restoreFocus = useRef(false), statusPicker = useRef<HTMLSelectElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true), readSequence = useRef(0), detailSequence = useRef(0), writeLock = useRef(false), actionRef = useRef(onAction), refreshRef = useRef(onRefresh), busyChangeRef = useRef(onBusyChange);
  useEffect(() => { actionRef.current = onAction; refreshRef.current = onRefresh; busyChangeRef.current = onBusyChange; }, [onAction, onRefresh, onBusyChange]);
  const pendingOperation = writing || !!uncertain;
  useEffect(() => { busyChangeRef.current?.(pendingOperation); }, [pendingOperation]);
  useEffect(() => () => { busyChangeRef.current?.(false); }, []);
  const invalidate = useCallback(() => { readSequence.current++; detailSequence.current++; }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; invalidate(); }; }, [invalidate]);
  useEffect(() => {
    if (selected || writing || checking || externalBusy || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (!alive.current) return;
      restoreFocus.current = false;
      const target = opener.current?.isConnected && !opener.current.matches(":disabled") ? opener.current : statusPicker.current && !statusPicker.current.disabled ? statusPicker.current : heading.current;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, writing, checking, externalBusy]);
  const locked = externalBusy || writing || checking || !!uncertain;
  const clearFeedback = () => { setError(""); setNotice(""); };
  const load = useCallback(async () => {
    const ticket = ++readSequence.current; setLoading(true);
    try {
      const next = safeList(await actionRef.current("accountApplications", { filter, page }));
      if (!next) throw new Error("账号申请列表响应不完整，请重新读取。");
      if (alive.current && ticket === readSequence.current) {
        const lastPage = Math.max(1, next.pagination.totalPages);
        if (page > lastPage) { setPage(lastPage); return next; }
        setData(next); return next;
      }
    } catch (cause) { if (alive.current && ticket === readSequence.current) setError(cause instanceof Error ? cause.message : "账号申请暂时无法读取。"); }
    finally { if (alive.current && ticket === readSequence.current) setLoading(false); }
  }, [filter, page]);
  useEffect(() => { let cancelled = false; void Promise.resolve().then(() => { if (!cancelled) { setData(null); setError(""); void load(); } }); return () => { cancelled = true; }; }, [load]);
  const loadDetail = async (application: AccountApplication) => {
    const ticket = ++detailSequence.current; setDetailLoading(true); setDetailFailed(false);
    try {
      const result = record(await actionRef.current("accountApplication", { id: application.id })), latest = safeApplication(result?.application);
      if (!latest || latest.id !== application.id) throw new Error("该申请已不可读取，请刷新列表核对。");
      if (alive.current && ticket === detailSequence.current) { setSelected(latest); return latest; }
    } catch (cause) { if (alive.current && ticket === detailSequence.current) { setDetailFailed(true); setError(cause instanceof Error ? cause.message : "最新申请资料读取失败。"); } }
    finally { if (alive.current && ticket === detailSequence.current) setDetailLoading(false); }
  };
  const openDetail = (application: AccountApplication, trigger: HTMLElement) => { if (locked || writeLock.current) return; opener.current = trigger; restoreFocus.current = false; clearFeedback(); setSelected(application); void loadDetail(application); };
  const closeDetail = () => { if (writeLock.current || writing) return; detailSequence.current++; restoreFocus.current = true; setSelected(null); setDetailLoading(false); setDetailFailed(false); };
  const refreshOtherPanels = async () => {
    try { await refreshRef.current?.(); }
    catch { if (alive.current) setNotice("审核已保存，其他工作台数据暂未刷新，请点右上角刷新。"); }
  };
  const mutate = async (payload: ReviewPayload) => {
    if (writeLock.current || externalBusy) return;
    writeLock.current = true; setWriting(true); clearFeedback();
    // A manual retry invalidates the preceding read; another failed attempt must be checked again.
    setUncertain(current => current ? { ...current, checked: false, retryable: false, latest: null } : null);
    let responseMissing = false;
    try {
      const result = record(await actionRef.current("accountReview", payload)), application = safeApplication(result?.application);
      if (!application || application.id !== payload.id || application.status !== payload.status || application.reviewNote !== payload.note || application.revision !== payload.expectedRevision + 1 || typeof result?.message !== "string") { responseMissing = true; throw new Error("审核响应不完整，操作可能已保存，请先核对后台状态。"); }
      if (!alive.current) return;
      setUncertain(null); restoreFocus.current = true; setSelected(null); detailSequence.current++; setDetailLoading(false); setDetailFailed(false);
      await load();
      if (alive.current) setNotice(result.message);
      await refreshOtherPanels();
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : "审核操作未完成，请稍后再试。");
      if (responseMissing || isUncertainResult(cause)) setUncertain({ payload, checked: false, retryable: false, latest: null });
      else { if (selected?.id === payload.id) await loadDetail(selected); await load(); }
    } finally { writeLock.current = false; if (alive.current) setWriting(false); }
  };
  const review = (application: AccountApplication, status: ReviewPayload["status"], rawNote: string) => {
    if (locked || writeLock.current || detailLoading || detailFailed || application.status !== "pending" || application.role === "player") return;
    const note = rawNote.trim();
    if (note.length > 160 || (status === "rejected" && note.length < 2)) { setError("退回时请填写 2–160 字的具体原因，通过时说明可留空。"); return; }
    void mutate({ id: application.id, expectedRevision: application.revision, status, note });
  };
  const reconcile = async () => {
    if (!uncertain || writeLock.current || externalBusy) return;
    writeLock.current = true; setChecking(true); clearFeedback();
    try {
      const result = record(await actionRef.current("accountApplication", { id: uncertain.payload.id })), application = safeApplication(result?.application);
      if (!application || application.id !== uncertain.payload.id) throw new Error("后台申请状态暂时无法核对，请保留草稿后重试读取。");
      if (!alive.current) return;
      const payload = uncertain.payload, confirmed = application.revision === payload.expectedRevision + 1 && application.status === payload.status && application.reviewNote === payload.note;
      if (confirmed) { setUncertain(null); restoreFocus.current = true; setSelected(null); detailSequence.current++; setDetailLoading(false); setDetailFailed(false); setNotice("已核对后台记录，这次审核已保存。"); }
      else { const retryable = application.revision === payload.expectedRevision && application.status === "pending"; setUncertain({ ...uncertain, checked: true, retryable, latest: application }); setNotice(retryable ? "后台仍为原待审版本。你可以明确重试原操作，审核说明与版本保持不变。" : "该申请已被其他操作更新。请查看最新状态，再决定下一步。"); }
      await load();
      if (confirmed) await refreshOtherPanels();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "暂时无法核对，请稍后再读取。"); }
    finally { writeLock.current = false; if (alive.current) setChecking(false); }
  };
  const acceptLatest = () => {
    if (!uncertain?.latest || writeLock.current || externalBusy) return;
    const application = uncertain.latest; setUncertain(null); setSelected(application); setDetailFailed(false); setDetailLoading(false); setError(""); setNotice("已显示后台最新申请。原操作未自动重试，请重新核对后决定。");
    void loadDetail(application);
  };

  return <div className="account-application-manager"><section className="aa-panel"><div className="aa-heading"><div><h2 ref={heading} tabIndex={-1}><ClipboardCheck size={23} />账号申请审核</h2><p className="muted">商家及运营注册后先等待审核；通过前不授予工作台权限。此处仅供已授权运营管理员使用。</p></div><div className="aa-actions"><button type="button" className="outline-button" disabled={locked || loading} onClick={() => { clearFeedback(); void load(); }}><RefreshCw size={17} />刷新申请</button></div></div><Feedback error={error} notice={notice} />
    {uncertain && <div className="aa-confirm aa-uncertain" role="status"><strong>上次审核结果待核对</strong><p>申请：{uncertain.payload.id}。审核说明草稿保留在当前页面；核对期间暂停新的审核操作。</p><div className="aa-actions"><button type="button" className="outline-button" disabled={externalBusy || writing || checking} onClick={() => void reconcile()}><RefreshCw size={17} />{checking ? "正在核对…" : "核对后台状态"}</button>{uncertain.checked && uncertain.retryable && <button type="button" className="gold-button" disabled={externalBusy || writing || checking} onClick={() => void mutate(uncertain.payload)}>重试原审核</button>}{uncertain.checked && !uncertain.retryable && uncertain.latest && <button type="button" className="outline-button" disabled={externalBusy || writing || checking} onClick={acceptLatest}>查看最新状态</button>}</div></div>}
    <div className="aa-filters"><label><span>申请状态</span><span className="aa-select"><select ref={statusPicker} aria-label="账号申请状态" disabled={locked || loading} value={filter} onChange={event => { clearFeedback(); setFilter(event.target.value as Filter); setPage(1); }}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已退回</option><option value="all">全部申请</option></select><ChevronDown size={18} aria-hidden="true" /></span></label><p className="muted">{data ? `共 ${data.pagination.total} 条申请 · 每页 20 条` : "正在读取申请"}</p></div>
    {loading && <p role="status">正在读取账号申请…</p>}{!loading && data && !data.applications.length && <div className="aa-empty"><ClipboardCheck size={30} /><h3>{filter === "pending" ? "暂无待审核账号" : filter === "approved" ? "暂无已通过账号" : filter === "rejected" ? "暂无已退回申请" : "暂无账号申请"}</h3><p className="muted">{filter === "pending" ? "新的商家与运营申请会在这里出现。" : "切换申请状态可以查看其他记录。"}</p></div>}
    {data && <div className="aa-records">{data.applications.map(application => <article className="aa-record" key={application.id}><AccountTags application={application} /><h3>{application.username}</h3><AccountFacts application={application} />{application.merchant && <MerchantFacts merchant={application.merchant} />}{application.reviewNote && <p className="aa-note aa-preserve">审核说明：{application.reviewNote}</p>}<div className="aa-actions"><button type="button" className={application.status === "pending" && application.role !== "player" ? "gold-button" : "outline-button"} disabled={locked || loading} onClick={event => openDetail(application, event.currentTarget)}><ClipboardCheck size={17} />{application.status === "pending" && application.role !== "player" ? "查看并审核" : "查看申请详情"}</button></div></article>)}</div>}
    {data && <div className="aa-pagination"><p className="muted">第 {data.pagination.page} / {Math.max(1, data.pagination.totalPages)} 页</p><div className="aa-actions"><button type="button" className="outline-button" disabled={locked || loading || page <= 1} onClick={() => { clearFeedback(); setPage(value => Math.max(1, value - 1)); }}><ChevronLeft size={17} />上一页</button><button type="button" className="outline-button" disabled={locked || loading || page >= data.pagination.totalPages} onClick={() => { clearFeedback(); setPage(value => value + 1); }}>下一页<ChevronRight size={17} /></button></div></div>}
  </section>{selected && <ReviewDialog key={selected.id} application={selected} loading={detailLoading} failed={detailFailed} locked={locked} writing={writing || externalBusy} uncertain={!!uncertain} error={error} notice={notice} onClose={closeDetail} onReview={review} onReload={() => { clearFeedback(); void loadDetail(selected); }} />}</div>;
}
