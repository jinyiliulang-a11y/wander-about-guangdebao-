"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Ban, CheckCircle2, Coins, Compass, FileText, RefreshCw, Search, ShieldCheck, Ticket, TrendingUp, Users, X } from "lucide-react";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import { browserRequestId } from "@/lib/browser-id";
import type { OperationsUser, OperationsUserDetail, OperationsUserPagination } from "@/lib/operations-user-types";
import type { Coupon, Task } from "@/lib/game-types";
import type { WorkbenchAction, WorkbenchData } from "./workbench-pages";
import "./operations-user-detail.css";

type RecordTab = "claims" | "placements" | "ledger";
type Tab = "overview" | RecordTab | "manage";
type Pages = Record<RecordTab, number>;
type Adjustment = { signature: string; requestId: string };
type Confirmation = { kind: "points"; delta: number; reason: string; requestId: string; signature: string } | { kind: "status"; banned: boolean };
const tabs = [
  { id: "overview", label: "概览", icon: Compass },
  { id: "claims", label: "领奖记录", icon: Ticket },
  { id: "placements", label: "投稿记录", icon: FileText },
  { id: "ledger", label: "积分账本", icon: Coins },
  { id: "manage", label: "管理操作", icon: ShieldCheck },
] as const;
const firstPages = (): Pages => ({ claims: 1, placements: 1, ledger: 1 });
const numberText = (value: number) => value.toLocaleString("zh-CN");
const dateTime = (value?: number | null) => value && Number.isFinite(value)
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(value)
  : "未记录";
const reducedMotion = () => document.documentElement.dataset.questReduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ledgerKinds: Record<string, string> = { claim: "寻宝奖励", contribution: "创作贡献", achievement: "成就奖励", adjustment: "运营调整", clue: "解锁线索", unlock: "解锁线索", clue_unlock: "解锁线索", initial: "初始积分", seed: "演示初始化" };

function validDetail(value: unknown, playerId: string): value is OperationsUserDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as OperationsUserDetail;
  if (detail.user?.id !== playerId || !Array.isArray(detail.claims) || !Array.isArray(detail.placements) || !Array.isArray(detail.ledger) || !detail.activity || !detail.permissions || typeof detail.permissions.canChangeStatus !== "boolean") return false;
  return (["claims", "placements", "ledger"] as const).every(key => {
    const page = detail.pagination?.[key];
    return page && Number.isSafeInteger(page.page) && page.page >= 1 && page.pageSize === 10 && Number.isSafeInteger(page.total) && page.total >= 0 && Number.isSafeInteger(page.totalPages) && page.totalPages >= 1;
  });
}

export function OperationsUsers({ data, onAction, busy = false, onSearch, operatorId, pendingAdjustments }: {
  data: WorkbenchData; onAction: WorkbenchAction; busy?: boolean; onSearch?: (search: string) => Promise<unknown>;
  operatorId: string; pendingAdjustments: RefObject<Map<string, Adjustment>>;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<OperationsUser | null>(null);
  const searchLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = useCallback(() => setSelected(null), []);
  const users = onSearch ? data.users : data.users.filter(user => `${user.nickname} ${user.id} ${user.phoneMasked || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const searchUsers = async (value: string) => {
    if (!onSearch || searchLock.current || busy) return;
    searchLock.current = true; setSearching(true); setSearchError("");
    try { await onSearch(value.trim()); }
    catch (cause) { if (mounted.current) setSearchError(cause instanceof Error ? cause.message : "搜索暂时无法完成"); }
    finally { searchLock.current = false; if (mounted.current) setSearching(false); }
  };
  if (data.scope.role !== "admin") return <section className="surface wb-panel"><p>请先使用运营身份进入此页面。</p></section>;
  return <div className="wb-stack">
    <section className="surface wb-panel">
      <div className="wb-heading"><div><h2><Users size={20} />用户管理</h2><p className="muted">查看真实活动记录，管理账号状态与积分。</p></div>
        <form className="wb-search" onSubmit={event => { event.preventDefault(); void searchUsers(search); }}>
          <label className="search-field"><Search size={16} /><input aria-label="搜索用户" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} placeholder={onSearch ? "昵称或手机号" : "昵称、用户ID或手机尾号"} /></label>
          {onSearch && <button type="submit" className="outline-button" disabled={busy || searching}>{searching ? "搜索中…" : "搜索"}</button>}
          {search && <button type="button" className="text-button" disabled={busy || searching} onClick={() => { setSearch(""); void searchUsers(""); }}>清空搜索</button>}
        </form>
      </div>
      {searchError && <p className="wb-error" role="alert">{searchError}</p>}
      <p className="wb-note" role="status">{searching ? "正在查找用户…" : `当前显示 ${numberText(users.length)} 位用户`}</p>
      <div className="wb-table-scroll"><table><thead><tr><th>用户</th><th>身份</th><th>积分</th><th>领奖</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id}><td><strong>{user.nickname}</strong><small>{user.phoneMasked || user.id}</small></td><td>{user.authenticated ? "已登录" : "匿名试玩"}</td><td>{numberText(user.points)}</td><td>{numberText(user.claimCount)}</td><td>{user.banned ? "已封禁" : "正常"}</td><td><button className="text-button" aria-haspopup="dialog" data-player-id={user.id} disabled={busy || searching} onClick={() => setSelected(user)}>查看详情</button></td></tr>)}</tbody>
      </table></div>
      {!users.length && <p className="wb-empty">没有匹配的用户记录。可以修改关键词或清空搜索。</p>}
    </section>
    {selected && <UserDetailDialog key={selected.id} selected={selected} onAction={onAction} onClose={close} adjustments={pendingAdjustments} operatorId={operatorId} />}
  </div>;
}

function UserDetailDialog({ selected, onAction, onClose, adjustments, operatorId }: {
  selected: OperationsUser; onAction: WorkbenchAction; onClose: () => void; adjustments: RefObject<Map<string, Adjustment>>; operatorId: string;
}) {
  const [detail, setDetail] = useState<OperationsUserDetail | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [readingTab, setReadingTab] = useState<RecordTab | null>(null);
  const [readError, setReadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncRequired, setSyncRequired] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [phase, setPhase] = useState<"enter" | "open" | "closing">("enter");
  const [readAt, setReadAt] = useState(() => Date.now());
  const alive = useRef(true);
  const requestSequence = useRef(0);
  const operationLock = useRef(false);
  const closing = useRef(false);
  const pages = useRef<Pages>(firstPages());
  const lastRequest = useRef<Pages>(firstPages());
  const dialog = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const historyId = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useRef<() => void>(() => {});
  const parentClose = useRef(onClose);
  const actions = useRef(onAction);
  const workspace = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".workspace-shell");
  useEffect(() => { parentClose.current = onClose; actions.current = onAction; }, [onClose, onAction]);

  const loadDetail = useCallback(async (requested = pages.current, tab: RecordTab | null = null) => {
    const sequence = ++requestSequence.current;
    lastRequest.current = { ...requested };
    setLoading(true); setReadingTab(tab); setReadError("");
    try {
      const result = await actions.current("opsUserDetail", { playerId: selected.id, claimsPage: requested.claims, placementsPage: requested.placements, ledgerPage: requested.ledger });
      if (!alive.current || closing.current || sequence !== requestSequence.current) return false;
      if (!validDetail(result, selected.id)) throw new Error("用户详情未能正确读取，请重试");
      pages.current = { claims: result.pagination.claims.page, placements: result.pagination.placements.page, ledger: result.pagination.ledger.page };
      setDetail(result); setReadAt(Date.now()); setSyncRequired(false);
      return true;
    } catch (cause) {
      if (alive.current && !closing.current && sequence === requestSequence.current) setReadError(cause instanceof Error ? cause.message : "用户详情暂时无法读取");
      return false;
    } finally {
      if (alive.current && !closing.current && sequence === requestSequence.current) { setLoading(false); setReadingTab(null); }
    }
  }, [selected.id]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const invalidate = () => { requestSequence.current++; };
    void Promise.resolve().then(() => { if (!cancelled) void loadDetail(firstPages()); });
    return () => { cancelled = true; alive.current = false; invalidate(); };
  }, [loadDetail]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !workspace) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const releaseScroll = acquireOverlayScroll();
    const protectedNodes = Array.from(workspace.children).filter(node => node instanceof HTMLElement && !node.classList.contains("ops-user-backdrop")) as HTMLElement[];
    const originalInert = protectedNodes.map(node => ({ node, inert: node.inert }));
    protectedNodes.forEach(node => { node.inert = true; });
    historyId.current = browserRequestId();
    const historyMarker = () => ({ ...window.history.state, mallQuestModal: historyId.current, mallQuestModalKind: "operations-user" });
    window.history.pushState(historyMarker(), "", window.location.href);
    const finish = () => { if (alive.current) parentClose.current(); };
    const animateClose = () => {
      if (operationLock.current || closing.current) return;
      closing.current = true; requestSequence.current++;
      if (reducedMotion()) { finish(); return; }
      setPhase("closing"); timer.current = setTimeout(finish, 220);
    };
    const close = () => {
      if (operationLock.current || closing.current) return;
      if (window.history.state?.mallQuestModal === historyId.current) window.history.back();
      else animateClose();
    };
    dismiss.current = close;
    const back = () => {
      if (window.history.state?.mallQuestModal === historyId.current) return;
      if (operationLock.current) {
        window.history.pushState(historyMarker(), "", window.location.href);
        setNotice("正在保存，请稍候再关闭详情。");
      } else animateClose();
    };
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>("button,input,textarea,select,a[href],[tabindex='0']")).filter(node => !node.hasAttribute("disabled") && node.offsetParent !== null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key !== "Tab") return;
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (!element.contains(event.target as Node)) (focusable()[0] || element).focus({ preventScroll: true }); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", containFocus);
    window.addEventListener("popstate", back);
    element.querySelector<HTMLElement>("[aria-label='关闭用户详情']")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", key, true); document.removeEventListener("focusin", containFocus); window.removeEventListener("popstate", back);
      if (timer.current) clearTimeout(timer.current);
      originalInert.forEach(({ node, inert }) => { if (node.isConnected) node.inert = inert; });
      releaseScroll();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else Array.from(workspace.querySelectorAll<HTMLButtonElement>("button[data-player-id]")).find(node => node.dataset.playerId === selected.id)?.focus({ preventScroll: true });
      if (window.history.state?.mallQuestModal === historyId.current) {
        const state = { ...window.history.state }; delete state.mallQuestModal; delete state.mallQuestModalKind;
        window.history.replaceState(state, "", window.location.href);
      }
    };
  }, [selected.id, workspace]);

  const scrollToRecords = () => {
    requestAnimationFrame(() => {
      const scroller = body.current;
      const anchor = dialog.current?.querySelector<HTMLElement>(".ops-user-record-anchor");
      if (!scroller || !anchor || closing.current || !alive.current) return;
      // Keep the chosen records in view instead of returning to the identity
      // card, which can be tall on a small phone or with a long nickname.
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8), behavior: "auto" });
    });
  };
  const changeTab = (tab: Tab) => {
    if (operationLock.current || closing.current) return;
    setActiveTab(tab); setConfirmation(null); setOperationError("");
    scrollToRecords();
  };
  const selectTabByKeyboard = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null || operationLock.current) return;
    event.preventDefault(); changeTab(tabs[next].id);
    dialog.current?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
  };
  const requestPage = async (tab: RecordTab, page: number) => {
    if (loading || operationLock.current || closing.current) return;
    if (await loadDetail({ ...pages.current, [tab]: page }, tab)) {
      requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("[role='tabpanel']")?.focus({ preventScroll: true }));
      scrollToRecords();
    }
  };
  const prepareAdjustment = (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || operationLock.current || syncRequired || loading) return;
    const change = Number(delta), explanation = reason.trim();
    if (!delta.trim() || !Number.isSafeInteger(change) || change === 0 || Math.abs(change) > 100000) { setOperationError("请输入 -100000 至 100000 的非零整数。"); return; }
    if (explanation.length < 2 || explanation.length > 120) { setOperationError("调整原因请填写 2 至 120 字。"); return; }
    if (detail.user.points + change < 0) { setOperationError("扣减后积分不能小于 0。"); return; }
    const signature = JSON.stringify({ operatorId, playerId: selected.id, delta: change, reason: explanation });
    let intent = adjustments.current.get(signature);
    if (!intent) { intent = { signature, requestId: browserRequestId() }; adjustments.current.set(signature, intent); }
    setOperationError(""); setNotice(""); setConfirmation({ kind: "points", delta: change, reason: explanation, requestId: intent.requestId, signature });
  };
  const commit = async () => {
    if (!detail || !confirmation || operationLock.current || syncRequired || loading) return;
    const intended = confirmation;
    operationLock.current = true; setMutating(true); setOperationError(""); setNotice("");
    try {
      const result = await actions.current(intended.kind === "points" ? "opsPointsAdjust" : "opsUserStatus", intended.kind === "points"
        ? { playerId: selected.id, delta: intended.delta, reason: intended.reason, requestId: intended.requestId }
        : { playerId: selected.id, banned: intended.banned });
      if (!result) throw new Error("操作未完成，请重试");
      if (!alive.current) return;
      if (intended.kind === "points") { adjustments.current.delete(intended.signature); setDelta(""); setReason(""); }
      setConfirmation(null);
      const saved = intended.kind === "points" ? "积分调整已保存" : intended.banned ? "用户已封禁" : "用户已解封";
      setNotice(saved);
      if (!(await loadDetail())) {
        if (alive.current) { setSyncRequired(true); setNotice(`${saved}，最新详情暂时无法刷新。请先重新读取详情，再进行下一次管理操作。`); }
      }
    } catch (cause) { if (alive.current) setOperationError(cause instanceof Error ? cause.message : "操作未完成，请稍后重试"); }
    finally { operationLock.current = false; if (alive.current) setMutating(false); }
  };

  if (!workspace) return null;
  const user = detail?.user || selected;
  const contentLoading = loading && (!detail || readingTab === activeTab);
  const retry = () => { if (!operationLock.current) void loadDetail(lastRequest.current, activeTab === "claims" || activeTab === "placements" || activeTab === "ledger" ? activeTab : null); };
  return createPortal(<div className="ops-user-backdrop" data-phase={phase} onMouseDown={event => { if (event.target === event.currentTarget) dismiss.current(); }}>
    <section className="ops-user-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="用户详情" aria-describedby="ops-user-description" tabIndex={-1} onAnimationEnd={event => { if (event.target === event.currentTarget && phase === "enter") setPhase("open"); }}>
      <header className="ops-user-header"><div><small>PLAYER PROFILE</small><h2>用户详情</h2><p id="ops-user-description">{user.nickname} · 活动记录与账号管理</p></div><button type="button" className="icon-button" aria-label="关闭用户详情" disabled={mutating} onClick={() => dismiss.current()}><X size={20} /></button></header>
      <div className="ops-user-body" ref={body}>
        {!detail && loading ? <UserLoader /> : !detail ? <div className="ops-user-retry" role="alert"><AlertCircle size={28} /><h3>详情暂时无法读取</h3><p>{readError}</p><button className="outline-button" onClick={retry}><RefreshCw size={16} />重新加载详情</button></div> : <>
          <div className="ops-user-identity"><span className="ops-user-avatar" aria-hidden="true">{user.nickname.trim().slice(0, 1) || "寻"}</span><div className="ops-user-meta"><h3>{user.nickname}</h3><p>{user.authenticated ? "已登录账号" : "匿名试玩身份"} · {user.phoneMasked || "未绑定手机号"}</p><code>{user.id}</code></div><span className="ops-user-status" data-state={user.banned ? "banned" : "normal"}>{user.banned ? <Ban size={12} /> : <CheckCircle2 size={12} />}{user.banned ? "已封禁" : "正常"}</span></div>
          {readError && <div className="wb-error ops-user-retry" role="alert"><p>{readError}{detail && "。当前显示上一次读取的记录。"}</p><button className="text-button" disabled={mutating || loading} onClick={retry}>重试读取详情</button></div>}
          {notice && <p className={syncRequired ? "wb-error" : "wb-notice"} role="status"><CheckCircle2 size={16} />{notice}</p>}
          {operationError && <p className="wb-error" role="alert">{operationError}</p>}
          <div className="ops-user-record-anchor" aria-hidden="true" />
          <div className="ops-user-tabs" role="tablist" aria-label="用户详情分类">{tabs.map((tab, index) => { const Icon = tab.icon; return <button key={tab.id} id={`ops-tab-${tab.id}`} className="ops-user-tab" type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`ops-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} disabled={mutating} onClick={() => changeTab(tab.id)} onKeyDown={event => selectTabByKeyboard(event, index)}><Icon size={15} /><span>{tab.label}</span>{(tab.id === "claims" || tab.id === "placements" || tab.id === "ledger") && <small>{numberText(detail.pagination[tab.id].total)}</small>}</button>; })}</div>
          <div className="ops-user-panel" role="tabpanel" id={`ops-panel-${activeTab}`} aria-labelledby={`ops-tab-${activeTab}`} key={`${activeTab}:${activeTab === "claims" || activeTab === "placements" || activeTab === "ledger" ? detail.pagination[activeTab].page : "main"}`} tabIndex={0} aria-busy={contentLoading}>
            {contentLoading ? <UserLoader compact /> : <>
              {activeTab === "overview" && <UserOverview detail={detail} />}
              {activeTab === "claims" && <><div className="ops-user-record-list">{detail.claims.map(coupon => <ClaimRecord key={coupon.id} coupon={coupon} now={readAt} />)}</div>{!detail.claims.length && <UserEmpty icon={Ticket} text="还没有领奖记录" description="该用户领取奖励后，真实记录会出现在这里。" />}<RecordsPagination info={detail.pagination.claims} busy={loading || mutating} onChange={page => void requestPage("claims", page)} /></>}
              {activeTab === "placements" && <><div className="ops-user-record-list">{detail.placements.map(task => <PlacementRecord key={task.id} task={task} now={readAt} />)}</div>{!detail.placements.length && <UserEmpty icon={Compass} text="还没有投稿记录" description="展示该用户在本活动中尚未删除的投稿。" />}<RecordsPagination info={detail.pagination.placements} busy={loading || mutating} onChange={page => void requestPage("placements", page)} /></>}
              {activeTab === "ledger" && <><p className="wb-note">账本按发生时间倒序展示。运营调整影响余额，不增加成长积分。</p><div className="ops-user-record-list">{detail.ledger.map(entry => <article className="ops-user-record" key={entry.id}><div className="ops-user-record-head"><div><h3>{ledgerKinds[entry.kind] || "积分变动"}</h3><small>{dateTime(entry.createdAt)}</small></div><strong className="ops-user-record-status" data-state={entry.delta < 0 ? "expired" : "normal"}>{entry.delta > 0 ? "+" : ""}{numberText(entry.delta)}</strong></div><p>{entry.reason || ledgerKinds[entry.kind] || "积分变动"}</p></article>)}</div>{!detail.ledger.length && <UserEmpty icon={Coins} text="暂无积分变动" description="有效奖励、线索扣分和运营调整都记入真实账本。" />}<RecordsPagination info={detail.pagination.ledger} busy={loading || mutating} onChange={page => void requestPage("ledger", page)} /></>}
              {activeTab === "manage" && <div className="ops-user-management">
                <section className="ops-user-record"><h3><Coins size={18} />调整积分</h3><p className="wb-note">当前余额 {numberText(user.points)} 分。正数增加、负数扣减，每次调整必须填写原因。</p>
                  <form className="wb-form" onSubmit={prepareAdjustment}><fieldset disabled={mutating || loading || syncRequired || !!confirmation}><div className="wb-fields"><label className="field-label">积分调整值（负数为扣减）<input type="number" inputMode="numeric" step={1} min={-100000} max={100000} required value={delta} onChange={event => { setDelta(event.target.value); setOperationError(""); }} placeholder="例如 20 或 -10" /></label><label className="field-label">调整原因<input required minLength={2} maxLength={120} value={reason} onChange={event => { setReason(event.target.value); setOperationError(""); }} placeholder="填写本次调整的依据" /></label></div></fieldset><button type="submit" className="outline-button" disabled={mutating || loading || syncRequired || !!confirmation}><Coins size={15} />保存积分调整</button></form>
                </section>
                <section className="ops-user-record"><h3><ShieldCheck size={18} />账号状态</h3><p className="wb-note">{user.banned ? "封禁期间，该用户的后续游戏与工作台写操作被拒绝。解除后恢复正常权限。" : "封禁会限制后续游戏和工作台写操作；已领取奖励和历史记录保留。"}</p><button type="button" className="outline-button" disabled={mutating || loading || syncRequired || !!confirmation || !detail.permissions.canChangeStatus} onClick={() => { setOperationError(""); setNotice(""); setConfirmation({ kind: "status", banned: !user.banned }); }}><Ban size={15} />{user.banned ? "解封用户" : "封禁用户"}</button>{!detail.permissions.canChangeStatus && <p className="wb-note">{detail.permissions.statusReason || "此身份不能通过当前入口变更状态。"}</p>}</section>
                {syncRequired && <p className="wb-error" role="alert">请先重新读取详情，确认最新余额与账号状态。</p>}
                {confirmation && <section className="ops-user-confirmation wb-confirm" role="region" aria-label={confirmation.kind === "points" ? "积分调整确认" : "用户状态确认"}><h3>{confirmation.kind === "points" ? "确认这次积分调整" : confirmation.banned ? "确认封禁用户" : "确认解除封禁"}</h3><p>操作对象：{user.nickname}</p><code>{user.id}</code>{confirmation.kind === "points" ? <><p>余额 {numberText(user.points)} → {numberText(user.points + confirmation.delta)} 分（{confirmation.delta > 0 ? "+" : ""}{numberText(confirmation.delta)}）</p><p>原因：{confirmation.reason}</p><small>同一次请求重试不会重复记账，最终余额以后台保存结果为准。</small></> : <p>{confirmation.banned ? "封禁后停止该用户的新游戏和后台写操作，保留已有奖励与历史。" : "解除后允许该用户继续参与活动。"}</p>}<div className="wb-actions"><button type="button" className="outline-button" disabled={mutating} onClick={() => { setConfirmation(null); setOperationError(""); }}>取消</button><button type="button" className="gold-button" disabled={mutating || loading || syncRequired} onClick={() => void commit()}>{mutating ? "正在保存…" : confirmation.kind === "points" ? "确认积分调整" : confirmation.banned ? "确认封禁" : "确认解封"}</button></div></section>}
              </div>}
            </>}
          </div>
        </>}
      </div>
      <footer className="ops-user-footer"><small>{mutating ? "正在保存并同步最新记录，请稍候。" : "本活动真实记录 · 手机号已脱敏"}</small><button type="button" className="text-button" disabled={loading || mutating} onClick={() => { setConfirmation(null); void loadDetail(pages.current); }}><RefreshCw size={15} />刷新详情</button><button type="button" className="outline-button" disabled={mutating} onClick={() => dismiss.current()}><ArrowLeft size={15} />返回用户列表</button></footer>
    </section>
  </div>, workspace);
}

function UserLoader({ compact = false }: { compact?: boolean }) {
  return <div className="ops-user-loader" role="status" aria-label={compact ? "正在加载记录" : "正在加载用户详情"}><span className="ops-user-loader-coin" aria-hidden="true"><Coins size={26} /></span><p>{compact ? "正在读取活动记录…" : "正在读取用户详情…"}</p><div className="ops-user-loader-lines" aria-hidden="true"><i /><i /><i /></div></div>;
}
function UserEmpty({ icon: Icon, text, description }: { icon: typeof Coins; text: string; description: string }) {
  return <div className="ops-user-empty"><Icon size={28} /><h3>{text}</h3><p>{description}</p></div>;
}
function UserOverview({ detail }: { detail: OperationsUserDetail }) {
  const { user, activity } = detail;
  const progress = activity.earnedPoints % 100;
  const metrics = [
    { label: "积分余额", value: numberText(user.points), note: "当前可用积分", icon: Coins },
    { label: "成长等级", value: `Lv.${user.level}`, note: `本级成长 ${progress} / 100`, icon: TrendingUp, water: progress },
    { label: "累计领奖", value: numberText(user.claimCount), note: "本活动有效领奖记录", icon: Ticket },
    { label: "创作投稿", value: numberText(activity.placements), note: "本活动未删除的投稿", icon: Compass },
  ];
  return <><div className="ops-user-metrics">{metrics.map((metric, index) => { const Icon = metric.icon; return <article className="ops-user-metric" key={metric.label} style={{ "--ops-index": index } as CSSProperties}>{metric.water !== undefined && <span className="ops-user-water" aria-hidden="true" style={{ "--water-level": `${metric.water}%` } as CSSProperties} />}<Icon size={18} aria-hidden="true" /><strong>{metric.value}</strong><span>{metric.label}</span><small>{metric.note}</small></article>; })}</div>
    <section className="ops-user-record"><h3>账号与活动</h3><dl className="ops-user-kv"><div><dt>创建时间</dt><dd>{dateTime(user.createdAt)}</dd></div><div><dt>最近活跃日期</dt><dd>{activity.lastActiveDay || "暂无活动记录"}</dd></div><div><dt>优惠券奖励</dt><dd>{numberText(activity.couponRewards)} 次</dd></div><div><dt>积分奖励</dt><dd>{numberText(activity.pointsRewards)} 次</dd></div><div><dt>已核销优惠券</dt><dd>{numberText(activity.redeemedCoupons)} 张</dd></div><div><dt>发布状态投稿</dt><dd>{numberText(activity.publishedPlacements)} 条</dd></div><div><dt>历史成长积分</dt><dd>{numberText(activity.earnedPoints)} 分</dd></div><div><dt>积分账本</dt><dd>{numberText(activity.ledgerEntries)} 条</dd></div></dl><p className="wb-note">等级按有效奖励的历史成长积分累计。运营调分和线索扣分改变余额，不改变已获得的成长等级。</p></section>
  </>;
}
function RecordsPagination({ info, busy, onChange }: { info: OperationsUserPagination; busy: boolean; onChange: (page: number) => void }) {
  if (!info.total) return null;
  return <nav className="ops-user-pagination" aria-label="记录分页"><small>共 {numberText(info.total)} 条 · 第 {info.page} / {info.totalPages} 页</small><div><button type="button" className="outline-button" disabled={busy || info.page <= 1} onClick={() => onChange(info.page - 1)}><ArrowLeft size={14} />上一页</button><button type="button" className="outline-button" disabled={busy || info.page >= info.totalPages} onClick={() => onChange(info.page + 1)}>下一页<ArrowRight size={14} /></button></div></nav>;
}
function ClaimRecord({ coupon, now }: { coupon: Coupon; now: number }) {
  const points = coupon.rewardType === "points";
  const status = points ? "normal" : coupon.redeemedAt || coupon.status === "used" ? "used" : coupon.status === "expired" || (coupon.validEnd && coupon.validEnd <= now) ? "expired" : coupon.status === "upcoming" ? "pending" : "unused";
  const statusText = { normal: "积分已入账", used: "已核销", expired: "已过期", pending: "未到使用期", unused: "待使用" }[status];
  return <article className="ops-user-record"><div className="ops-user-record-head"><div><h3>{coupon.reward}</h3><small>{coupon.storeName} · {coupon.taskTitle}</small></div><span className="ops-user-record-status" data-state={status}>{statusText}</span></div><p>{coupon.conditions}</p><dl className="ops-user-kv"><div><dt>领取时间</dt><dd>{dateTime(coupon.issuedAt)}</dd></div>{!points && <><div><dt>有效至</dt><dd>{coupon.validEnd ? dateTime(coupon.validEnd) : "依原券条款"}</dd></div><div><dt>核销时间</dt><dd>{coupon.redeemedAt ? dateTime(coupon.redeemedAt) : "尚未核销"}</dd></div></>}</dl><small>奖励编号：{coupon.id}</small></article>;
}
function PlacementRecord({ task, now }: { task: Task; now: number }) {
  const expired = task.status === "published" && !!task.expiresAt && task.expiresAt <= now;
  const state = expired ? "expired" : task.status;
  const text = expired ? "已过期" : ({ published: "已发布", pending: "待审核", rejected: "已驳回", withdrawn: "已撤回" }[task.status] || task.status);
  return <article className="ops-user-record"><div className="ops-user-record-head"><div><h3>{task.title}</h3><small>{task.storeName || task.storeId} · {task.floor} · {task.area}</small></div><span className="ops-user-record-status" data-state={state}>{text}</span></div><p>{task.reward}</p><dl className="ops-user-kv"><div><dt>投稿时间</dt><dd>{dateTime(task.createdAt)}</dd></div><div><dt>有效至</dt><dd>{task.expiresAt ? dateTime(task.expiresAt) : "未设置"}</dd></div><div><dt>已被领取</dt><dd>{numberText(task.claimedCount || 0)} 次</dd></div></dl>{task.reviewNote && <p>审核说明：{task.reviewNote}</p>}<small>投稿编号：{task.id}</small></article>;
}
