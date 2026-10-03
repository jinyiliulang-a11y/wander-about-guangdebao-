import {apiRequest} from "@/lib/game-api";
export type AmapLngLat={getLng():number;getLat():number};
export type AmapEvent={lnglat?:AmapLngLat;originalEvent?:Event};
export type AmapOverlay={setMap?:(map:AmapMap|null)=>void};
export type AmapMap={
 add(items:AmapOverlay|AmapOverlay[]):void;remove(items:AmapOverlay|AmapOverlay[]):void;
 on(event:string,handler:(event:AmapEvent)=>void):void;off(event:string,handler:(event:AmapEvent)=>void):void;
 destroy():void;setCenter(center:[number,number],immediately?:boolean):void;
 setZoomAndCenter(zoom:number,center:[number,number],immediately?:boolean):void;
 setFitView(items:AmapOverlay[],immediately:boolean,padding:number[],maxZoom:number):void;
 setMapStyle(style:string):void;resize?:()=>void;
};
export type AmapPoi={id?:string;name?:string;address?:string|string[];district?:string;pname?:string;cityname?:string|string[];adname?:string;location?:unknown};
export type AmapPoiResult={tips?:AmapPoi[];poiList?:{pois?:AmapPoi[]};info?:string};
export type AmapPoiCallback=(status:string,result:AmapPoiResult|string)=>void;
export type AmapAutoComplete={search(query:string,callback:AmapPoiCallback):void;destroy?:()=>void};
export type AmapPlaceSearch={getDetails(id:string,callback:AmapPoiCallback):void;clear?:()=>void;destroy?:()=>void};
export type AmapSdk={
 Map:new(element:HTMLElement,options:Record<string,unknown>)=>AmapMap;
 Marker:new(options:Record<string,unknown>)=>AmapOverlay;
 Circle:new(options:Record<string,unknown>)=>AmapOverlay;
 Polygon:new(options:Record<string,unknown>)=>AmapOverlay;
 Polyline:new(options:Record<string,unknown>)=>AmapOverlay;
 plugin(names:string[],ready:()=>void):void;
 AutoComplete?:new(options:Record<string,unknown>)=>AmapAutoComplete;
 Autocomplete?:new(options:Record<string,unknown>)=>AmapAutoComplete;
 PlaceSearch?:new(options:Record<string,unknown>)=>AmapPlaceSearch;
};
type AmapWindow=Window&{AMap?:AmapSdk;_AMapSecurityConfig?:{serviceHost:string}};
let sdkPromise:Promise<AmapSdk>|undefined;const pluginPromises=new Map<string,Promise<void>>();
export function loadAmapSdk():Promise<AmapSdk>{
 if(typeof window==="undefined")return Promise.reject(new Error("地图只能在浏览器中加载。"));
 if(sdkPromise)return sdkPromise;
 sdkPromise=(async()=>{
  const config=await apiRequest<{available:boolean;key?:string;servicePath?:string}>("/api/maps/config",{},{readOnly:true});
  if(!config.available||!config.key||config.servicePath!=="/api/maps/service")throw new Error("真实地图暂不可用，可稍后重试或手动填写门店位置。");
  const target=window as AmapWindow;
  target._AMapSecurityConfig={serviceHost:window.location.origin+config.servicePath};
  if(target.AMap?.Map)return target.AMap;
  return new Promise<AmapSdk>((resolve,reject)=>{
   const script=document.createElement("script"),url=new URL("https://webapi.amap.com/maps");
   url.searchParams.set("v","2.0");url.searchParams.set("key",config.key!);let finished=false;
   const fail=(message:string)=>{if(finished)return;finished=true;window.clearTimeout(timer);script.onload=null;script.onerror=null;script.remove();reject(new Error(message));};
   const timer=window.setTimeout(()=>fail("地图加载超时，请检查网络后重试。"),12000);
   script.async=true;script.src=url.href;script.dataset.questAmap="true";
   script.onload=()=>{
    if(!target.AMap?.Map)return fail("地图未能加载，请稍后重试。");
    if(finished)return;finished=true;window.clearTimeout(timer);script.onload=null;script.onerror=null;resolve(target.AMap);
   };
   script.onerror=()=>fail("地图暂时无法连接，请稍后重试。");document.head.appendChild(script);
  });
 })().catch(error=>{sdkPromise=undefined;throw error;});return sdkPromise;
}
export async function loadAmapPlugins(names:string[]):Promise<AmapSdk>{
 const sdk=await loadAmapSdk();
 await Promise.all([...new Set(names)].map(name=>{
  const field=name.replace(/^AMap\./,""),constructors=sdk as unknown as Record<string,unknown>;
  if(typeof constructors[field]==="function"||field==="AutoComplete"&&typeof sdk.Autocomplete==="function")return Promise.resolve();
  const cached=pluginPromises.get(name);if(cached)return cached;
  const request=new Promise<void>((resolve,reject)=>{
   let done=false;const timer=window.setTimeout(()=>{done=true;reject(new Error("门店搜索组件加载超时，请稍后重试。"));},12000);
   try{sdk.plugin([name],()=>{
    if(done)return;done=true;window.clearTimeout(timer);
    if(typeof constructors[field]==="function"||field==="AutoComplete"&&typeof sdk.Autocomplete==="function")resolve();
    else reject(new Error("门店搜索组件暂不可用。"));
   });}catch{done=true;window.clearTimeout(timer);reject(new Error("门店搜索组件暂不可用。"));}
  });
  const tracked:Promise<void>=request.catch(error=>{if(pluginPromises.get(name)===tracked)pluginPromises.delete(name);throw error;});
  pluginPromises.set(name,tracked);return tracked;
 }));return sdk;
}
