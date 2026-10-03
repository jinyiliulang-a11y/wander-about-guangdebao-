"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, LocateFixed, MapPin, Megaphone, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { request, isUncertainResult } from "@/lib/game-api";
import { readBrowserLocation } from "@/lib/browser-location";
import { checkGeofence, geofenceMessage, validCoordinates, validRadius, type GeoLocation, type GeofenceState, type StoreGeofence } from "@/lib/geofence";
import type { Store, Task } from "@/lib/game-types";
import { AmapGeofenceMap } from "./amap-geofence-map";
import { StoreActivityDiscovery } from "./store-activity-discovery";
import { GeofenceStorePicker } from "./geofence-store-picker";
import "./geofence-panel.css";

function FenceEditor({ fence, onSaved, onRefresh }: { fence: StoreGeofence; onSaved: (next: StoreGeofence) => void; onRefresh: () => void }) {
  const [latitude, setLatitude] = useState(fence.latitude == null ? "" : String(fence.latitude));
  const [longitude, setLongitude] = useState(fence.longitude == null ? "" : String(fence.longitude));
  const [radius, setRadius] = useState(fence.radiusMeters == null ? "100" : String(fence.radiusMeters));
  const [enabled, setEnabled] = useState(fence.enabled), [busy, setBusy] = useState(false), [locating, setLocating] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const centerValid = latitude.trim() !== "" && longitude.trim() !== "" && validCoordinates(Number(latitude), Number(longitude));
  const draft = useMemo(() => centerValid && validRadius(Number(radius)) ? { ...fence, latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radius), enabled } : null,
    [centerValid, fence, latitude, longitude, radius, enabled]);
  const setCenter = (point: { latitude: number; longitude: number }) => { setLatitude(point.latitude.toFixed(7)); setLongitude(point.longitude.toFixed(7)); setError(""); setMessage("中心已选择，请核对后保存。"); };
  return <section className="geofence-editor">
    <h3>设置门店范围</h3><p className="muted">在高德地图点选真实门店，或到门店后使用当前位置。保存前请核对实际位置。</p>
    <AmapGeofenceMap fence={draft} onPick={busy || locating || uncertain ? undefined : setCenter} />
    <form aria-label="门店围栏配置" onSubmit={async event => {
      event.preventDefault(); if (busy || uncertain) return;
      if (enabled && (!centerValid || !validRadius(Number(radius)))) { setError("请填写真实经纬度及 20–5000 米的围栏半径。"); return; }
      setBusy(true); setError(""); setMessage("");
      try {
        const result = await request<{ fence: StoreGeofence; message: string }>("geofenceSave", { storeId: fence.storeId, enabled,
          latitude: centerValid ? Number(latitude) : null, longitude: centerValid ? Number(longitude) : null,
          radiusMeters: centerValid && validRadius(Number(radius)) ? Number(radius) : null, expectedRevision: fence.revision }, "workspace");
        if (alive.current) { onSaved(result.fence); setMessage(result.message); }
      } catch (e) { if (alive.current) { setError((e as Error).message); if (isUncertainResult(e)) setUncertain(true); } }
      finally { if (alive.current) setBusy(false); }
    }}>
      <fieldset disabled={busy || locating || uncertain}>
        <div className="geofence-fields"><label>纬度（WGS84）<input className="ui-input" inputMode="decimal" type="number" step="any" min={-90} max={90} value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="选择地图位置或输入纬度" /></label>
          <label>经度（WGS84）<input className="ui-input" inputMode="decimal" type="number" step="any" min={-180} max={180} value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="选择地图位置或输入经度" /></label>
          <label>半径（米）<input className="ui-input" type="number" min={20} max={5000} step={1} value={radius} onChange={e => setRadius(e.target.value)} /></label>
        </div>
        <label className="geofence-enabled"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用围栏，到范围内才能确认金币与领奖</label>
        <p className="muted">未配置或停用时暂停新的确认与领奖。室内定位可能有误差，范围须结合实际场地设置；围栏不判断楼层。</p>
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <div className="geofence-actions"><button type="button" className="outline-button" disabled={busy || locating || uncertain} onClick={async () => {
        setLocating(true); setError("");
        try { const position = await readBrowserLocation(); if (alive.current) setCenter(position); }
        catch (e) { if (alive.current) setError((e as Error).message); }
        finally { if (alive.current) setLocating(false); }
      }}><LocateFixed size={17} />{locating ? "正在定位…" : "以当前位置为中心"}</button>
        <button className="gold-button" type="submit" disabled={busy || locating || uncertain}><Save size={17} />{busy ? "正在保存…" : "保存围栏"}</button>
        {uncertain && <button type="button" className="outline-button" onClick={onRefresh}>刷新围栏核对保存结果</button>}
      </div>
    </form>
  </section>;
}
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
      const active = configured?.enabled && validCoordinates(configured.latitude, configured.longitude) && validRadius(configured.radiusMeters);
      const checked = selectedStoreId === store.id;
      return <label className={`geofence-store-option${checked ? " is-selected" : ""}`} key={store.id}>
        <input type="radio" name={storeChoiceId} value={store.id} checked={checked} onChange={() => chooseStore(store.id)} />
        <span className="geofence-store-copy"><strong>{store.name}</strong><span>{store.floor} · {store.area}</span><small>{loading ? "正在读取范围…" : active ? "到店范围已启用" : "范围待设置"}</small></span>
        {checked ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
      </label>;
    })}</div></fieldset>}
    {savedMessage && <p role="status">{savedMessage}</p>}
    {loading ? <p role="status">正在读取门店范围…</p> : error ? <p className="inline-error" role="alert">{error}</p> : !visibleStores.length ? <div className="geofence-status"><MapPin size={20} /><div><strong>{storeId ? "该门店暂时无法浏览" : "暂时没有可浏览的门店"}</strong><p>门店可能已停用，请稍后刷新或查看其他门店。</p></div></div> : manage && fence ? <FenceEditor key={`${fence.storeId}:${fence.revision}:${reload}`} fence={fence} onRefresh={refresh} onSaved={next => { setFences(items => items.map(item => item.storeId === next.storeId ? next : item)); setSavedMessage("门店围栏已保存。配置将用于新的确认与领奖。"); }} /> : <>
      <div className={`geofence-status ${result.inside ? "is-inside" : ""}`} aria-live="polite"><MapPin size={20} /><div><strong>{geofenceMessage(result.reason)}</strong>{fence?.radiusMeters != null && <p>范围半径 {Math.round(fence.radiusMeters)} 米{result.distanceMeters != null ? ` · 距中心 ${Math.round(result.distanceMeters)} 米` : ""}{currentLocation ? ` · 定位精度 ±${Math.ceil(currentLocation.accuracy)} 米` : ""}</p>}</div></div>
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
