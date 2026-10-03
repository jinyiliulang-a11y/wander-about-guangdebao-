"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {LocateFixed,RefreshCw,Save} from "lucide-react";
import {request,isUncertainResult} from "@/lib/game-api";
import {readBrowserLocation} from "@/lib/browser-location";
import {distanceMeters,validCoordinates,validFenceGeometry,validRadius,type StoreGeofence} from "@/lib/geofence";
import {normalizePolygon} from "@/lib/polygon-geofence";
import type {MapCoordinate} from "@/lib/amap-coordinates";
import {AmapGeofenceMap} from "./amap-geofence-map";
import {AmapPoiSearch} from "./amap-poi-search";
import "./geofence-editor.css";

export function FenceEditor({fence,onSaved,onRefresh}:{fence:StoreGeofence;onSaved:(next:StoreGeofence)=>void;onRefresh:()=>void}){
 const [latitude,setLatitude]=useState(fence.latitude==null?"":String(fence.latitude));
 const [longitude,setLongitude]=useState(fence.longitude==null?"":String(fence.longitude));
 const [radius,setRadius]=useState(fence.radiusMeters==null?"100":String(fence.radiusMeters));
 const [shapeType,setShapeType]=useState<"circle"|"polygon">(fence.shapeType??"circle");
 const [vertices,setVertices]=useState<MapCoordinate[]>(()=>fence.polygonVertices?.map(v=>({...v}))??[]);
 const [drawing,setDrawing]=useState(false),[enabled,setEnabled]=useState(fence.enabled);
 const [busy,setBusy]=useState(false),[locating,setLocating]=useState(false),[uncertain,setUncertain]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const alive=useRef(true),saveLock=useRef(false),locationSequence=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;locationSequence.current++;};},[]);
 const locked=busy||locating||uncertain;
 const centerValid=latitude.trim()!==""&&longitude.trim()!==""&&validCoordinates(Number(latitude),Number(longitude));
 const geometry=useMemo(()=>{
  if(shapeType==="circle")return {vertices:null,error:"",radius:Number(radius)};
  try{
   const normalized=normalizePolygon(vertices);
   if(!centerValid)return {vertices:normalized,error:"请先选定门店真实位置。",radius:null};
   const envelope=Math.max(20,Math.ceil(Math.max(...normalized.map(v=>distanceMeters({latitude:Number(latitude),longitude:Number(longitude)},v)))));
   if(!validRadius(envelope))return {vertices:normalized,error:"每个边界点须在门店位置5000米以内。",radius:null};
   return {vertices:normalized,error:"",radius:envelope};
  }catch(cause){return {vertices:null,error:(cause as Error).message,radius:null};}
 },[centerValid,latitude,longitude,radius,shapeType,vertices]);
 const draft:StoreGeofence|null=centerValid?{...fence,latitude:Number(latitude),longitude:Number(longitude),radiusMeters:geometry.radius,enabled,shapeType,polygonVertices:shapeType==="polygon"?geometry.vertices:null}:null;
 const setCenter=(point:MapCoordinate)=>{
  if(locked||!validCoordinates(point.latitude,point.longitude))return;
  setLatitude(point.latitude.toFixed(7));setLongitude(point.longitude.toFixed(7));setError("");setMessage("门店位置已选择，请核对后保存。");
 };
 const pick=(point:MapCoordinate)=>{
  if(locked)return;
  if(shapeType==="polygon"&&drawing){
   if(vertices.length>=64){setError("边界最多64个点，请先撤销或移除点。");return;}
   if(!centerValid)setCenter(point);
   setVertices(current=>[...current,point]);setError("");setMessage("");
  }else setCenter(point);
 };
 const finish=()=>{
  if(geometry.error||!draft||!validFenceGeometry(draft)){setError(geometry.error||"请填写有效门店位置。");return;}
  setDrawing(false);setError("");setMessage("边界绘制完成，请核对后保存。");
 };
 const locate=async()=>{
  if(locked)return;
  const sequence=++locationSequence.current;setLocating(true);setError("");
  try{
   const p=await readBrowserLocation();
   if(alive.current&&sequence===locationSequence.current){
    setLatitude(p.latitude.toFixed(7));setLongitude(p.longitude.toFixed(7));
    setMessage("已读取当前位置，请确认这是门店位置。");
   }
  }catch(cause){if(alive.current&&sequence===locationSequence.current)setError((cause as Error).message);}
  finally{if(alive.current&&sequence===locationSequence.current)setLocating(false);}
 };
 return <section className="geofence-editor">
  <h3>设置门店位置与边界</h3>
  <p className="muted">搜索门店或点击地图选定位置。圆形范围可调整半径，多边形可沿实际营业区域逐点绘制。</p>
  <AmapPoiSearch locked={locked} onSelect={poi=>{if(locked)return;locationSequence.current++;setCenter(poi);setDrawing(false);}}/>
  <fieldset className="geofence-shape-picker" disabled={locked}>
   <legend>围栏形状</legend>
   <label><input type="radio" name={fence.storeId+"-shape"} checked={shapeType==="circle"} onChange={()=>{setShapeType("circle");setDrawing(false);setError("");}}/>圆形范围</label>
   <label><input type="radio" name={fence.storeId+"-shape"} checked={shapeType==="polygon"} onChange={()=>{setShapeType("polygon");setDrawing(false);setError("");}}/>自定义多边形</label>
  </fieldset>
  <AmapGeofenceMap fence={draft} onPick={locked?undefined:pick} polygonVertices={shapeType==="polygon"?vertices:undefined}/>
  {shapeType==="polygon"&&<div className="geofence-polygon-tools">
   <p role="status">{drawing?"依次点击地图添加边界点；拖动地图可移动视野。":"点击“绘制边界”开始，绘制完成后仍可调整门店位置。"} 已选 {vertices.length}/64 个点。</p>
   <div className="geofence-actions">
    <button type="button" className="outline-button" disabled={locked} onClick={()=>{setDrawing(value=>!value);setError("");}}>{drawing?"暂停绘制":"绘制边界"}</button>
    <button type="button" className="outline-button" disabled={locked||!vertices.length} onClick={()=>{setVertices(value=>value.slice(0,-1));setError("");}}>撤销最后一点</button>
    <button type="button" className="outline-button" disabled={locked||!vertices.length} onClick={()=>{setVertices([]);setDrawing(true);setError("");}}>重新绘制</button>
    <button type="button" className="outline-button" disabled={locked||vertices.length<3} onClick={finish}>完成边界</button>
   </div>
   {!!vertices.length&&<details><summary>查看与移除边界点</summary><ol className="geofence-vertex-list">{vertices.map((v,index)=><li key={index}><span>{index+1}：{v.latitude.toFixed(6)}，{v.longitude.toFixed(6)}</span><button type="button" disabled={locked} onClick={()=>{setVertices(current=>current.filter((_,i)=>i!==index));setError("");}} aria-label={"移除第"+(index+1)+"个边界点"}>移除</button></li>)}</ol></details>}
  </div>}
  <form aria-label="门店围栏配置" onSubmit={async event=>{
   event.preventDefault();if(locked||saveLock.current)return;
   if(drawing){setError("请先完成边界绘制，再保存围栏。");return;}
   if((enabled||shapeType==="polygon")&&(!draft||!validFenceGeometry(draft))){setError(geometry.error||"请填写真实经纬度及20–5000米半径。");return;}
   saveLock.current=true;setBusy(true);setError("");setMessage("");
   try{
    const result=await request<{fence:StoreGeofence;message:string}>("geofenceSave",{
     storeId:fence.storeId,enabled,shapeType,latitude:draft?.latitude??null,longitude:draft?.longitude??null,
     radiusMeters:draft&&validRadius(draft.radiusMeters)?draft.radiusMeters:null,
     polygonVertices:shapeType==="polygon"?geometry.vertices:null,expectedRevision:fence.revision,
    },"workspace");
    if(alive.current){onSaved(result.fence);setMessage(result.message);}
   }catch(cause){if(alive.current){setError((cause as Error).message);if(isUncertainResult(cause))setUncertain(true);}}
   finally{saveLock.current=false;if(alive.current)setBusy(false);}
  }}>
   <fieldset disabled={locked}>
    <div className="geofence-fields">
     <label>纬度（WGS84）<input className="ui-input" inputMode="decimal" type="number" step="any" min={-90} max={90} value={latitude} onChange={e=>setLatitude(e.target.value)}/></label>
     <label>经度（WGS84）<input className="ui-input" inputMode="decimal" type="number" step="any" min={-180} max={180} value={longitude} onChange={e=>setLongitude(e.target.value)}/></label>
     {shapeType==="circle"&&<label>半径（米）<input className="ui-input" type="number" min={20} max={5000} step={1} value={radius} onChange={e=>setRadius(e.target.value)}/></label>}
    </div>
    <label className="geofence-enabled"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用围栏，到范围内才能确认金币与领奖</label>
    <p className="muted">定位精度范围必须完整位于围栏内。楼层信息和室内定位误差仍需结合实际场地核对。</p>
   </fieldset>
   {error&&<p className="inline-error" role="alert">{error}</p>}
   {message&&<p role="status">{message}</p>}
   <div className="geofence-actions">
    <button type="button" className="outline-button" disabled={locked} onClick={()=>void locate()}><LocateFixed size={17}/>{locating?"正在定位…":"以当前位置为门店位置"}</button>
    <button className="gold-button" type="submit" disabled={locked||drawing}><Save size={17}/>{busy?"正在保存…":"保存围栏"}</button>
    {uncertain&&<button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={17}/>刷新围栏核对保存结果</button>}
   </div>
  </form>
 </section>;
}
