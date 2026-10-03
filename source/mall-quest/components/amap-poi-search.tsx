"use client";
import {useCallback,useEffect,useId,useRef,useState} from "react";
import {LoaderCircle,MapPin,Search} from "lucide-react";
import {gcj02ToWgs84,type MapCoordinate} from "@/lib/amap-coordinates";
import type {AmapAutoComplete,AmapPlaceSearch,AmapPoi,AmapPoiResult} from "@/lib/amap-sdk";
import {createAmapPoiServices} from "@/lib/amap-poi-service";
import {validCoordinates} from "@/lib/geofence";
import "./amap-extensions.css";
export type AmapPoiSelection={id?:string;name:string;address:string;latitude:number;longitude:number};
export type AmapPoiSearchProps={query?:string;onQueryChange?:(value:string)=>void;onSelect:(selection:AmapPoiSelection)=>void;locked?:boolean;disabled?:boolean;label?:string;placeholder?:string;required?:boolean;className?:string};
type Services={autocomplete:AmapAutoComplete;placeSearch:AmapPlaceSearch};
function text(value:unknown):string{
 if(typeof value==="string")return value.trim();
 if(Array.isArray(value))return value.filter(v=>typeof v==="string").join("").trim();return "";
}
function addressOf(poi:AmapPoi){
 const parts=[text(poi.pname),text(poi.cityname),text(poi.adname)||text(poi.district),text(poi.address)];let address="";
 for(const part of parts){if(!part||address.includes(part))continue;if(part.startsWith(address))address=part;else address+=part;}
 return address.slice(0,200);
}
function locationOf(poi:AmapPoi):MapCoordinate|null{
 const loc=poi.location;let lng:unknown,lat:unknown;
 if(typeof loc==="string"){const parts=loc.split(",");if(parts.length!==2||!parts[0].trim()||!parts[1].trim())return null;lng=Number(parts[0]);lat=Number(parts[1]);}
 else if(loc&&typeof loc==="object"){
  const p=loc as {lng?:unknown;lat?:unknown;getLng?:()=>number;getLat?:()=>number};
  lng=typeof p.getLng==="function"?p.getLng():p.lng;lat=typeof p.getLat==="function"?p.getLat():p.lat;
 }
 if(typeof lng!=="number"||typeof lat!=="number"||!validCoordinates(lat,lng)||lng===0&&lat===0)return null;
 const p=gcj02ToWgs84({longitude:lng,latitude:lat});return validCoordinates(p.latitude,p.longitude)?p:null;
}
function object(result:AmapPoiResult|string){return typeof result==="object"&&result!==null?result:null;}
export function AmapPoiSearch(props:AmapPoiSearchProps){
 const {query,onQueryChange,onSelect,locked=false,disabled=false,label="门店名称",placeholder="输入门店名称，搜索真实门店",required=false,className=""}=props;
 const [localQuery,setLocalQuery]=useState(""),value=query===undefined?localQuery:query,blocked=locked||disabled,id=useId();
 const [tips,setTips]=useState<AmapPoi[]>([]),[open,setOpen]=useState(false),[focused,setFocused]=useState(false),[active,setActive]=useState(-1);
 const [searching,setSearching]=useState(false),[choosing,setChoosing]=useState(false),[message,setMessage]=useState(""),[failure,setFailure]=useState(false),[retry,setRetry]=useState(0);
 const alive=useRef(false),latest=useRef({blocked,onSelect,onQueryChange,controlled:query!==undefined});
 const searchSequence=useRef(0),choiceSequence=useRef(0),selectedName=useRef(""),observedQuery=useRef(value);
 const services=useRef<Services|null>(null),serviceRequest=useRef<Promise<Services>|null>(null),cancelDetails=useRef<(()=>void)|null>(null);
 useEffect(()=>{latest.current={blocked,onSelect,onQueryChange,controlled:query!==undefined};});
 useEffect(()=>{alive.current=true;return()=>{
  alive.current=false;searchSequence.current++;choiceSequence.current++;cancelDetails.current?.();
  services.current?.autocomplete.destroy?.();services.current?.placeSearch.clear?.();services.current?.placeSearch.destroy?.();services.current=null;
 };},[]);
 useEffect(()=>{if(!blocked)return;searchSequence.current++;choiceSequence.current++;cancelDetails.current?.();setOpen(false);setSearching(false);setChoosing(false);},[blocked]);
 useEffect(()=>{
  if(observedQuery.current===value)return;observedQuery.current=value;if(value===selectedName.current)return;
  choiceSequence.current++;cancelDetails.current?.();selectedName.current="";setChoosing(false);
 },[value]);
 const getServices=useCallback(():Promise<Services>=>{
  if(services.current)return Promise.resolve(services.current);if(serviceRequest.current)return serviceRequest.current;
  let request:Promise<Services>;
  request=Promise.resolve().then(()=>{
   if(!alive.current)throw new Error("门店搜索已关闭。");
   const created=createAmapPoiServices();services.current=created;return created;
  }).finally(()=>{if(serviceRequest.current===request)serviceRequest.current=null;});serviceRequest.current=request;return request;
 },[]);
 useEffect(()=>{
  const sequence=++searchSequence.current;let cancelled=false,requestTimer=0;
  setSearching(false);setTips([]);setActive(-1);setOpen(false);
  const term=value.trim();if(blocked||!focused||term.length<2||term===selectedName.current)return;
  setMessage("");setFailure(false);
  const current=()=>!cancelled&&alive.current&&!latest.current.blocked&&searchSequence.current===sequence;
  const timer=window.setTimeout(()=>{
   setSearching(true);void getServices().then(service=>{
    if(!current())return;let settled=false;
    requestTimer=window.setTimeout(()=>{if(settled||!current())return;settled=true;setSearching(false);setFailure(true);setMessage("门店搜索超时，可重试或手动填写。");},8000);
    service.autocomplete.search(term,(status,result)=>{
     if(settled||!current())return;settled=true;window.clearTimeout(requestTimer);setSearching(false);
     const items=object(result)?.tips,suggestions=status==="complete"&&Array.isArray(items)?items.filter(p=>text(p.name)).slice(0,8):[];
     setTips(suggestions);setOpen(suggestions.length>0);setActive(-1);
     if(suggestions.length){setFailure(false);setMessage("请选择所在门店，地址和位置会自动填写。");}
     else if(status==="no_data"||status==="complete"&&Array.isArray(items)){setFailure(false);setMessage("没有找到门店，可换个名称，或手动填写地址并在地图选点。");}
     else{const info=object(result)?.info;setFailure(true);setMessage((typeof info==="string"?info.trim().slice(0,300):"")||"门店搜索暂不可用，可重试或手动填写。");}
    });
   }).catch(cause=>{if(!current())return;window.clearTimeout(requestTimer);setSearching(false);setFailure(true);setMessage(cause instanceof Error?cause.message:"门店搜索暂不可用，可手动填写。");});
  },300);
  return ()=>{cancelled=true;window.clearTimeout(timer);window.clearTimeout(requestTimer);};
 },[value,blocked,focused,retry,getServices]);
 const writeQuery=(next:string)=>{if(!latest.current.controlled)setLocalQuery(next);latest.current.onQueryChange?.(next);};
 const changeQuery=(next:string)=>{searchSequence.current++;choiceSequence.current++;cancelDetails.current?.();selectedName.current="";setChoosing(false);setSearching(false);setOpen(false);setMessage("");setFailure(false);writeQuery(next);};
 const detailsFor=(service:AmapPlaceSearch,poiId:string):Promise<AmapPoi|null>=>new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(result:AmapPoi|null,error?:Error)=>{
   if(settled)return;settled=true;window.clearTimeout(timer);if(cancelDetails.current===cancel)cancelDetails.current=null;if(error)reject(error);else resolve(result);
  };
  const cancel=()=>finish(null,new Error("门店选择已取消。")),timer=window.setTimeout(()=>finish(null,new Error("门店详情加载超时。")),8000);cancelDetails.current=cancel;
  try{service.getDetails(poiId,(status,result)=>{const pois=object(result)?.poiList?.pois;finish(status==="complete"&&Array.isArray(pois)?pois[0]||null:null);});}
  catch(cause){finish(null,cause instanceof Error?cause:new Error("门店详情暂不可用。"));}
 });
 const choose=async(tip:AmapPoi)=>{
  if(latest.current.blocked)return;const sequence=++choiceSequence.current;searchSequence.current++;cancelDetails.current?.();
  setSearching(false);setChoosing(true);setOpen(false);setMessage("");setFailure(false);
  const current=()=>alive.current&&!latest.current.blocked&&choiceSequence.current===sequence;
  try{
   let poi=tip,warning=false;
   if(text(tip.id))try{
    const service=await getServices();if(!current())return;const detail=await detailsFor(service.placeSearch,text(tip.id));if(!current())return;
    if(detail&&locationOf(detail))poi={...tip,...detail};else warning=true;
   }catch(cause){if(!current())return;if(!locationOf(tip))throw cause;warning=true;}
   const point=locationOf(poi),name=text(poi.name)||text(tip.name);
   if(!point||!name)throw new Error("这条结果没有可用位置，请换一条结果或手动地图选点。");
   if(!current())return;const address=addressOf(poi)||addressOf(tip);selectedName.current=name.slice(0,60);writeQuery(selectedName.current);
   latest.current.onSelect({id:text(poi.id)||undefined,name:selectedName.current,address,latitude:point.latitude,longitude:point.longitude});
   setTips([]);setActive(-1);setFailure(false);setMessage(!address?"已定位门店，请补全地址。":warning?"已使用搜索结果定位，请核对地址和地图位置。":"已填写门店名称、地址和位置，请核对楼层与门店范围。");
  }catch(cause){if(current()){setFailure(true);setMessage(cause instanceof Error?cause.message:"门店详情暂不可用，请手动选点。");}}
  finally{if(current())setChoosing(false);}
 };
 return <div className={"amap-poi-search "+className} onBlur={e=>{if(e.relatedTarget instanceof Node&&e.currentTarget.contains(e.relatedTarget))return;setFocused(false);setOpen(false);}}>
  <label className="amap-poi-label" htmlFor={id+"-input"}>{label}{required&&<span aria-hidden="true"> *</span>}</label>
  <div className="amap-poi-input-wrap">
   <Search className="amap-poi-input-icon" size={18} aria-hidden="true"/>
   <input id={id+"-input"} className="ui-input amap-poi-input" value={value} maxLength={60} disabled={blocked} required={required} placeholder={placeholder} autoComplete="off"
    role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id+"-results"} aria-describedby={id+"-hint"+(message||searching||choosing?" "+id+"-status":"")}
    aria-activedescendant={open&&active>=0?id+"-option-"+active:undefined} onFocus={()=>setFocused(true)} onChange={e=>changeQuery(e.target.value)}
    onKeyDown={e=>{
     if(e.key==="Enter"){e.preventDefault();if(open&&active>=0&&tips[active])void choose(tips[active]);}
     else if(e.key==="ArrowDown"&&tips.length){e.preventDefault();setOpen(true);setActive(i=>(i+1)%tips.length);}
     else if(e.key==="ArrowUp"&&tips.length){e.preventDefault();setOpen(true);setActive(i=>i<=0?tips.length-1:i-1);}
     else if(e.key==="Escape"){e.preventDefault();searchSequence.current++;choiceSequence.current++;cancelDetails.current?.();setOpen(false);setChoosing(false);setSearching(false);}
    }}/>
   {(searching||choosing)&&<LoaderCircle className="amap-poi-spinner" size={18} aria-hidden="true"/>}
   {open&&!blocked&&<ul id={id+"-results"} className="amap-poi-results" role="listbox" aria-label="匹配的门店">{tips.map((tip,i)=><li key={(tip.id||tip.name||"poi")+":"+i} role="presentation">
    <button id={id+"-option-"+i} type="button" className={"amap-poi-option"+(active===i?" is-active":"")} role="option" aria-selected={active===i} tabIndex={-1}
     onPointerDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>void choose(tip)}>
     <MapPin size={18} aria-hidden="true"/><span><strong>{text(tip.name)}</strong><small>{addressOf(tip)||"选择后查询详细位置"}</small></span>
    </button></li>)}</ul>}
  </div>
  <p id={id+"-hint"} className="amap-poi-hint">输入名称并选择门店，自动填写地址和位置；也可手动填写。</p>
  {(message||searching||choosing)&&<p id={id+"-status"} className={"amap-poi-status"+(failure?" is-error":"")} role="status" aria-live="polite">{choosing?"正在确认门店位置…":searching?"正在搜索门店…":message}</p>}
  {failure&&!blocked&&!choosing&&<button className="amap-poi-retry" type="button" onClick={()=>{selectedName.current="";setFocused(true);setRetry(v=>v+1);}}>重新搜索</button>}
 </div>;
}
