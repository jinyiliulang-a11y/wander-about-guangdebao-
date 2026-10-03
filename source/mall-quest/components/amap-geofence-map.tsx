"use client";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/game-api";
import { gcj02ToWgs84, wgs84ToGcj02, type MapCoordinate } from "@/lib/amap-coordinates";
import type { GeoLocation, StoreGeofence } from "@/lib/geofence";
import { validCoordinates } from "@/lib/geofence";
import type { StoreActivity } from "@/lib/store-activity-types";

type MapClick = { lnglat: { getLng: () => number; getLat: () => number } };
type MapInstance = { add: (items: unknown[]) => void; destroy: () => void; on: (event: string, handler: (e: MapClick) => void) => void; setFitView: (items: unknown[], immediately: boolean, padding: number[], maxZoom: number) => void; setMapStyle?: (style: string) => void };
type MapSdk = { Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  Circle: new (options: Record<string, unknown>) => unknown; Marker: new (options: Record<string, unknown>) => unknown };
type MapWindow = Window & { AMap?: MapSdk; _AMapSecurityConfig?: { serviceHost: string } };
let sdkPromise: Promise<MapSdk> | undefined;
function loadMapSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const config = await apiRequest<{ available: boolean; key?: string; servicePath?: string }>("/api/maps/config", {}, { readOnly: true });
    if (!config.available || !config.key || config.servicePath !== "/api/maps/service") throw new Error("真实地图暂不可用；仍可用手机定位或手填坐标设置范围。");
    const target = window as MapWindow;
    target._AMapSecurityConfig = { serviceHost: window.location.origin + config.servicePath };
    if (target.AMap) return target.AMap;
    return new Promise<MapSdk>((resolve, reject) => {
      const script = document.createElement("script"), url = new URL("https://webapi.amap.com/maps");
      url.searchParams.set("v", "2.0"); url.searchParams.set("key", config.key!);
      const timer = window.setTimeout(() => { script.onload = null; script.onerror = null; script.remove(); reject(new Error("地图加载超时，请检查网络后重试。")); }, 12_000);
      script.src = url.href; script.async = true;
      script.onload = () => { window.clearTimeout(timer); script.onload = null; script.onerror = null; if (target.AMap) resolve(target.AMap); else { script.remove(); reject(new Error("地图未能加载，请稍后重试。")); } };
      script.onerror = () => { window.clearTimeout(timer); script.onload = null; script.onerror = null; script.remove(); reject(new Error("地图暂时无法连接；位置校验仍可使用。")); };
      document.head.appendChild(script);
    });
  })().catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}
export function AmapGeofenceMap({ fence, location, onPick, activities, onActivitySelect }: { fence?: StoreGeofence | null; location?: GeoLocation | null; onPick?: (point: MapCoordinate) => void; activities?: StoreActivity[]; onActivitySelect?: (activity: StoreActivity) => void }) {
  const host = useRef<HTMLDivElement>(null), pick = useRef(onPick);
  const activitySelect = useRef(onActivitySelect);
  const [error, setError] = useState(""), [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => { activitySelect.current = onActivitySelect; }, [onActivitySelect]);
  useEffect(() => {
    let cancelled = false, map: MapInstance | undefined, themeObserver: MutationObserver | undefined;
    void loadMapSdk().then(sdk => {
      if (cancelled || !host.current) return;
      const center = fence?.latitude != null && fence?.longitude != null ? wgs84ToGcj02({ latitude: fence.latitude, longitude: fence.longitude }) : location ? wgs84ToGcj02(location) : null;
      map = new sdk.Map(host.current, { zoom: center ? 16 : 4, center: center ? [center.longitude, center.latitude] : [105, 35], resizeEnable: true,
        mapStyle: document.documentElement.dataset.questTheme === "dark" ? "amap://styles/dark" : "amap://styles/normal" });
      const overlays: unknown[] = [];
      if (center && fence?.latitude != null && fence.radiusMeters != null) {
        overlays.push(new sdk.Circle({ center: [center.longitude, center.latitude], radius: fence.radiusMeters, strokeColor: "#315c44", strokeWeight: 2, fillColor: "#a5c394", fillOpacity: .3 }));
        overlays.push(new sdk.Marker({ position: [center.longitude, center.latitude], title: `${fence.storeName}围栏中心` }));
      }
      if (location) {
        const point = wgs84ToGcj02(location);
        overlays.push(new sdk.Circle({ center: [point.longitude, point.latitude], radius: location.accuracy, strokeColor: "#3b82b0", fillColor: "#7fb3d4", fillOpacity: .24 }));
        overlays.push(new sdk.Marker({ position: [point.longitude, point.latitude], title: "你的定位位置" }));
      }
      const firstByStore = new Map<string, StoreActivity>();
      for (const activity of activities || []) if (!firstByStore.has(activity.storeId)) firstByStore.set(activity.storeId, activity);
      for (const activity of firstByStore.values()) {
        if (!activity.fence?.enabled || !validCoordinates(activity.fence.latitude, activity.fence.longitude)) continue;
        const point = wgs84ToGcj02({ latitude: activity.fence.latitude!, longitude: activity.fence.longitude! });
        const button = document.createElement("button");
        button.type = "button"; button.className = "geofence-activity-marker";
        button.textContent = `${activity.storeName} · 查看活动`;
        button.setAttribute("aria-label", `查看${activity.storeName}的活动：${activity.title}`);
        button.addEventListener("click", event => { event.stopPropagation(); activitySelect.current?.(activity); });
        overlays.push(new sdk.Marker({ position: [point.longitude, point.latitude], content: button, title: activity.title, anchor: "bottom-center" }));
      }
      if (overlays.length) { map.add(overlays); map.setFitView(overlays, true, [32, 32, 32, 32], 17); }
      map.on("click", event => { if (pick.current) pick.current(gcj02ToWgs84({ longitude: event.lnglat.getLng(), latitude: event.lnglat.getLat() })); });
      themeObserver = new MutationObserver(() => map?.setMapStyle?.(document.documentElement.dataset.questTheme === "dark" ? "amap://styles/dark" : "amap://styles/normal"));
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-quest-theme"] });
      setError(""); setReady(true);
    }).catch(e => {
      themeObserver?.disconnect();
      try { map?.destroy(); } catch { /* SDK initialization may have stopped midway. */ }
      map = undefined;
      if (!cancelled) { setReady(false); setError((e as Error).message); }
    });
    return () => { cancelled = true; themeObserver?.disconnect(); map?.destroy(); };
  }, [fence, location, activities, retry]);
  return <div className="geofence-map-wrap">
    <div className="geofence-map" ref={host} role="region" aria-label={onPick ? "选择门店围栏中心的高德地图" : "门店位置与到店范围地图"} />
    {!ready && <div className="geofence-map-status" role="status"><p>{error || "正在加载真实地图…"}</p>{error && <button type="button" className="outline-button" onClick={() => { setError(""); setRetry(value => value + 1); }}>重新加载地图</button>}</div>}
  </div>;
}
