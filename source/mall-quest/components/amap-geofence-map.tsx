"use client";
import {useEffect,useRef,useState} from "react";
import {gcj02ToWgs84,wgs84ToGcj02,type MapCoordinate} from "@/lib/amap-coordinates";
import {loadAmapSdk,type AmapEvent,type AmapMap,type AmapOverlay,type AmapSdk} from "@/lib/amap-sdk";
import {validCoordinates,type GeoLocation,type StoreGeofence} from "@/lib/geofence";
import type {StoreActivity} from "@/lib/store-activity-types";
import "./amap-extensions.css";
export type AmapStoreMarker={id:string;name:string;latitude:number;longitude:number};
export type AmapGeofenceMapProps={
 fence?:StoreGeofence|null;fences?:StoreGeofence[];location?:GeoLocation|null;
 onPick?:(point:MapCoordinate)=>void;activities?:StoreActivity[];
 onActivitySelect?:(activity:StoreActivity)=>void;markers?:AmapStoreMarker[];
 onMarkerSelect?:(id:string,origin:HTMLElement)=>void;centerRequest?:number;polygonVertices?:MapCoordinate[];
};
type Runtime={map:AmapMap;sdk:AmapSdk;initialFit:boolean;locationCentered:boolean;userMoved:boolean;centerRequest:number;anchorKey:string;lastPicked:MapCoordinate|null};
function coordinate(p:{latitude?:number|null;longitude?:number|null}|null|undefined):MapCoordinate|null{
 if(!p||typeof p.latitude!=="number"||typeof p.longitude!=="number"||!validCoordinates(p.latitude,p.longitude))return null;
 return {latitude:p.latitude,longitude:p.longitude};
}
function position(p:MapCoordinate):[number,number]{const v=wgs84ToGcj02(p);return [v.longitude,v.latitude];}
function themeStyle(){return document.documentElement.dataset.questTheme==="dark"?"amap://styles/dark":"amap://styles/normal";}
function anchorIdentity(fence:StoreGeofence|null|undefined){const p=coordinate(fence);return p?fence!.storeId+":"+p.latitude+":"+p.longitude:"";}
function closeTo(a:MapCoordinate|null,b:MapCoordinate){return !!a&&Math.abs(a.latitude-b.latitude)<0.000001&&Math.abs(a.longitude-b.longitude)<0.000001;}
export function AmapGeofenceMap(props:AmapGeofenceMapProps){
 const {fence,fences,location,onPick,activities,markers,centerRequest=0,polygonVertices}=props;
 const isEditor=!!onPick,host=useRef<HTMLDivElement>(null),latest=useRef(props),runtime=useRef<Runtime|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),[generation,setGeneration]=useState(0);
 useEffect(()=>{latest.current=props;});
 useEffect(()=>{
  let cancelled=false,active:Runtime|null=null,themeObserver:MutationObserver|undefined,resizeObserver:ResizeObserver|undefined,resizeFrame=0;
  const element=host.current;if(!element)return;setReady(false);setError("");
  const moved=()=>{if(active)active.userMoved=true;};
  const touch=(e:TouchEvent)=>{if(e.touches.length>1)moved();};
  const clicked=(e:AmapEvent)=>{
   if(!active||!e.lnglat||!latest.current.onPick)return;
   const source=e.originalEvent?.target;if(source instanceof Element&&source.closest(".amap-store-marker,.geofence-activity-marker"))return;
   const p=gcj02ToWgs84({longitude:e.lnglat.getLng(),latitude:e.lnglat.getLat()});
   if(!validCoordinates(p.latitude,p.longitude))return;active.lastPicked=p;latest.current.onPick(p);
  };
  void loadAmapSdk().then(sdk=>{
   if(cancelled)return;const current=latest.current,gps=coordinate(current.location),editor=current.onPick?coordinate(current.fence):null;
   const fallback=coordinate(current.fence)||(current.fences||[]).map(coordinate).find(Boolean)||null,initial=editor||gps||fallback;
   const map=new sdk.Map(element,{center:initial?position(initial):[105,35],zoom:initial?16:4,resizeEnable:true,mapStyle:themeStyle()});
   active={map,sdk,initialFit:!!gps&&!editor,locationCentered:!!gps,userMoved:false,centerRequest:current.centerRequest||0,anchorKey:anchorIdentity(current.fence),lastPicked:null};
   runtime.current=active;map.on("click",clicked);map.on("dragstart",moved);
   element.addEventListener("wheel",moved,{passive:true});element.addEventListener("touchstart",touch,{passive:true});
   themeObserver=new MutationObserver(()=>map.setMapStyle(themeStyle()));
   themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["data-quest-theme"]});
   if(typeof ResizeObserver!=="undefined"){resizeObserver=new ResizeObserver(()=>{
    window.cancelAnimationFrame(resizeFrame);resizeFrame=window.requestAnimationFrame(()=>{if(!cancelled)map.resize?.();});
   });resizeObserver.observe(element);}
   setError("");setReady(true);setGeneration(value=>value+1);
  }).catch(cause=>{if(!cancelled){setReady(false);setError(cause instanceof Error?cause.message:"真实地图暂时无法加载，请稍后重试。");}});
  return ()=>{
   cancelled=true;themeObserver?.disconnect();resizeObserver?.disconnect();window.cancelAnimationFrame(resizeFrame);
   element.removeEventListener("wheel",moved);element.removeEventListener("touchstart",touch);
   if(active){active.map.off("click",clicked);active.map.off("dragstart",moved);if(runtime.current===active)runtime.current=null;try{active.map.destroy();}catch{/* SDK initialization may have stopped midway. */}}
  };
 },[retry]);
 useEffect(()=>{
  const active=runtime.current;if(!active)return;
  const {map,sdk}=active,overlays:AmapOverlay[]=[],fit:AmapOverlay[]=[],removeListeners:(()=>void)[]=[];
  const customIds=new Set((markers||[]).map(m=>m.id)),firstActivity=new Map<string,StoreActivity>();
  for(const a of activities||[])if(!firstActivity.has(a.storeId)&&a.fence?.enabled&&coordinate(a.fence))firstActivity.set(a.storeId,a);
  const drawPolygon=(vertices:MapCoordinate[],title:string,draft:boolean)=>{
   if(!vertices.length||!vertices.every(p=>!!coordinate(p)))return;
   const path=vertices.map(position),style={path,strokeColor:"#315c44",strokeWeight:2,fillColor:"#a5c394",fillOpacity:.24,bubble:true};let item:AmapOverlay|undefined;
   if(path.length>=3)item=new sdk.Polygon(style);
   else if(draft&&path.length===2)item=new sdk.Polyline({...style,strokeStyle:"dashed"});
   else if(draft)item=new sdk.Marker({position:path[0],title:title+"边界起点",bubble:true});
   if(item){overlays.push(item);fit.push(item);}
  };
  const visible=new Map<string,StoreGeofence>();
  for(const f of fences||[])if(f.enabled)visible.set(f.storeId,f);
  if(fence&&(fence.enabled||isEditor))visible.set(fence.storeId,fence);
  for(const f of visible.values()){
   const center=coordinate(f),preview=isEditor&&f.storeId===fence?.storeId;
   const vertices=preview&&polygonVertices!==undefined?polygonVertices:f.polygonVertices||[];
   if(f.shapeType==="polygon"||preview&&polygonVertices!==undefined&&f.shapeType!=="circle")drawPolygon(vertices,f.storeName,preview);
   else if(center&&typeof f.radiusMeters==="number"&&f.radiusMeters>=20&&f.radiusMeters<=5000){const item=new sdk.Circle({center:position(center),radius:f.radiusMeters,strokeColor:"#315c44",strokeWeight:2,fillColor:"#a5c394",fillOpacity:.24,bubble:true});overlays.push(item);fit.push(item);}
   if(center&&!customIds.has(f.storeId)&&!firstActivity.has(f.storeId)){const item=new sdk.Marker({position:position(center),title:f.storeName,bubble:true});overlays.push(item);fit.push(item);}
  }
  if(isEditor&&polygonVertices&&!fence)drawPolygon(polygonVertices,"门店",true);
  for(const marker of markers||[]){
   const p=coordinate(marker);if(!p)continue;
   const content=document.createElement(latest.current.onMarkerSelect?"button":"span");content.className="amap-store-marker";content.textContent=marker.name;content.setAttribute("aria-label","查看"+marker.name+"的寻宝任务");
   if(content instanceof HTMLButtonElement){content.type="button";const click=(e:Event)=>{e.stopPropagation();latest.current.onMarkerSelect?.(marker.id,content);};content.addEventListener("click",click);removeListeners.push(()=>content.removeEventListener("click",click));}
   const item=new sdk.Marker({position:position(p),content,title:marker.name,anchor:"bottom-center",bubble:false});overlays.push(item);fit.push(item);
  }
  for(const a of firstActivity.values()){
   const p=coordinate(a.fence);if(customIds.has(a.storeId)||!p)continue;
   const button=document.createElement("button");button.type="button";button.className="geofence-activity-marker";button.textContent=a.storeName+" · 查看活动";button.setAttribute("aria-label","查看"+a.storeName+"的活动："+a.title);
   const click=(e:Event)=>{e.stopPropagation();latest.current.onActivitySelect?.(a);};button.addEventListener("click",click);removeListeners.push(()=>button.removeEventListener("click",click));
   const item=new sdk.Marker({position:position(p),content:button,title:a.title,anchor:"bottom-center",bubble:false});overlays.push(item);fit.push(item);
  }
  const gps=coordinate(location);
  if(gps&&location){
   if(Number.isFinite(location.accuracy)&&location.accuracy>0)overlays.push(new sdk.Circle({center:position(gps),radius:location.accuracy,strokeColor:"#3b82b0",strokeWeight:1,fillColor:"#7fb3d4",fillOpacity:.18,bubble:true}));
   overlays.push(new sdk.Marker({position:position(gps),title:"你的当前位置",bubble:true}));
  }
  if(overlays.length)map.add(overlays);
  let centered=false;const requested=active.centerRequest!==centerRequest;active.centerRequest=centerRequest;
  if(gps&&(requested||!active.locationCentered&&!isEditor)){map.setZoomAndCenter(16,position(gps),true);active.locationCentered=true;active.initialFit=true;centered=true;}
  const anchor=coordinate(fence),nextKey=anchorIdentity(fence),changed=active.anchorKey!==nextKey;active.anchorKey=nextKey;
  if(!centered&&isEditor&&anchor&&changed&&!closeTo(active.lastPicked,anchor)){map.setZoomAndCenter(16,position(anchor),true);active.initialFit=true;centered=true;}
  if(!centered&&!active.initialFit&&!active.userMoved&&fit.length){map.setFitView(fit,true,[40,40,40,40],17);active.initialFit=true;}
  return ()=>{for(const remove of removeListeners)remove();if(overlays.length&&runtime.current===active)try{map.remove(overlays);}catch{/* Map already left. */}};
 },[generation,fence,fences,location,isEditor,activities,markers,centerRequest,polygonVertices]);
 return <div className="geofence-map-wrap"><div className="geofence-map" ref={host} role="region" aria-label={isEditor?"选择门店位置与边界的高德地图":"门店位置与到店范围地图"}/>
 {!ready&&<div className="geofence-map-status" role="status"><p>{error||"正在加载真实地图…"}</p>{error&&<button type="button" className="outline-button" onClick={()=>setRetry(value=>value+1)}>重新加载地图</button>}</div>}</div>;
}
