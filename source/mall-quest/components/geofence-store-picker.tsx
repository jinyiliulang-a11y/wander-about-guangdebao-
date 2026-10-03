"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, LocateFixed, Search, Store as StoreIcon } from "lucide-react";
import { readBrowserLocation } from "@/lib/browser-location";
import type { GeoLocation, StoreGeofence } from "@/lib/geofence";
import type { Store } from "@/lib/game-types";
import { approximateDistance, nearbyStores, NEARBY_RADII, type NearbyRadius } from "@/lib/nearby-stores";
import { Drawer } from "./common/Drawer";
import "./geofence-store-picker.css";

const radiusLabel = (radius: NearbyRadius) => radius === 0 ? "全部门店" : radius < 1000 ? `${radius} 米` : `${radius / 1000} 公里`;
export function GeofenceStorePicker({ stores, fences, selectedStoreId, now, loading, onSelect }: { stores: Store[]; fences: StoreGeofence[]; selectedStoreId: string; now: number; loading: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false), [radius, setRadius] = useState<NearbyRadius>(0), [search, setSearch] = useState("");
  const [location, setLocation] = useState<GeoLocation | null>(null), [locating, setLocating] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), group = useId();
  useEffect(() => () => { sequence.current++; }, []);
  const result = nearbyStores(stores, fences, radius, location, now);
  const query = search.trim().toLocaleLowerCase();
  const matches = result.entries.filter(({ store }) => `${store.name} ${store.floor} ${store.area} ${store.address || ""}`.toLocaleLowerCase().includes(query));
  const current = stores.find(store => store.id === selectedStoreId);
  const locate = async () => {
    const id = ++sequence.current; setLocating(true); setError(""); setLocation(null);
    try { const next = await readBrowserLocation(); if (id === sequence.current) setLocation(next); }
    catch (cause) { if (id === sequence.current) setError((cause as Error).message); }
    finally { if (id === sequence.current) setLocating(false); }
  };
  const cancel = () => { sequence.current++; setLocating(false); setOpen(false); };
  const fallback = radius > 0 && result.reason !== "nearby";
  const status = radius === 0 ? `${result.entries.length} 家门店可浏览` : fallback ? "当前展示全部门店" : `${radiusLabel(radius)}内约 ${result.entries.length} 家门店`;
  return <div className="geofence-shop-discovery">
    <button type="button" className="geofence-shop-launch" onClick={() => setOpen(true)} aria-haspopup="dialog"><StoreIcon size={21} /><span><strong>{current?.name || "选择门店"}</strong><small>{status} · 点击选择与筛选</small></span><ChevronRight size={20} /></button>
    {open && <Drawer title="选择门店" historyKey="geofence-stores" onClose={cancel}>{close => <div className="geofence-shop-drawer">
      <label className="geofence-shop-search"><Search size={18} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索门店、楼层或区域" aria-label="搜索门店" /></label>
      <fieldset className="geofence-radius-picker"><legend>附近范围</legend><div>{NEARBY_RADII.map(value => <label key={value} className={radius === value ? "is-selected" : ""}><input type="radio" name={`${group}-radius`} value={value} checked={radius === value} onChange={() => {
        setRadius(value);
        if (value === 0) { sequence.current++; setLocating(false); setError(""); }
        else if (["location-required", "stale-location", "invalid-location"].includes(nearbyStores(stores, fences, value, location, now).reason)) void locate();
      }} />{radiusLabel(value)}</label>)}</div></fieldset>
      <div className="geofence-shop-location"><button type="button" className="outline-button" disabled={locating} onClick={() => void locate()}><LocateFixed size={17} />{locating ? "正在定位…" : "刷新当前位置"}</button><p className="muted">定位仅在本页面内存保留，用于估算附近距离；确认金币与领奖会重新定位。</p></div>
      <div className="geofence-shop-result" aria-live="polite"><strong>{locating ? "正在获取位置，先展示全部门店" : status}</strong>
        {fallback && !locating && <p>{result.reason === "precision-low" ? "定位误差超过所选范围，暂时展示全部门店。可选更大范围或重新定位。" : result.reason === "stale-location" ? "附近位置已过期，暂时展示全部门店。请刷新当前位置。" : "尚未取得可用定位，暂时展示全部门店。"}</p>}
        {result.reason === "nearby" && <p>距离为估算，含定位误差；仅列出已启用有效门店位置的商家。</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <fieldset className="geofence-store-picker"><legend>{query ? `搜索结果 ${matches.length} 家` : `可选门店 ${matches.length} 家`}</legend><div className="geofence-store-options">{matches.map(({ store, distanceMeters, configured }) => <label className={`geofence-store-option${selectedStoreId === store.id ? " is-selected" : ""}`} key={store.id}>
        <input type="radio" name={`${group}-store`} value={store.id} checked={selectedStoreId === store.id} onChange={() => { onSelect(store.id); sequence.current++; setLocating(false); close(); }} />
        <span className="geofence-store-copy"><strong>{store.name}</strong><span>{store.floor} · {store.area}{distanceMeters !== null ? ` · ${approximateDistance(distanceMeters)}` : ""}</span><small>{loading ? "正在读取范围…" : configured ? "到店范围已启用" : "范围待设置或已停用"}</small></span>
        {selectedStoreId === store.id ? <CheckCircle2 size={20} /> : <Circle size={20} />}
      </label>)}</div></fieldset>
      {!matches.length && <div className="geofence-shop-empty"><StoreIcon size={26} /><p>{query ? "没有找到匹配的门店，试试其他关键词。" : "所选范围内暂时没有门店，可扩大范围或查看全部。"}</p></div>}
      {result.reason === "nearby" && !result.entries.some(entry => entry.store.id === selectedStoreId) && <p className="muted">当前查看的门店不在所选范围内，选取新门店后主地图才会切换。</p>}
    </div>}</Drawer>}
  </div>;
}
