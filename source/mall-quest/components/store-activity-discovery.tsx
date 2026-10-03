"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Compass, MapPin, Megaphone, RefreshCw, Ticket } from "lucide-react";
import { request } from "@/lib/game-api";
import type { GeoLocation, StoreGeofence } from "@/lib/geofence";
import type { StoreActivity, StoreActivitiesState } from "@/lib/store-activity-types";
import type { Task } from "@/lib/game-types";
import { AmapGeofenceMap } from "./amap-geofence-map";
import { Drawer } from "./common/Drawer";
import "./store-activity-discovery.css";

const formatDate = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
export function StoreActivityDiscovery({ storeId, fence, location, now, reloadKey, treasures = [], onOpenTask, onRefreshTasks }: { storeId: string; fence?: StoreGeofence; location?: GeoLocation | null; now: number; reloadKey: number; treasures?: Task[]; onOpenTask?: (task: Task) => void; onRefreshTasks?: () => void }) {
  const [data, setData] = useState<StoreActivitiesState | null>(null), [error, setError] = useState("");
  const [page, setPage] = useState(1), [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [treasurePage, setTreasurePage] = useState(1);
  const pendingTask = useRef<Task | null>(null);
  const storeTreasures = treasures.filter(task => task.storeId === storeId && task.status === "published" && (task.expiresAt == null || task.expiresAt > now));
  const treasurePages = Math.ceil(storeTreasures.length / 20), currentTreasurePage = Math.min(treasurePage, treasurePages || 1);
  const treasureSlice = storeTreasures.slice((currentTreasurePage - 1) * 20, currentTreasurePage * 20);
  const id = useId(), cards = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    let cancelled = false, changedPage = false;
    void request<StoreActivitiesState>("storeActivities", { storeId, page }).then(result => {
      if (!cancelled) {
        if (result.pagination.totalPages > 0 && page > result.pagination.totalPages) { changedPage = true; setPage(result.pagination.totalPages); setLoading(true); return; }
        setData(result); setError("");
      }
    }).catch(cause => { if (!cancelled) { setData(null); setError((cause as Error).message); } }).finally(() => { if (!cancelled && !changedPage) setLoading(false); });
    return () => { cancelled = true; };
  }, [storeId, page, reload, reloadKey]);
  const activities = data?.activities;
  const visibleMask = activities?.map(activity => activity.endAt > now ? "1" : "0").join("") || "";
  const visible = useMemo(() => (activities || []).filter((_activity, index) => visibleMask[index] === "1"), [activities, visibleMask]);
  const selectActivity = (activity: StoreActivity) => {
    setSelectedActivity(activity.id);
    setOpen(true);
  };
  useEffect(() => {
    if (!open || !selectedActivity) return;
    const timer = window.setTimeout(() => {
    const card = cards.current.get(selectedActivity);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.questReduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [open, selectedActivity]);
  const refresh = () => { setLoading(true); setError(""); setData(null); setSelectedActivity(null); setReload(value => value + 1); onRefreshTasks?.(); };
  const finishClose = () => { setOpen(false); const task = pendingTask.current; pendingTask.current = null; if (task) onOpenTask?.(task); };
  return <div className="store-activity-discovery">
    <AmapGeofenceMap fence={fence} location={location} activities={visible} onActivitySelect={selectActivity} />
    <section className="store-activity-public" aria-labelledby={id}>
      <div className="store-activity-public-heading"><div><h3 id={id}><Megaphone size={19} />这家店的活动</h3><p className="muted">寻宝活动和门店公告都在抽屉内查看，地图标记可打开门店公告。</p></div><button type="button" className="outline-button" disabled={loading} onClick={refresh}><RefreshCw size={16} />刷新活动</button></div>
      <button type="button" className="store-activity-launch" aria-haspopup="dialog" onClick={() => { setSelectedActivity(null); setOpen(true); }}><span><strong>{storeTreasures.length ? `${storeTreasures.length} 个寻宝活动${visible.length ? ` · 本页 ${visible.length} 条门店公告` : ""}` : loading ? "正在读取活动…" : error ? "门店公告读取失败，点击查看" : visible.length ? `本页 ${visible.length} 条门店公告` : activities?.length || (data && data.pagination.totalPages > 1) ? "当前页暂无有效公告，点击查看或刷新" : "暂时没有活动"}</strong><small>{storeTreasures[0]?.title || visible[0]?.title || "查看活动说明、奖励和门店位置"}</small></span><ChevronRight size={20} /></button>
      <p className="muted store-activity-public-note">领取寻宝奖励仍需确认金币、进入范围并答题。</p>
    </section>
    {open && <Drawer title="门店活动" historyKey="geofence-activities" onClose={finishClose}>{close => <div className="store-activity-public store-activity-drawer-body">
      {storeTreasures.length > 0 && <section className="store-treasure-section" aria-label="这家店的寻宝活动"><h3><Compass size={19} />寻宝活动</h3><p className="muted">与寻宝地图同步，查看线索和奖励，到店后继续探索。</p><div className="store-activity-public-list">{treasureSlice.map(task => <article className="store-activity-public-card" key={task.id}><div className="store-activity-card-top"><span className="pill green">{task.claimed ? "已收集" : task.remaining > 0 ? "寻宝活动" : "奖励已领完"}</span><span className="muted">{task.floor} · {task.area}</span></div><h4>{task.title}</h4>{task.clues[0] && <p className="store-activity-description">{task.clues[0]}</p>}<p className="store-activity-location"><Ticket size={16} /><span>{task.reward}</span></p>{task.conditions && <p className="muted store-activity-description">{task.conditions}</p>}<button type="button" className="outline-button store-treasure-open" disabled={!onOpenTask} onClick={() => { if (pendingTask.current) return; pendingTask.current = task; close(); }}><Compass size={17} />查看线索与奖励<ChevronRight size={17} /></button></article>)}</div>{treasurePages > 1 && <nav className="store-activity-pagination" aria-label="寻宝活动分页"><button type="button" className="outline-button" disabled={currentTreasurePage <= 1} onClick={() => setTreasurePage(currentTreasurePage - 1)}><ChevronLeft size={16} />上一页</button><span>{currentTreasurePage} / {treasurePages} 页</span><button type="button" className="outline-button" disabled={currentTreasurePage >= treasurePages} onClick={() => setTreasurePage(currentTreasurePage + 1)}>下一页<ChevronRight size={16} /></button></nav>}</section>}
      <div className="store-activity-public-heading"><div><h3><Megaphone size={19} />门店公告</h3><p className="muted">公告时间以北京时间显示。</p></div><button type="button" className="outline-button" disabled={loading} onClick={refresh}><RefreshCw size={16} />刷新活动</button></div>
      {loading ? <p role="status">正在读取门店活动…</p> : error ? <div className="store-activity-public-empty"><p className="inline-error" role="alert">{error}</p><p className="muted">活动暂未读取，门店范围仍可查看。请稍后刷新。</p></div> : visible.length ? <div className="store-activity-public-list">{visible.map(activity => <article className={`store-activity-public-card${selectedActivity === activity.id ? " is-selected" : ""}`} key={activity.id} tabIndex={-1} ref={element => { if (element) cards.current.set(activity.id, element); else cards.current.delete(activity.id); }}>
        <div className="store-activity-card-top"><span className={`pill ${activity.startAt > now ? "gold" : "green"}`}>{activity.startAt > now ? "即将开始" : "正在进行"}</span><span className="muted">{activity.storeName}</span></div>
        <h4>{activity.title}</h4><p className="store-activity-description">{activity.description}</p>
        <p className="store-activity-time"><CalendarDays size={16} /><span>{formatDate(activity.startAt)} — {formatDate(activity.endAt)}（北京时间）</span></p>
        <p className="store-activity-location"><MapPin size={16} /><span>活动地点为已设置的门店范围，具体内容以本条说明为准。</span></p>
      </article>)}</div> : <div className="store-activity-public-empty"><Megaphone size={25} aria-hidden="true" /><p>{activities?.length ? "当前页公告已结束，刷新看看最新公告。" : "这家店暂时没有公开公告。"}</p><p className="muted">{storeTreasures.length ? "上方可以查看门店现有的寻宝活动。" : "可以切换上方门店看看其他活动。"}</p></div>}
      {!loading && !error && data && data.pagination.totalPages > 1 && <nav className="store-activity-pagination" aria-label="门店活动分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => { setLoading(true); setData(null); setSelectedActivity(null); setPage(value => value - 1); }}><ChevronLeft size={16} />上一页</button><span>{data.pagination.page} / {data.pagination.totalPages} 页</span><button type="button" className="outline-button" disabled={page >= data.pagination.totalPages} onClick={() => { setLoading(true); setData(null); setSelectedActivity(null); setPage(value => value + 1); }}>下一页<ChevronRight size={16} /></button></nav>}
      <p className="muted store-activity-public-note">活动公告用于介绍门店活动；领取寻宝奖励仍需确认金币、进入范围并答题。</p>
    </div>}</Drawer>}
  </div>;
}
