"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Circle, LocateFixed, MapPin, Megaphone, RefreshCw, ShieldCheck } from "lucide-react";
import { request } from "@/lib/game-api";
import { readBrowserLocation } from "@/lib/browser-location";
import { checkGeofence, geofenceMessage, validFenceGeometry, type GeoLocation, type GeofenceState, type StoreGeofence } from "@/lib/geofence";
import type { Store, Task } from "@/lib/game-types";
import { StoreActivityDiscovery } from "./store-activity-discovery";
import { GeofenceStorePicker } from "./geofence-store-picker";
import "./geofence-panel.css";
import { FenceEditor } from "./geofence-editor";

export function GeofencePanel({ stores, storeId, manage = false, compact = false, locationOverride, onActivities, treasures, onOpenTask, onRefreshTasks }: { stores: Store[]; storeId?: string; manage?: boolean; compact?: boolean; locationOverride?: GeoLocation | null; onActivities?: () => void; treasures?: Task[]; onOpenTask?: (task: Task) => void; onRefreshTasks?: () => void }) {
  const storeChoiceId = useId();
  const [fences, setFences] = useState<StoreGeofence[]>([]), [selected, setSelected] = useState(storeId || stores[0]?.id || "");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [location, setLocation] = useState<GeoLocation | null>(null), [locating, setLocating] = useState(false), [now, setNow] = useState(() => Date.now());
  const [locationError, setLocationError] = useState(""), [savedMessage, setSavedMessage] = useState("");
  const locateSequence = useRef(0);
  const cancelLocations = useCallback(() => { locateSequence.current++; }, []);
  useEffect(() => {
    let cancelled = false;
    void request<GeofenceState>("geofenceState", storeId ? { storeId } : {}).then(next => { if (!cancelled) { setFences(next.fences); setError(""); } })
      .catch(e => { if (!cancelled) { setFences([]); setError((e as Error).message); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; cancelLocations(); };
  }, [storeId, reload, cancelLocations]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const visibleStores = stores.filter(store => (!storeId || store.id === storeId) && (manage || store.status !== "inactive"));
  const preferredStoreId = storeId || selected;
  const selectedStoreId = visibleStores.some(store => store.id === preferredStoreId) ? preferredStoreId : visibleStores[0]?.id || "";
  const fence = fences.find(item => item.storeId === selectedStoreId);
  const currentLocation = locationOverride && (!location || locationOverride.timestamp >= location.timestamp) ? locationOverride : location;
  const result = checkGeofence(fence, currentLocation, now);
  const refresh = () => { locateSequence.current++; setLocating(false); setLocation(null); setLocationError(""); setLoading(true); setReload(value => value + 1); };
  const chooseStore = (id: string) => { locateSequence.current++; setSelected(id); setLocation(null); setLocating(false); setLocationError(""); setSavedMessage(""); };
  return <section className={`surface geofence-panel geofence-center ${compact ? "geofence-compact" : ""}`} aria-label={manage ? "门店电子围栏设置" : "附近门店与到店范围"}>
    <div className="geofence-heading"><div><span className="pill gold"><ShieldCheck size={15} />{manage || compact ? "到店范围" : "发现附近"}</span><h2>{manage ? "电子围栏设置" : compact ? "到店确认" : "发现门店与活动"}</h2><p className="muted">{manage ? "设置真实位置与范围，保存后由服务端校验。" : compact ? "到达门店范围后，再确认金币并解谜领奖。" : "看看附近有哪些门店和活动，到店后开启寻宝。"}</p></div><button type="button" className="outline-button" disabled={loading} onClick={refresh}><RefreshCw size={16} />{manage ? "刷新围栏" : "刷新门店范围"}</button></div>
    {!manage && !compact && visibleStores.length > 0 && <GeofenceStorePicker stores={visibleStores} fences={fences} selectedStoreId={selectedStoreId} now={now} loading={loading} onSelect={chooseStore} />}
    {manage && visibleStores.length > 1 && <fieldset className="geofence-store-picker"><legend>选择门店 <span>{visibleStores.length} 家可切换</span></legend><div className="geofence-store-options">{visibleStores.map(store => {
      const configured = fences.find(item => item.storeId === store.id);
      const active = configured?.enabled && validFenceGeometry(configured);
      const checked = selectedStoreId === store.id;
      return <label className={`geofence-store-option${checked ? " is-selected" : ""}`} key={store.id}>
        <input type="radio" name={storeChoiceId} value={store.id} checked={checked} onChange={() => chooseStore(store.id)} />
        <span className="geofence-store-copy"><strong>{store.name}</strong><span>{store.floor} · {store.area}</span><small>{loading ? "正在读取范围…" : active ? "到店范围已启用" : "范围待设置"}</small></span>
        {checked ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
      </label>;
    })}</div></fieldset>}
    {savedMessage && <p role="status">{savedMessage}</p>}
    {loading ? <p role="status">正在读取门店范围…</p> : error ? <p className="inline-error" role="alert">{error}</p> : !visibleStores.length ? <div className="geofence-status"><MapPin size={20} /><div><strong>{storeId ? "该门店暂时无法浏览" : "暂时没有可浏览的门店"}</strong><p>门店可能已停用，请稍后刷新或查看其他门店。</p></div></div> : manage && fence ? <FenceEditor key={`${fence.storeId}:${fence.revision}:${reload}`} fence={fence} onRefresh={refresh} onSaved={next => { setFences(items => items.map(item => item.storeId === next.storeId ? next : item)); setSavedMessage("门店围栏已保存。配置将用于新的确认与领奖。"); }} /> : <>
      <div className={`geofence-status ${result.inside ? "is-inside" : ""}`} aria-live="polite"><MapPin size={20} /><div><strong>{geofenceMessage(result.reason)}</strong>{fence?.radiusMeters != null && <p>{fence.shapeType === "polygon" ? "自定义多边形边界" : `围栏半径 ${Math.round(fence.radiusMeters)} 米`}{result.distanceMeters != null ? ` · 距中心 ${Math.round(result.distanceMeters)} 米` : ""}{currentLocation ? ` · 定位精度 ±${Math.ceil(currentLocation.accuracy)} 米` : ""}</p>}</div></div>
      {!compact && <StoreActivityDiscovery key={selectedStoreId} storeId={selectedStoreId} fence={fence} location={currentLocation} now={now} reloadKey={reload} treasures={treasures} onOpenTask={onOpenTask} onRefreshTasks={onRefreshTasks} />}
      <div className="geofence-actions"><button type="button" className="gold-button" disabled={locating || !fence?.enabled} onClick={async () => {
        const sequence = ++locateSequence.current; setLocating(true); setLocationError(""); setLocation(null);
        try { const position = await readBrowserLocation(); if (sequence === locateSequence.current) { setLocation(position); setNow(Date.now()); } }
        catch (e) { if (sequence === locateSequence.current) setLocationError((e as Error).message); }
        finally { if (sequence === locateSequence.current) setLocating(false); }
      }}><LocateFixed size={17} />{locating ? "正在定位…" : "定位并检查范围"}</button></div>
      {locationError && <p className="inline-error" role="alert">{locationError}</p>}
      <p className="muted">位置仅用于本次范围校验。确认与领奖时会重新定位；室内精度不足时，请靠近门店并重试。</p>
    </>}
    {manage && onActivities && <aside className="geofence-publish-entry"><div><h3>让大家知道门店有活动</h3><p className="muted">保存门店位置和范围后，填写活动内容与时间；按现有审核规则发布到玩家地图。</p></div><button type="button" className="gold-button" onClick={onActivities}><Megaphone size={17} />发布门店活动</button></aside>}
  </section>;
}
