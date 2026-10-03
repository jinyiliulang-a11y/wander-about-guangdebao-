"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, Coins, Download, Edit3, Monitor, Plus, RefreshCw, Save, Search, Settings2, Store as StoreIcon, Ticket, Trash2, TrendingUp, Users, Wrench, X } from "lucide-react";
import type { Store, Task } from "@/lib/game-types";
import type { OperationsUser } from "@/lib/operations-user-types";
import { merchantCouponReportRows, type MerchantCouponStats } from "@/lib/merchant-stats";
import { downloadWorkbenchXlsx, type PendingReview } from "@/lib/workbench-export";
import { StoreImage, StoreImagePicker } from "./store-image";
import { FormDialog } from "./common/FormDialog";
import { ChoiceField, DateField } from "./common/WorkbenchFields";
import { Drawer } from "./common/Drawer";
import { CouponDeviceBinding } from "./coupon-device-binding";
import { deviceDisplayName } from "@/lib/device-display";
import { discountLabel } from "@/lib/coupon-format";
import { StoreIconField } from "./common/StoreIconField";
import { MerchantStoreProfileEditor } from "./merchant-profile-editor";
import { isGameApiError, isUncertainResult } from "@/lib/game-api";
import "./workbench-pages.css";
import "./coupon-manager.css";

export type WorkbenchRange = 7 | 30 | 90;
export type WorkbenchStore = Store & {
  logo: string;
  address: string;
  phone: string;
  rating: number | null;
  status: "active" | "inactive";
};
export type CouponTemplate = {
  id: string; storeId: string; title: string;
  type: "discount" | "cash" | "gift";
  value: number; minAmount: number; totalCount: number;
  issuedCount: number; remaining: number;
  validStart: number | null; validEnd: number | null;
  status: "active" | "inactive";
};
export type WorkbenchDevice = {
  id: string; storeId: string; storeName: string; enabled: boolean;
  boundTaskId: string | null; boundTask: Task | null;
  status: "active" | "maintenance" | "idle";
  battery: number | null; lastHeartbeat: number | null;
};
export type { OperationsUser } from "@/lib/operations-user-types";
export type OperationsSettingsData = {
  dailyLimit: number;
  clueCosts: number[];
  contributionRatio: number;
  ugcReview: boolean;
};
export type WorkbenchData = {
  scope: { role: string; storeId: string | null };
  stats: {
    range: WorkbenchRange; totalTasks: number; claims: number; redeemed: number;
    distinctPlayers: number; claimRate: number; consumption: number | null;
    totalPlayers?: number; registeredUsers?: number; todayClaimPlayers?: number; storeCount?: number;
    publishedTasks?: number; merchantCount?: number; activeUsersToday?: number;
    merchantCoupons?: MerchantCouponStats;
    daily: { date: string; claims: number; redeemed: number }[];
  };
  store: WorkbenchStore | null;
  stores: WorkbenchStore[];
  couponTemplates: CouponTemplate[];
  devices: WorkbenchDevice[];
  users: OperationsUser[];
  settings: OperationsSettingsData;
  tasks: Task[];
  pendingReviews?: PendingReview[];
};
export type WorkbenchAction = (action: string, payload: Record<string, unknown>) => Promise<unknown>;
type ActionProps = { data: WorkbenchData; onAction: WorkbenchAction; busy?: boolean };

function useWorkbenchAction(onAction: WorkbenchAction, externalBusy = false) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: string, payload: Record<string, unknown>, text = "已保存", onFailure?: (cause: unknown) => void) => {
    if (inFlight.current || externalBusy) return false;
    inFlight.current = true;
    setPending(true); setError(""); setNotice("");
    try {
      // No optimistic business records. The parent must reject API failures and
      // refresh backend data after a mutation; null is also treated as failure.
      const result = await onAction(action, payload);
      if (result === null || result === undefined) throw new Error("操作未完成，请刷新后重试");
      if (mounted.current) setNotice(text);
      return true;
    } catch (cause) {
      onFailure?.(cause);
      if (mounted.current) setError(cause instanceof Error ? cause.message : "操作未完成，请稍后重试");
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { run, busy: pending || externalBusy, error, notice, setError, restoreFeedback: (feedback: { error: string; notice: string }) => { setError(feedback.error); setNotice(feedback.notice); }, clear: () => { setError(""); setNotice(""); } };
}

function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return <>{error && <p className="wb-error" role="alert">{error}</p>}{notice && <p className="wb-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}</>;
}
function EmptyRecords({ text }: { text: string }) { return <p className="wb-empty">{text}</p>; }
function AdminOnly({ data, children }: { data: WorkbenchData; children: React.ReactNode }) {
  return data.scope.role === "admin" ? <>{children}</> : <section className="surface wb-panel"><p>请先使用运营身份进入此页面。</p></section>;
}
const dateTime = (value: number | null | undefined) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(value) : "未记录";
const dateOnly = (value: number | null) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value) : "";
const dateInput = (value: string, end = false) => value ? Date.parse(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`) : null;
const integer = (value: string, min: number, max: number) => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const money = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1_000_000;
const downloadCsv = (rows: (string | number)[][], filename: string) => {
  const cell = (value: string | number) => {
    let text = String(value);
    if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type WorkbenchMetric = {
  label: string; value: number | undefined; icon: typeof Users;
  color: "blue" | "gold" | "green" | "purple";
  numerator?: number; denominator?: number; note: string;
};
const knownMetric = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const workbenchWaterRatio = (numerator: number | undefined, denominator: number | undefined) =>
  knownMetric(numerator) && knownMetric(denominator) && denominator > 0 ? Math.max(0, Math.min(100, numerator / denominator * 100)) : null;
const ratioNote = (label: string, numerator: number | undefined, denominator: number | undefined) =>
  knownMetric(numerator) && knownMetric(denominator) ? `${label}：${numerator.toLocaleString("zh-CN")} / ${denominator.toLocaleString("zh-CN")}${denominator === 0 ? "，暂无统计样本" : ""}` : `${label}待统计`;

function WorkbenchMetricCard({ metric, index, overview = false }: { metric: WorkbenchMetric; index: number; overview?: boolean }) {
  const Element = overview ? "article" : "div", Icon = metric.icon;
  const water = workbenchWaterRatio(metric.numerator, metric.denominator);
  const valueKnown = knownMetric(metric.value);
  const displayValue = knownMetric(metric.value) ? metric.value.toLocaleString("zh-CN") : "—";
  return <Element
    className={`wb-metric-card wb-water-metric${overview ? " wb-overview-card" : ""}${water === null ? " wb-plain-metric" : ""} wb-${metric.color}`}
    style={{ "--wb-index": index } as CSSProperties}
    data-metric={metric.label}
    data-ratio-known={water !== null}
    aria-label={`${metric.label}：${valueKnown ? displayValue : "待统计"}；${metric.note}${water === null ? "" : `；水位比例${Math.round(water * 10) / 10}%`}`}
  >
    <span className={`wb-data-water wb-water-${metric.color}`} style={{ "--water-level": `${water ?? 0}%` } as CSSProperties} data-empty={water === null || water === 0} data-known={water !== null} aria-hidden="true"><i /></span>
    <span className={`wb-metric-icon${overview ? " wb-overview-icon" : ""}`} aria-hidden="true"><Icon size={23} /></span>
    <strong>{displayValue}</strong>
    <span className="wb-metric-label">{metric.label}</span>
    <small className="wb-metric-note">{valueKnown ? metric.note : "待统计"}</small>
  </Element>;
}

export function WorkbenchDashboard({ data, busy = false, onReload, onNavigate }: {
  data: WorkbenchData; busy?: boolean;
  onReload: (range: WorkbenchRange) => Promise<unknown>;
  onNavigate?: (tab: string) => void;
}) {
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const requestLock = useRef(false);
  const stats = data.stats, admin = data.scope.role === "admin", pending = data.pendingReviews || [];
  const coupons = stats.merchantCoupons;
  const daily = admin ? stats.daily : (coupons?.daily || []).map(day => ({ date: day.date, claims: day.issued, redeemed: day.redeemed }));
  const claimLabel = admin ? "领奖" : "发券";
  const changeRange = async (range: WorkbenchRange) => {
    if (requestLock.current || busy) return;
    requestLock.current = true; setLoading(true); setError("");
    try { await onReload(range); } catch (cause) { setError(cause instanceof Error ? cause.message : "统计暂时无法读取"); }
    finally { requestLock.current = false; setLoading(false); }
  };
  const exportCsv = () => downloadCsv(admin ? [
    ["逛道宝活动记录", `近${stats.range}天`], ["指标", "数值"],
    ...(admin ? [["注册用户", stats.registeredUsers ?? "未采集"], ["投放金币", stats.publishedTasks ?? "未采集"], ["入驻商家", stats.merchantCount ?? "未采集"], ["今日活跃", stats.activeUsersToday ?? "未采集"]] : []),
    ["任务", stats.totalTasks], ["成功领奖", stats.claims], ["已核销", stats.redeemed],
    ["参与玩家", stats.distinctPlayers], ["核销率(%)", stats.claimRate],
    ["实际消费金额", stats.consumption === null ? "未采集" : stats.consumption],
    ["日期", "成功领奖", "核销发生"], ...stats.daily.map(day => [day.date, day.claims, day.redeemed]),
    ...(admin ? [["待审核标题", "门店", "提交人", "提交时间"], ...pending.map(item => [item.title, item.storeName, item.authorName, dateTime(item.createdAt)])] : []),
  ] : [
    [`${data.store?.name || "当前门店"}优惠券与库存记录`, `近${stats.range}天（北京时间）`],
    ["指标", "数值", "统计口径"],
    ...merchantCouponReportRows(coupons, stats.range).map(([label, value, note]) => [label, label === "本批核销率" && typeof value === "number" ? `${Number((value * 100).toFixed(1))}%` : value, note]),
    ["实际消费金额", "未采集", "核销不等同实际消费金额或真实到店"],
    ["日期", "发放优惠券", "核销发生"], ...daily.map(day => [day.date, day.claims, day.redeemed]),
  ], `逛道宝_近${stats.range}天_${dateOnly(Date.now())}.csv`);
  const exportExcel = () => { try { downloadWorkbenchXlsx(data); } catch { setError("表格未能生成，请重试或使用 CSV 导出。"); } };
  const max = Math.max(1, ...daily.flatMap(day => [day.claims, day.redeemed]));
  const point = (n: number, index: number) => `${40 + index * 620 / Math.max(1, daily.length - 1)},${180 - n / max * 135}`;
  const overview: WorkbenchMetric[] = [
    { label: "注册用户", value: stats.registeredUsers, icon: Users, color: "blue", numerator: stats.registeredUsers, denominator: stats.totalPlayers, note: ratioNote("绑定账户 / 全部体验账户", stats.registeredUsers, stats.totalPlayers) },
    { label: "投放金币", value: stats.publishedTasks, icon: Coins, color: "gold", numerator: stats.publishedTasks, denominator: stats.totalTasks, note: ratioNote("有效发布 / 全部任务", stats.publishedTasks, stats.totalTasks) },
    { label: "入驻商家", value: stats.merchantCount, icon: StoreIcon, color: "green", numerator: stats.storeCount, denominator: stats.merchantCount, note: ratioNote("水位：启用门店 / 入驻商家", stats.storeCount, stats.merchantCount) },
    { label: "今日活跃", value: stats.activeUsersToday, icon: TrendingUp, color: "purple", numerator: stats.activeUsersToday, denominator: stats.totalPlayers, note: ratioNote("今日活跃 / 全部体验账户", stats.activeUsersToday, stats.totalPlayers) },
  ];
  const counts: WorkbenchMetric[] = admin ? [
    { label: "任务总数", value: stats.totalTasks, icon: Coins, color: "gold", note: "当前门店未删除的任务" },
    { label: "成功领奖", value: stats.claims, icon: Ticket, color: "blue", note: `所选近${stats.range}日新发放的奖励` },
    { label: "已核销", value: stats.redeemed, icon: CheckCircle2, color: "green", note: `近${stats.range}日发生的核销，可含此前领券` },
    { label: "参与玩家", value: stats.distinctPlayers, icon: Users, color: "purple", note: `近${stats.range}日成功领奖的不同玩家` },
  ] : [
    { label: "发放优惠券", value: coupons?.issued, icon: Ticket, color: "gold", note: `近${stats.range}日领取的券，不含积分奖励` },
    { label: "待使用", value: coupons?.unused, icon: Coins, color: "blue", numerator: coupons?.unused, denominator: coupons?.issued, note: ratioNote("本期未核销且未过期 / 本期发券", coupons?.unused, coupons?.issued) },
    { label: "已核销", value: coupons?.redeemed, icon: CheckCircle2, color: "green", numerator: coupons?.redeemed, denominator: coupons?.issued, note: ratioNote("本期已核销 / 本期发券", coupons?.redeemed, coupons?.issued) },
    { label: "已过期", value: coupons?.expired, icon: Ticket, color: "purple", numerator: coupons?.expired, denominator: coupons?.issued, note: ratioNote("本期未核销且过期 / 本期发券", coupons?.expired, coupons?.issued) },
  ];
  if (admin) counts[0].note = "当前活动未删除的任务";
  const rate = admin ? stats.claimRate : coupons?.redemptionRate ?? undefined;
  const rateKnown = knownMetric(rate), rateWater = rateKnown ? Math.max(0, Math.min(100, rate)) : 0;
  const rateNote = admin ? `以近${stats.range}日的${stats.claims}次领奖为样本，按当前核销状态计算` : coupons?.issued ? `本期已核销 ${coupons.redeemed} 份 / 本期发放 ${coupons.issued} 份；按当前状态计算` : coupons ? "本期尚未发券，没有核销率样本" : "待统计";
  const inventory: WorkbenchMetric[] = [
    { label: "有效模板总配额", value: coupons?.inventory.total, icon: Ticket, color: "gold", note: `当前有效启用模板 ${coupons?.inventory.activeTemplates ?? "待统计"} 个，与时间范围无关` },
    { label: "有效模板剩余配额", value: coupons?.inventory.remaining, icon: Coins, color: "blue", numerator: coupons?.inventory.remaining, denominator: coupons?.inventory.total, note: ratioNote("未发配额 / 有效模板总配额", coupons?.inventory.remaining, coupons?.inventory.total) },
    { label: "门店共享奖励剩余额度", value: coupons?.inventory.storeRewardRemaining, icon: StoreIcon, color: "green", numerator: coupons?.inventory.storeRewardRemaining, denominator: coupons?.inventory.storeRewardTotal, note: ratioNote("剩余 / 所有奖励共享总额度", coupons?.inventory.storeRewardRemaining, coupons?.inventory.storeRewardTotal) },
    { label: "当前发券额度上限", value: coupons?.inventory.issuableUpperBound, icon: Ticket, color: "purple", note: "模板余量与门店共享奖励余量取较小值" },
  ];
  return <div className="wb-stack">
    <section className="surface wb-panel">
      <div className="wb-heading wb-dashboard-heading"><div><h2>{admin ? "运营数据概览" : "门店券概览"}</h2><p className="muted">{admin ? "平台账户、金币投放与实际参与记录" : `${data.store?.name || "当前门店"} · 本活动的优惠券发放与使用情况`}</p></div><div className="wb-actions wb-dashboard-actions"><ChoiceField label="统计时间范围" value={String(stats.range)} options={[7, 30, 90].map(range => ({ value: String(range), label: `近${range}天` }))} disabled={busy || loading} onChange={value => void changeRange(Number(value) as WorkbenchRange)} /><button className="gold-button" disabled={busy || loading} onClick={exportExcel}><Download size={16} />导出 Excel</button><button className="text-button" disabled={busy || loading} onClick={exportCsv}>导出 CSV</button></div></div>
      <Feedback error={error} />
      {admin && <><div className="wb-overview">{overview.map((metric, index) => <WorkbenchMetricCard metric={metric} index={index} overview key={metric.label} />)}</div><p className="wb-note">注册用户按已开通账号及历史账户统计，不代表实名认证；投放金币为当前可见的有效发布任务。今日活跃按北京时间统计访问游戏或成功登录的不同玩家，排除后台会话。</p></>}
      <div className={`wb-metrics${admin ? " wb-metrics-secondary" : ""}`}>{counts.map((metric, index) => <WorkbenchMetricCard metric={metric} index={index + (admin ? 4 : 0)} key={metric.label} />)}</div>
      <div className="wb-metric-card wb-water-metric wb-rate-card wb-green" style={{ "--wb-index": admin ? 8 : 4 } as CSSProperties} data-metric="核销率" data-ratio-known={rateKnown} aria-label={`所选期间领取券的核销率：${rateKnown ? `${rate}%` : coupons?.issued === 0 ? "暂无样本" : "待统计"}；${rateNote}`}>
        <span className="wb-data-water wb-water-green" style={{ "--water-level": `${rateWater}%` } as CSSProperties} data-empty={!rateKnown || rateWater === 0} data-known={rateKnown} aria-hidden="true"><i /></span>
        <span className="wb-metric-icon" aria-hidden="true"><CheckCircle2 size={23} /></span>
        <strong>{rateKnown ? `${rate}%` : coupons?.issued === 0 ? "暂无样本" : "—"}</strong>
        <span className="wb-metric-label">{admin ? "所选期间领取券的核销率" : "本批核销率"}</span>
        <small className="wb-metric-note">{rateNote}</small>
      </div>
      {!admin && <p className="wb-note">同一批本期发券分为待使用、已核销、已过期，三项合计为发放数。待使用含{coupons?.upcoming ?? "待统计"}份尚未生效的券。本期领券玩家 {coupons?.recipients ?? "待统计"} 人；期间核销发生 {coupons?.redemptions ?? "待统计"} 份，可含此前领券，不能作为本期核销率分子。</p>}
      <p className="wb-note">消费金额{stats.consumption === null ? "尚未采集" : ` ¥${stats.consumption}`}。{!admin && "核销记录不等同真实到店或营业额。"}</p>
    </section>
    {!admin && <section className="surface wb-panel"><div className="wb-heading"><div><h2>当前奖励与库存</h2><p className="muted">库存是当前余额，与上方近{stats.range}日发券样本分开统计</p></div></div><div className="wb-metrics">{inventory.map((metric, index) => <WorkbenchMetricCard metric={metric} index={index} key={metric.label} />)}</div><p className="wb-note">只计算当前生效、启用且未删除的模板；门店停用时发券额度为 0。有效模板累计已占 {coupons?.inventory.used ?? "待统计"} 份配额（含模板历史活动），核销或过期不回补。门店共享奖励额度包含积分和优惠券，与券模板配额分开计算。</p><p className="wb-note">模板余量与门店名额是两道限制；实际可领取还取决于门店启用、已发布任务、任务期限和玩家是否已领。模板停用或删除不会改写已发券的使用状态。</p></section>}
    <section className="surface wb-panel"><div className="wb-heading"><h2>近 {stats.range} 日{admin ? "挖宝" : "发券与核销"}趋势</h2><div className="wb-legend"><span>● {claimLabel}</span><span>● 核销发生</span></div></div>
      {daily.length ? <><div className="wb-chart"><svg viewBox="0 0 700 215" role="img" aria-label={`近${stats.range}天${claimLabel}与核销趋势，详见每日明细`}><line x1="40" y1="180" x2="660" y2="180" stroke="currentColor" opacity=".25" /><line x1="40" y1="45" x2="660" y2="45" stroke="currentColor" opacity=".1" /><text x="8" y="50">{max}</text><text x="20" y="184">0</text><polyline points={daily.map((day, i) => point(day.claims, i)).join(" ")} fill="none" stroke="var(--gold)" strokeWidth="3" /><polyline points={daily.map((day, i) => point(day.redeemed, i)).join(" ")} fill="none" stroke="#b4a0e8" strokeWidth="3" />{daily.length <= 7 && daily.map((day, i) => <circle key={day.date} cx={40 + i * 620 / Math.max(1, daily.length - 1)} cy={180 - day.claims / max * 135} r="4" fill="var(--gold)"><title>{day.date}：{claimLabel} {day.claims} 次</title></circle>)}<text x="40" y="207">{daily[0].date}</text><text x="660" y="207" textAnchor="end">{daily.at(-1)?.date}</text></svg></div><details className="wb-detail"><summary>展开 / 收起每日明细</summary><div className="wb-table-scroll"><table><thead><tr><th>日期</th><th>{admin ? "成功领奖" : "发放优惠券"}</th><th>核销发生</th></tr></thead><tbody>{daily.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.claims}</td><td>{day.redeemed}</td></tr>)}</tbody></table></div></details></> : <EmptyRecords text="当前范围还没有活动记录。" />}
    </section>
    {admin && <section className="surface wb-panel"><div className="wb-heading"><h2><AlertTriangle size={20} />待处理事项</h2><div className="wb-actions"><span className="pill gold">{pending.length} 条待审核</span>{pending.length > 0 && onNavigate && <button type="button" className="outline-button" disabled={busy} onClick={() => onNavigate("review")}>查看待审核投稿<ArrowRight size={16} /></button>}</div></div>{pending.length ? <div className="wb-pending-list">{pending.map(item => <article className="wb-pending-item" key={item.id}><span className="wb-pending-icon"><Ticket size={20} /></span><div><h3>{item.title}</h3><p className="muted">{item.storeName} · {item.authorName} · {dateTime(item.createdAt)}</p></div></article>)}</div> : <EmptyRecords text="全部处理完成，当前没有待审核的投稿。" />}</section>}
  </div>;
}

const typeNames = { discount: "折扣券", cash: "满减券", gift: "赠品券" };
const emptyCoupon = { title: "", type: "discount" as CouponTemplate["type"], value: "88", minAmount: "0", totalCount: "20", validStart: "", validEnd: "", status: "active" as CouponTemplate["status"] };
export function CouponTemplateManager({ data, onAction, busy = false }: ActionProps) {
  const action = useWorkbenchAction(onAction, busy);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(emptyCoupon);
  const [longTerm, setLongTerm] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"stop" | "delete">("stop");
  const [filter, setFilter] = useState("all");
  const [listOpen, setListOpen] = useState(false), [listPage, setListPage] = useState(1);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [backgroundFeedback, setBackgroundFeedback] = useState<{ error: string; notice: string } | null>(null);
  const saveCompleted = useRef(false);
  const closeEditor = () => {
    if (!saveCompleted.current && backgroundFeedback) action.restoreFeedback(backgroundFeedback);
    setEditing(null); setBackgroundFeedback(null);
  };
  const edit = (coupon?: CouponTemplate) => {
    saveCompleted.current = false;
    setBackgroundFeedback({ error: action.error, notice: action.notice });
    action.clear(); setConfirmId(null); setEditing(coupon?.id || "new");
    setLongTerm(coupon ? coupon.validEnd === null : false);
    setForm(coupon ? { title: coupon.title, type: coupon.type, value: String(coupon.value), minAmount: String(coupon.minAmount), totalCount: String(coupon.totalCount), validStart: dateOnly(coupon.validStart), validEnd: dateOnly(coupon.validEnd), status: coupon.status } : emptyCoupon);
  };
  const editedCoupon = data.couponTemplates.find(coupon => coupon.id === editing);
  const parsedStart = dateInput(form.validStart), parsedEnd = dateInput(form.validEnd, true);
  const datesReady = longTerm
    ? (!form.validStart || (parsedStart !== null && Number.isFinite(parsedStart)))
    : parsedStart !== null && parsedEnd !== null && Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) && parsedEnd >= parsedStart;
  const canSave = form.title.trim().length >= 2 && form.title.trim().length <= 60 && integer(form.totalCount, 1, 100_000)
    && Number(form.totalCount) >= (editedCoupon?.issuedCount || 0) && money(form.value) && money(form.minAmount)
    && (form.type !== "discount" || (Number(form.value) >= 1 && Number(form.value) <= 99.99))
    && (form.type !== "cash" || (Number(form.value) > 0 && Number(form.minAmount) >= Number(form.value)))
    && datesReady;
  const save = async (event: React.FormEvent, close: () => void) => {
    event.preventDefault();
    if (action.busy) return;
    if (!canSave) { action.setError("请先填写完整的必填信息；指定日期时需选择有效的起止日期。"); return; }
    if (form.title.trim().length < 2 || !integer(form.totalCount, 1, 100_000) || !money(form.value) || !money(form.minAmount)) { action.setError("券名称至少两字，请填写有效的数量、金额。"); return; }
    if (form.type === "discount" && !(Number(form.value) >= 1 && Number(form.value) <= 99.99)) { action.setError("折扣值为1至99.99，例如88表示8.8折。"); return; }
    if (form.type === "cash" && !(Number(form.value) > 0 && Number(form.minAmount) >= Number(form.value))) { action.setError("满减金额应大于0，消费门槛不能小于减免金额。"); return; }
    const start = dateInput(form.validStart), end = longTerm ? null : dateInput(form.validEnd, true);
    if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)) || (start !== null && end !== null && end < start)) { action.setError("请填写有效日期，截止日期不能早于开始日期。"); return; }
    const current = data.couponTemplates.find(coupon => coupon.id === editing);
    if (current && Number(form.totalCount) < current.issuedCount) { action.setError(`总量不能少于已发出的${current.issuedCount}份。`); return; }
    const saved = await action.run(editing === "new" ? "couponCreate" : "couponUpdate", { ...(editing !== "new" ? { templateId: editing } : {}), title: form.title.trim(), type: form.type, value: Number(form.value), minAmount: Number(form.minAmount), totalCount: Number(form.totalCount), validStart: start, validEnd: end, status: form.status }, editing === "new" ? "优惠券模板已创建" : "优惠券模板已更新");
    if (saved) { saveCompleted.current = true; close(); }
  };
  const coupons = data.couponTemplates.filter(coupon => filter === "all" || coupon.status === filter);
  const pages = Math.max(1, Math.ceil(coupons.length / 8)), currentPage = Math.min(listPage, pages);
  const visibleCoupons = coupons.slice((currentPage - 1) * 8, currentPage * 8);
  const bindingCoupon = data.couponTemplates.find(coupon => coupon.id === bindingId);
  const feedback = editing !== null && backgroundFeedback ? backgroundFeedback : action;
  const cards = <div className="wb-card-grid">{visibleCoupons.map(coupon => {
    const bound = data.devices.filter(device => device.storeId === coupon.storeId && device.boundTask?.rewardCouponId === coupon.id);
    return <article className="wb-record" key={coupon.id}>
      <div className="wb-heading"><span className="pill">{typeNames[coupon.type]}</span><span className={`pill ${coupon.status === "active" ? "gold" : ""}`}>{coupon.status === "active" ? "启用" : "已停用"}</span></div>
      <h3>{coupon.title}</h3><p>{coupon.type === "discount" ? discountLabel(coupon.value) : coupon.type === "cash" ? `满${coupon.minAmount}元减${coupon.value}元` : "按券名称及条件领取赠品"}</p>
      <p className="muted">已发 {coupon.issuedCount} / {coupon.totalCount} · 剩余 {coupon.remaining}</p>
      <p className="wb-note">{coupon.validEnd === null ? coupon.validStart === null ? "长期有效" : `${dateTime(coupon.validStart)}起，长期有效` : `${coupon.validStart === null ? "即日起" : dateTime(coupon.validStart)} 至 ${dateTime(coupon.validEnd)}`}</p>
      <p className="wb-note">{bound.length ? `绑定金币：${bound.map(device => deviceDisplayName(device.id)).join("、")}` : "尚未绑定金币"}</p>
      <div className="wb-actions">
        <button className="outline-button" disabled={action.busy} onClick={() => edit(coupon)}><Edit3 size={15} />编辑</button>
        <button className="outline-button" disabled={action.busy} onClick={() => setBindingId(coupon.id)}><Coins size={15} />绑定金币</button>
        {coupon.status === "active" ? <button className="text-button" disabled={action.busy} onClick={() => { action.clear(); setConfirmAction("stop"); setConfirmId(coupon.id); }}>停用</button> : <button className="outline-button" disabled={action.busy} onClick={() => void action.run("couponActivate", { templateId: coupon.id }, "优惠券已启用，恢复正常发放")}><RefreshCw size={15} />启用</button>}
        <button className="text-button wb-danger" disabled={action.busy} onClick={() => { action.clear(); setConfirmAction("delete"); setConfirmId(coupon.id); }}><Trash2 size={15} />删除</button>
      </div>
      {confirmId === coupon.id && <div className="wb-confirm" role="alertdialog" aria-label={confirmAction === "delete" ? "删除优惠券模板" : "停用优惠券模板"}>
        <p>{confirmAction === "delete" ? "删除后此模板将从管理列表移除，相关任务停止新发券；已领取的券与核销历史保留。" : "停止后续发放，已领取的券和记录会保留。"}</p>
        <div className="wb-actions"><button className="outline-button" disabled={action.busy} onClick={() => setConfirmId(null)}>取消</button><button className="gold-button" disabled={action.busy} onClick={async () => {
          if (await action.run(confirmAction === "delete" ? "couponDelete" : "couponDeactivate", { templateId: coupon.id }, confirmAction === "delete" ? "优惠券模板已删除" : "优惠券已停用")) setConfirmId(null);
        }}>确认{confirmAction === "delete" ? "删除" : "停用"}</button></div>
      </div>}
    </article>;
  })}</div>;
  return <div className="wb-stack">
    <section className="surface wb-panel">
      <div className="wb-heading"><div><h2>奖励与库存</h2><p className="muted">管理优惠券、发放配额与金币绑定</p></div><button className="gold-button" disabled={action.busy} onClick={() => edit()}><Plus size={16} /> 新建优惠券</button></div>
      <Feedback {...feedback} />
      <div className="wb-coupon-summary"><span>共 <strong>{data.couponTemplates.length}</strong> 张券模板</span><span>启用 <strong>{data.couponTemplates.filter(coupon => coupon.status === "active").length}</strong> 张</span><span>剩余 <strong>{data.couponTemplates.reduce((sum, coupon) => sum + coupon.remaining, 0)}</strong> 份配额</span></div>
      <button className="outline-button wb-coupon-list-trigger" onClick={() => setListOpen(true)}><Ticket size={18} />管理优惠券<ArrowRight size={18} /></button>
      <p className="wb-note">在抽屉里筛选、编辑和绑定金币，券再多也不用一直向下翻。</p>
    </section>
    {listOpen && <Drawer title="管理优惠券" historyKey="coupon-template-list" onClose={() => { setListOpen(false); setConfirmId(null); }}>{close => <div className="wb-stack">
      <button className="gold-button" disabled={action.busy} onClick={() => edit()}><Plus size={16} />新建优惠券</button>
      <Feedback {...feedback} />
      <div className="tabs wb-tabs">{[["all", "全部"], ["active", "启用"], ["inactive", "已停用"]].map(([value, name]) => <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => { setFilter(value); setListPage(1); setConfirmId(null); }}>{name}</button>)}</div>
      {cards}{!coupons.length && <EmptyRecords text="当前没有此状态的优惠券模板。" />}
      <div className="wb-coupon-pagination"><button className="outline-button" disabled={action.busy || currentPage <= 1} onClick={() => { setListPage(currentPage - 1); setConfirmId(null); }}>上一页</button><span>第 {currentPage} / {pages} 页 · 共 {coupons.length} 张</span><button className="outline-button" disabled={action.busy || currentPage >= pages} onClick={() => { setListPage(currentPage + 1); setConfirmId(null); }}>下一页</button></div>
      <button className="text-button" disabled={action.busy} onClick={close}>返回库存概览</button>
    </div>}</Drawer>}
    {editing !== null && <FormDialog key={editing} title={editing === "new" ? "新建优惠券" : "编辑优惠券"} historyKey={`coupon-template:${editing}`} busy={action.busy} onClose={closeEditor}>{(close, cancel) => <form onSubmit={event => void save(event, close)} className="wb-form"><fieldset disabled={action.busy}><label className="field-label">券名称 *<input data-dialog-autofocus required minLength={2} maxLength={60} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><div className="wb-fields"><ChoiceField label="类型" value={form.type} options={Object.entries(typeNames).map(([value, label]) => ({ value, label }))} onChange={type => setForm({ ...form, type: type as CouponTemplate["type"] })} disabled={action.busy} /><label className="field-label">{form.type === "discount" ? "折扣值（88表示8.8折） *" : form.type === "cash" ? "减免金额（元） *" : "赠品参考值（元） *"}<input type="number" min={form.type === "discount" ? 1 : 0} max={form.type === "discount" ? 99.99 : 1_000_000} step="0.01" required value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label><label className="field-label">消费门槛（元） *<input type="number" min={0} max={1_000_000} step="0.01" required value={form.minAmount} onChange={e => setForm({ ...form, minAmount: e.target.value })} /></label><label className="field-label">发放总量 *<input type="number" min={1} max={100_000} step={1} required value={form.totalCount} onChange={e => setForm({ ...form, totalCount: e.target.value })} /></label><div className="wb-coupon-validity"><div className="wb-validity-heading"><strong>有效期 <span aria-hidden="true">*</span></strong><label className="wb-validity-switch"><input type="checkbox" checked={longTerm} disabled={action.busy} onChange={event => { const checked = event.target.checked; setLongTerm(checked); if (checked) setForm(current => ({ ...current, validStart: "", validEnd: "" })); }} /><span>长期有效</span></label></div>{longTerm ? <p className="wb-validity-note">{form.validStart ? `${form.validStart}起，长期有效。` : "保存后立即生效，长期有效。"}取消勾选可设置起止日期。</p> : <><DateField label="开始日期（北京时间） *" value={form.validStart} onChange={validStart => setForm(current => ({ ...current, validStart }))} disabled={action.busy} /><DateField label="截止日期（北京时间） *" value={form.validEnd} min={form.validStart || undefined} onChange={validEnd => setForm(current => ({ ...current, validEnd }))} disabled={action.busy} /></>}</div><ChoiceField label="发放状态" value={form.status} options={[{ value: "active", label: "正常发放" }, { value: "inactive", label: "暂停发放" }]} onChange={status => setForm(current => ({ ...current, status: status as CouponTemplate["status"] }))} disabled={action.busy} describedBy="coupon-issuance-help" /></div></fieldset><p id="coupon-issuance-help" className="wb-note">暂停后不再发放新券，已领取的券仍按原条件和有效期使用。</p>{!canSave && <p className="wb-note" role="status">请填写所有带 * 的信息；指定日期时，起止日期都需要选择。</p>}<Feedback error={action.error} /><div className="wb-actions"><button type="button" className="outline-button" disabled={action.busy} onClick={cancel}>取消</button><button type="submit" className="gold-button" disabled={action.busy || !canSave}><Save size={16} />{action.busy ? "保存中…" : "保存优惠券"}</button></div></form>}</FormDialog>}
    {bindingCoupon && <CouponDeviceBinding key={bindingCoupon.id} coupon={bindingCoupon} data={data} onAction={onAction} onClose={() => setBindingId(null)} />}
    <p className="wb-note">删除和停用均保留发放历史；总量不得低于已发数量。设备码用于选择金币，商家核销使用卡包中的个人券码。</p>
  </div>;
}
const emptyPublish = { deviceId: "", taskId: "", title: "", clues: ["", "", "", "", ""], question: "", answer: "", difficulty: "2", expiresAt: "", rewardType: "points", rewardValue: "50", rewardCouponId: "" };
export function DeviceTaskManager({ data, onAction, busy = false }: ActionProps) {
  const action = useWorkbenchAction(onAction, busy);
  const [form, setForm] = useState(emptyPublish), [publishing, setPublishing] = useState(false);
  const [bindChoice, setBindChoice] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ deviceId: string; action: "deviceWithdraw" | "deviceMaintain" } | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const selectDevice = (deviceId: string) => {
    const fixed = deviceId === "coin-tea-01" ? data.tasks.find(task => task.id === "quest-tea") : null;
    setForm(previous => ({ ...previous, deviceId, taskId: fixed?.id || "",
      ...(fixed ? { title: fixed.title, clues: [...fixed.clues], question: fixed.question, answer: "" } : {}) }));
  };
  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.title.trim().length < 4 || form.clues.some(clue => clue.trim().length < 4) || (!form.deviceId && (form.question.trim().length < 4 || !form.answer.trim()))) { action.setError("请填写标题与五条线索；独立网页任务还需观察问题和答案。"); return; }
    if (!integer(form.difficulty, 1, 5) || (form.rewardType === "points" && !integer(form.rewardValue, 10, 500))) { action.setError("难度为1至5；积分奖励为10至500的整数。"); return; }
    const expiresAt = dateInput(form.expiresAt, true);
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) { action.setError("截止日期应晚于当前时间。"); return; }
    if (form.rewardType === "coupon" && !form.rewardCouponId) { action.setError("请选择启用的优惠券模板。"); return; }
    const done = await action.run("merchantPublish", { ...(form.deviceId ? { deviceId: form.deviceId } : {}), ...(form.taskId ? { taskId: form.taskId } : {}), title: form.title.trim(), clues: form.clues.map(clue => clue.trim()), question: form.question.trim(), answer: form.answer.trim(), difficulty: Number(form.difficulty), expiresAt, rewardType: form.rewardType, rewardValue: form.rewardType === "points" ? Number(form.rewardValue) : 0, ...(form.rewardType === "coupon" ? { rewardCouponId: form.rewardCouponId } : {}) }, "金币任务已发布");
    if (done) { setPublishing(false); setForm(emptyPublish); }
  };
  const availableTemplates = data.couponTemplates.filter(coupon => coupon.status === "active" && coupon.remaining > 0);
  const publishableDevices = data.devices.filter(device => device.status !== "maintenance" && device.enabled);
  return <div className="wb-stack"><section className="surface wb-panel"><div className="wb-heading"><div><h2>设备与金币</h2><p className="muted">已登记的设备、任务绑定与投放状态</p></div><button className="gold-button" disabled={action.busy} onClick={() => { action.clear(); setForm(emptyPublish); setPublishing(true); }}><Plus size={16} /> 发布金币</button></div><Feedback {...action} /><div className="wb-metrics"><div><strong>{data.devices.length}</strong><span>登记设备</span></div><div><strong>{data.devices.filter(device => device.status === "active").length}</strong><span>已绑定</span></div><div><strong>{data.devices.filter(device => device.status === "idle").length}</strong><span>待绑定</span></div><div><strong>{data.devices.filter(device => device.status === "maintenance").length}</strong><span>维护</span></div></div>
      <div className="wb-card-grid">{data.devices.map(device => <article className="wb-record" key={device.id}><div className="wb-heading"><h3><Monitor size={18} />{deviceDisplayName(device.id)}</h3><span className={`pill ${device.status === "active" ? "gold" : ""}`}>{device.status === "maintenance" ? "维护中" : device.status === "active" ? "已绑定" : "待绑定"}</span></div><p>{device.storeName}</p><p className="muted">电量 {device.battery === null ? "未上报" : `${device.battery}%`} · 最近心跳 {device.lastHeartbeat === null ? "未上报" : dateTime(device.lastHeartbeat)}</p><p>{device.boundTask?.title || "未绑定任务"}</p><p className="wb-note">授权{device.enabled ? "已启用" : "已停用"}；登记状态不代表在线。</p>{device.status !== "maintenance" && <div className="wb-bind"><ChoiceField label="绑定任务" ariaLabel={`${device.id}绑定任务`} matchTriggerWidth value={bindChoice[device.id] || ""} disabled={action.busy} onChange={taskId => setBindChoice(previous => ({ ...previous, [device.id]: taskId }))} options={[{ value: "", label: "请选择已发布任务" }, ...data.tasks.filter(task => task.storeId === device.storeId && task.status === "published" && (device.id !== "coin-tea-01" || task.id === "quest-tea")).map(task => ({ value: task.id, label: task.title }))]} /><button className="outline-button" disabled={action.busy || !bindChoice[device.id]} onClick={async () => { if (await action.run("deviceBind", { deviceId: device.id, taskId: bindChoice[device.id] }, "设备任务绑定已保存")) setBindChoice({ ...bindChoice, [device.id]: "" }); }}>保存绑定</button></div>}<div className="wb-actions">{device.boundTaskId && <button className="text-button" disabled={action.busy} onClick={() => { action.clear(); setConfirm({ deviceId: device.id, action: "deviceWithdraw" }); }}>撤回投放</button>}{device.status === "maintenance" ? <button className="outline-button" disabled={action.busy} onClick={() => void action.run("deviceResume", { deviceId: device.id }, "设备维护已结束，请重新检查绑定")}><RefreshCw size={15} />恢复设备</button> : <button className="text-button" disabled={action.busy} onClick={() => { action.clear(); setConfirm({ deviceId: device.id, action: "deviceMaintain" }); }}><Wrench size={15} />维护设备</button>}</div>{confirm?.deviceId === device.id && <div className="wb-confirm"><p>{confirm.action === "deviceMaintain" ? "进入维护将暂停设备同步和该设备任务的 NFC 新领奖；已领取奖励保留。" : "撤回当前投放；已领取的奖励保留。"}</p><div className="wb-actions"><button className="outline-button" disabled={action.busy} onClick={() => setConfirm(null)}>取消</button><button className="gold-button" disabled={action.busy} onClick={async () => { if (await action.run(confirm.action, { deviceId: device.id }, confirm.action === "deviceMaintain" ? "设备已进入维护" : "投放已撤回")) setConfirm(null); }}>确认</button></div></div>}</article>)}</div>{!data.devices.length && <EmptyRecords text="当前门店没有登记设备。设备须先由主机配置完成登记；页面不会生成假的设备。" />}
    </section><section className="surface wb-panel" aria-label="金币任务管理"><div className="wb-heading"><div><h2>金币任务管理</h2><p className="muted">网页任务与硬件任务统一管理</p></div><span className="pill">{data.tasks.length} 条</span></div>{data.tasks.length ? <div className="wb-table-scroll wb-task-table"><table><thead><tr><th>任务</th><th>门店 / 提交人</th><th>状态</th><th>硬件绑定</th><th>操作</th></tr></thead><tbody>{data.tasks.map(task => <tr key={task.id}><td><strong>{task.title}</strong><small>{task.reward}</small></td><td>{task.storeName || data.stores.find(store => store.id === task.storeId)?.name || task.storeId}<small>{task.author}</small></td><td>{task.expiresAt && task.expiresAt <= now ? "已过期" : ({ published: "已发布", pending: "待审核", rejected: "已驳回", withdrawn: "已撤回" }[task.status] || task.status)}</td><td>{data.devices.filter(device => device.boundTaskId === task.id).map(device => device.id).join("、") || "未绑定硬件"}</td><td><button className="text-button wb-danger" disabled={action.busy} onClick={() => { action.clear(); setDeleteTask(task); }} aria-label={`删除任务${task.title}`}><Trash2 size={15} />删除</button></td></tr>)}</tbody></table></div> : <EmptyRecords text="当前没有金币任务，可以发布独立网页任务。" />}{deleteTask && <div className="wb-confirm" role="alertdialog" aria-label="删除金币任务"><p>确认删除「{deleteTask.title}」？删除后停止新领奖并解除设备绑定，已有奖励与历史记录保留。</p><div className="wb-actions"><button className="outline-button" disabled={action.busy} onClick={() => setDeleteTask(null)}>取消</button><button className="gold-button" disabled={action.busy} onClick={async () => { if (await action.run("taskDelete", { taskId: deleteTask.id }, "金币任务已删除")) setDeleteTask(null); }}>确认删除</button></div></div>}</section>{publishing && <section className="surface wb-panel"><div className="wb-heading"><h2>发布金币任务</h2><button className="text-button" aria-label="关闭发布表单" disabled={action.busy} onClick={() => setPublishing(false)}><X size={18} /></button></div><form className="wb-form" onSubmit={publish}><fieldset disabled={action.busy}><div className="wb-fields"><label className="field-label">投放设备（可选）<select value={form.deviceId} onChange={e => selectDevice(e.target.value)}><option value="">仅发布网页任务</option>{publishableDevices.map(device => <option key={device.id} value={device.id}>{device.id}</option>)}</select></label><label className="field-label">金币标题<input required minLength={4} maxLength={40} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label className="field-label">难度<select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}星</option>)}</select></label><label className="field-label">截止日期（可选）<input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></label></div>{form.clues.map((clue, index) => <label className="field-label" key={index}>线索{index + 1}<textarea required minLength={4} maxLength={160} rows={2} readOnly={form.deviceId === "coin-tea-01"} value={clue} onChange={e => setForm({ ...form, clues: form.clues.map((value, i) => i === index ? e.target.value : value) })} /></label>)}<div className="wb-fields">{!form.deviceId && <><label className="field-label">观察问题<input required minLength={4} maxLength={160} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} /></label><label className="field-label">观察答案<input required maxLength={40} value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} /></label></>}<label className="field-label">奖励类型<select value={form.rewardType} onChange={e => setForm({ ...form, rewardType: e.target.value })}><option value="points">积分</option><option value="coupon">优惠券</option></select></label>{form.rewardType === "points" ? <label className="field-label">积分奖励<input type="number" required min={10} max={500} step={1} value={form.rewardValue} onChange={e => setForm({ ...form, rewardValue: e.target.value })} /></label> : <label className="field-label">优惠券模板<select required value={form.rewardCouponId} onChange={e => setForm({ ...form, rewardCouponId: e.target.value })}><option value="">选择启用模板</option>{availableTemplates.map(coupon => <option key={coupon.id} value={coupon.id}>{coupon.title} · 剩余{coupon.remaining}</option>)}</select></label>}</div></fieldset>{form.deviceId === "coin-tea-01" && <p className="wb-note">此设备使用固定茶间集线索。标题和奖励可调整，NFC 领取不再答观察题；另写线索请使用其他设备或独立网页任务。</p>}<Feedback error={action.error} /><div className="wb-actions"><button type="button" className="outline-button" disabled={action.busy} onClick={() => setPublishing(false)}>取消</button><button type="submit" className="gold-button" disabled={action.busy}><Save size={16} />{action.busy ? "发布中…" : "确认发布"}</button></div></form></section>}<p className="wb-note">硬件金币通过 NFC 入口及门店范围校验保存待领申请，无观察题。商家扫固定设备码、接收金币后确认发券；玩家以后凭卡包个人券码消费核销，设备同步读取正式领取数量。独立网页任务保留观察题，任务绑定变化不代表设备本地线索已更新。</p></div>;
}

type StoreForm = Pick<WorkbenchStore, "name" | "logo" | "category" | "floor" | "address" | "phone"> & { imageURL: string; artwork: number; expectedImageRevision: number };
function StoreEditor({ store, onAction, busy = false, admin = false, onEditingChange }: { store: WorkbenchStore; onAction: WorkbenchAction; busy?: boolean; admin?: boolean; onEditingChange?: (editing: boolean) => void }) {
  const action = useWorkbenchAction(onAction, busy);
  const [editing, setEditing] = useState(false), [imageBusy, setImageBusy] = useState(false);
  const fromStore = (): StoreForm => ({ name: store.name, logo: store.logo || "", category: store.category, floor: store.floor, address: store.address || store.area, phone: store.phone || "", imageURL: store.imageURL || "", artwork: Number.isInteger(store.artwork) ? ((store.artwork % 3) + 3) % 3 : 0, expectedImageRevision: store.imageRevision || 0 });
  const [form, setForm] = useState<StoreForm>(fromStore);
  const [statusConfirm, setStatusConfirm] = useState(false);
  const [unresolved, setUnresolved] = useState<StoreForm | null>(null), [checked, setChecked] = useState(false), [checking, setChecking] = useState(false);
  const checkLock = useRef(false);
  useEffect(() => { onEditingChange?.(editing || action.busy || imageBusy || !!unresolved); }, [editing, action.busy, imageBusy, unresolved, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  const submit = async (payload: StoreForm) => {
    setChecked(false);
    const result = await action.run("merchantProfileSave", { ...payload, ...(admin ? { storeId: store.id } : {}) }, "门店资料与图片已保存", cause => {
      if (isUncertainResult(cause) || !isGameApiError(cause)) setUnresolved(Object.freeze({ ...payload }));
      else setUnresolved(null);
    });
    if (result) { setUnresolved(null); setEditing(false); }
  };
  const checkSaved = async () => {
    if (!unresolved || checkLock.current || action.busy) return;
    checkLock.current = true; setChecking(true);
    try {
      const current = await onAction("workbenchState", {}) as WorkbenchData | null;
      const saved = admin ? current?.stores.find(item => item.id === store.id) : current?.store;
      if (!saved || saved.id !== store.id || current?.scope.role !== (admin ? "admin" : "merchant")) throw new Error("门店身份或查询结果已改变，请回到原账号核对。");
      const matches = (Object.keys(unresolved) as (keyof StoreForm)[]).every(key => key === "expectedImageRevision" ? saved.imageRevision === unresolved.expectedImageRevision + 1 : key === "imageURL" ? (saved.imageURL || "") === unresolved.imageURL : saved[key as Exclude<keyof StoreForm, "expectedImageRevision">] === unresolved[key]);
      if (matches) { setUnresolved(null); setEditing(false); action.restoreFeedback({ error: "", notice: "原保存结果已核对，门店资料与图片已更新。" }); }
      else { setChecked(true); action.setError("当前资料尚未匹配原保存。可再次核对，或明确重试原参数；不会自动覆盖新资料。"); }
    } catch (cause) { action.setError(cause instanceof Error ? cause.message : "原保存结果尚待核对。"); }
    finally { checkLock.current = false; setChecking(false); }
  };
  const startEdit = () => { setForm(fromStore()); setEditing(true); action.clear(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (imageBusy || action.busy || unresolved || checking) return;
    if (form.name.trim().length < 2 || !form.logo.trim() || !form.category.trim() || !form.floor.trim() || form.address.trim().length < 2) { action.setError("请填写门店图标、类别和楼层；门店名称与地址至少两字。"); return; }
    if (form.phone.trim() && !/^[+\d\s()-]+$/.test(form.phone.trim())) { action.setError("联系电话只接受数字、空格、括号、加号和短横线。"); return; }
    await submit({ ...form, name: form.name.trim(), logo: form.logo, category: form.category.trim(), floor: form.floor.trim(), address: form.address.trim(), phone: form.phone.trim() });
  };
  return <section className="surface wb-panel">
    <div className="wb-heading"><div><span className="pill">{store.status === "inactive" ? "已下线" : "活动门店"}</span><h2>{store.logo || ""} {store.name}</h2><p className="muted">{store.id} · {store.category}</p></div>{!editing && <button className="outline-button" disabled={action.busy} onClick={startEdit}><Edit3 size={16} />编辑资料</button>}</div>
    <Feedback {...action} />
    {editing ? <form className="wb-form" onSubmit={save}><fieldset disabled={action.busy || imageBusy || !!unresolved || checking}>
      <div className="wb-fields">{([
        ["name", "门店名称", 40], ["category", "门店类别", 30], ["floor", "楼层", 10], ["address", "门店地址", 120], ["phone", "联系电话", 24],
      ] as const).map(([key, text, maxLength]) => <label key={key} className="field-label">{text}<input required={key !== "phone"} type={key === "phone" ? "tel" : "text"} maxLength={maxLength} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}<StoreIconField value={form.logo} disabled={action.busy || imageBusy || !!unresolved || checking} onChange={logo => setForm(current => ({ ...current, logo }))} /></div>
    </fieldset><StoreImagePicker imageURL={form.imageURL} artwork={form.artwork} disabled={action.busy || !!unresolved || checking} onBusyChange={setImageBusy} onChange={next => setForm(previous => ({ ...previous, ...next }))} />
      <div className="wb-actions">{unresolved ? <><button type="button" className="gold-button" disabled={action.busy || checking} onClick={() => void checkSaved()}><RefreshCw size={16} />核对原保存结果</button>{checked && <button type="button" className="outline-button" disabled={action.busy || checking} onClick={() => void submit(unresolved)}>重试原保存</button>}</> : <><button type="button" className="outline-button" disabled={action.busy || imageBusy} onClick={() => setEditing(false)}>取消</button><button type="submit" className="gold-button" disabled={action.busy || imageBusy}><Save size={16} />{action.busy ? "保存中…" : "保存资料"}</button></>}</div>
    </form> : <><StoreImage imageURL={store.imageURL} artwork={store.artwork} alt={store.name} className="wb-store-image" /><dl className="wb-facts"><div><dt>门店位置</dt><dd>{store.floor} · {store.address || store.area}</dd></div><div><dt>联系电话</dt><dd>{store.phone || "未填写"}</dd></div><div><dt>评分</dt><dd>{store.rating === null ? "未采集" : store.rating}</dd></div><div><dt>当前活动权益</dt><dd>{store.reward}</dd></div></dl></>}
    {admin && <div className="wb-admin-action"><button className="text-button" disabled={action.busy || imageBusy} onClick={() => { action.clear(); setStatusConfirm(true); }}><Ban size={16} />{store.status === "active" ? "下线门店" : "恢复门店"}</button>{statusConfirm && <div className="wb-confirm"><p>{store.status === "active" ? "下线后停止新的活动领奖，保留历史记录与已有券。" : "恢复门店后，实际可领奖状态仍以任务和库存为准。"}</p><div className="wb-actions"><button className="outline-button" disabled={action.busy || imageBusy} onClick={() => setStatusConfirm(false)}>取消</button><button className="gold-button" disabled={action.busy || imageBusy} onClick={async () => { if (await action.run("opsStoreStatus", { storeId: store.id, status: store.status === "active" ? "inactive" : "active" }, "门店状态已保存")) setStatusConfirm(false); }}>确认{store.status === "active" ? "下线" : "恢复"}</button></div></div>}</div>}
  </section>;
}
export function MerchantProfileEditor({ data, onAction, busy = false, operatorId = "", onEditingChange, registerCloseGuard, onBack }: ActionProps & { operatorId?: string; onEditingChange?: (editing: boolean) => void; registerCloseGuard?: (guard: (() => Promise<boolean>) | null) => void; onBack?: () => void }) { return data.store ? <MerchantStoreProfileEditor key={operatorId + ":" + data.store.id} store={data.store} operatorId={operatorId} onAction={onAction} busy={busy} onEditingChange={onEditingChange} registerCloseGuard={registerCloseGuard} onBack={onBack} /> : <section className="surface wb-panel"><EmptyRecords text="当前身份尚未绑定门店。" /></section>; }

export { OperationsUsers } from "./operations-users";

export function OperationsMerchants({ data, onAction, busy = false }: ActionProps) {
  const [search, setSearch] = useState("");
  const stores = data.stores.filter(store => `${store.name} ${store.id} ${store.category}`.includes(search.trim()));
  return <AdminOnly data={data}><div className="wb-stack"><section className="surface wb-panel"><div className="wb-heading"><h2><StoreIcon size={20} />商家管理</h2><label className="search-field"><Search size={16} /><input aria-label="搜索门店" maxLength={80} placeholder="门店名称、类别或ID" value={search} onChange={e => setSearch(e.target.value)} /></label></div><p className="wb-note">共 {data.stores.length} 家登记门店；修改资料与上下线均保存到后台。</p></section>{stores.map(store => <StoreEditor key={store.id} store={store} onAction={onAction} busy={busy} admin />)}{!stores.length && <section className="surface wb-panel"><EmptyRecords text="没有匹配的门店。" /></section>}</div></AdminOnly>;
}

export function OperationsSettings({ data, onAction, busy = false }: ActionProps) {
  const action = useWorkbenchAction(onAction, busy);
  type SettingsForm = { dailyLimit: string; clueCosts: string[]; contributionRatio: string; ugcReview: boolean };
  const [draft, setDraft] = useState<SettingsForm | null>(null);
  const form = draft || { dailyLimit: String(data.settings.dailyLimit), clueCosts: data.settings.clueCosts.slice(2, 5).map(String), contributionRatio: String(data.settings.contributionRatio), ugcReview: data.settings.ugcReview };
  const dirty = draft !== null;
  const change = (values: Partial<SettingsForm>) => { setDraft({ ...form, ...values }); action.clear(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!integer(form.dailyLimit, 0, 100) || form.clueCosts.length !== 3 || form.clueCosts.some(cost => !integer(cost, 0, 1000)) || !Number.isFinite(Number(form.contributionRatio)) || form.contributionRatio.trim() === "" || Number(form.contributionRatio) < 0 || Number(form.contributionRatio) > 1) { action.setError("请填写有效的投放上限、线索积分和0至1的贡献系数。"); return; }
    if (await action.run("opsSettingsSave", { dailyLimit: Number(form.dailyLimit), clueCosts: [0, 0, ...form.clueCosts.map(Number)], contributionRatio: Number(form.contributionRatio), ugcReview: form.ugcReview }, "系统设置已保存")) setDraft(null);
  };
  return <AdminOnly data={data}><section className="surface wb-panel"><div className="wb-heading"><div><h2><Settings2 size={20} />系统设置</h2><p className="muted">活动规则以后台保存结果为准</p></div></div><Feedback {...action} /><form className="wb-form" onSubmit={save}><fieldset disabled={action.busy}><label className="field-label">每日投放上限（0暂停投稿）<input type="number" min={0} max={100} step={1} required value={form.dailyLimit} onChange={e => change({ dailyLimit: e.target.value })} /></label><div className="wb-fields">{form.clueCosts.map((cost, index) => <label className="field-label" key={index}>线索{index + 3}解锁积分<input type="number" min={0} max={1000} step={1} required value={cost} onChange={e => change({ clueCosts: form.clueCosts.map((value, i) => i === index ? e.target.value : value) })} /></label>)}</div><p className="wb-note">前两条线索免费。已解锁的内容不重复扣积分。</p><label className="field-label">贡献积分系数<input type="number" required min={0} max={1} step="0.01" value={form.contributionRatio} onChange={e => change({ contributionRatio: e.target.value })} /></label><p className="wb-note">每次有效领奖的贡献积分由后端计算，向下取整。</p><label className="wb-checkbox"><input type="checkbox" checked={form.ugcReview} onChange={e => change({ ugcReview: e.target.checked })} /><span>用户投稿需要运营审核</span></label></fieldset><div className="wb-actions"><button type="submit" className="gold-button" disabled={action.busy || !dirty}><Save size={16} />{action.busy ? "保存中…" : "保存设置"}</button>{dirty && <button type="button" className="outline-button" disabled={action.busy} onClick={() => { setDraft(null); action.clear(); }}>放弃修改</button>}</div></form></section></AdminOnly>;
}


