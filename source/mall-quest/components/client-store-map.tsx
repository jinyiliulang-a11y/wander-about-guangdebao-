"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {LocateFixed,RefreshCw} from "lucide-react";
import {request} from "@/lib/game-api";
import {readBrowserLocation} from "@/lib/browser-location";
import {validFenceGeometry,type GeoLocation,type GeofenceState,type StoreGeofence} from "@/lib/geofence";
import type {Store,Task} from "@/lib/game-types";
import {AmapGeofenceMap} from "./amap-geofence-map";
import "./client-store-map.css";
import "./client-store-map-overlay.css";
// StrictMode replay shares only this positioning request; rewards request fresh GPS.
let firstLocationPromise:Promise<GeoLocation>|undefined;
function firstBrowserLocation(){firstLocationPromise??=Promise.resolve().then(()=>readBrowserLocation());return firstLocationPromise;}
export function ClientStoreMap({stores,tasks,floor,onTask}:{stores:Store[];tasks:Task[];floor:string;onTask:(task:Task,origin:HTMLElement)=>void}){
 const [fences,setFences]=useState<StoreGeofence[]>([]),[loading,setLoading]=useState(true),[fenceError,setFenceError]=useState(""),[reload,setReload]=useState(0);
 const [location,setLocation]=useState<GeoLocation|null>(null),[locating,setLocating]=useState(true),[locationError,setLocationError]=useState(""),[centerRequest,setCenterRequest]=useState(0),[selectionMessage,setSelectionMessage]=useState("");
 const mounted=useRef(false),locateSequence=useRef(0);
 const storeKey=stores.map(s=>s.id).sort().join("|");
 useEffect(()=>{
  let cancelled=false;setLoading(true);setFenceError("");
  void request<GeofenceState>("geofenceState",{}).then(next=>{if(!cancelled)setFences(next.fences);})
   .catch(cause=>{if(!cancelled){setFences([]);setFenceError((cause as Error).message||"门店范围暂时无法读取。");}})
   .finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[storeKey,reload]);
 useEffect(()=>{
  mounted.current=true;const sequence=++locateSequence.current;setLocating(true);
  void firstBrowserLocation().then(p=>{if(mounted.current&&sequence===locateSequence.current){setLocation(p);setLocationError("");}})
   .catch(cause=>{if(mounted.current&&sequence===locateSequence.current)setLocationError((cause as Error).message||"定位未成功，请重试。");})
   .finally(()=>{if(mounted.current&&sequence===locateSequence.current)setLocating(false);});
  return ()=>{mounted.current=false;locateSequence.current++;};
 },[]);
 const locateAgain=useCallback(async()=>{
  const sequence=++locateSequence.current;setLocating(true);setLocationError("");
  try{const p=await readBrowserLocation();if(mounted.current&&sequence===locateSequence.current){setLocation(p);setCenterRequest(v=>v+1);}}
  catch(cause){if(mounted.current&&sequence===locateSequence.current)setLocationError((cause as Error).message||"定位未成功，请重试。");}
  finally{if(mounted.current&&sequence===locateSequence.current)setLocating(false);}
 },[]);
 const floorStores=useMemo(()=>new Map(stores.filter(s=>s.floor===floor&&s.status!=="inactive").map(s=>[s.id,s])),[stores,floor]);
 const visibleFences=useMemo(()=>fences.filter(f=>floorStores.has(f.storeId)&&f.enabled&&f.coordinateSystem==="WGS84"&&Number.isSafeInteger(f.revision)&&f.revision>=1&&validFenceGeometry(f)),[fences,floorStores]);
 const markers=useMemo(()=>visibleFences.map(f=>({id:f.storeId,name:floorStores.get(f.storeId)?.name||f.storeName,latitude:f.latitude!,longitude:f.longitude!})),[visibleFences,floorStores]);
 useEffect(()=>{setSelectionMessage("");},[floor]);
 const selectMarker=useCallback((storeId:string,origin:HTMLElement)=>{
  const group=tasks.filter(t=>t.storeId===storeId&&t.floor===floor&&t.status==="published");
  const task=group.find(t=>!t.claimed&&!t.own&&t.remaining>0)||group[0];
  if(task){setSelectionMessage("");onTask(task,origin);}else setSelectionMessage((floorStores.get(storeId)?.name||"该门店")+"暂无公开宝藏。");
 },[tasks,floor,onTask,floorStores]);
 const statusVisible=loading||!!fenceError||!!locationError||!!selectionMessage||!visibleFences.length;
 return <div className="client-store-map">
  <AmapGeofenceMap fences={visibleFences} markers={markers} location={location} centerRequest={centerRequest} onMarkerSelect={selectMarker}/>
  {statusVisible&&<div className="client-store-map-status" role="status" aria-live="polite">
   {loading?<span>正在读取门店范围…</span>:fenceError?<span>{fenceError}</span>:!visibleFences.length?<span>本层暂无已设置范围的门店。</span>:null}
   {!!fenceError&&<button type="button" onClick={()=>setReload(v=>v+1)}><RefreshCw size={14} aria-hidden="true"/>重新读取</button>}
   {!!locationError&&<span>{locationError}</span>}{!!selectionMessage&&<span>{selectionMessage}</span>}
  </div>}
  <button type="button" className="client-store-map-locate" onClick={()=>void locateAgain()} disabled={locating} aria-label={locating?"正在获取当前位置":"定位到我的当前位置"}>
   <LocateFixed size={18} aria-hidden="true"/><span>{locating?"定位中…":location?"重新定位":"定位"}</span>
  </button>
 </div>;
}
