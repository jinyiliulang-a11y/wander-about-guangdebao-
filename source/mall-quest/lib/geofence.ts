import type { MapCoordinate } from "./amap-coordinates";
import {checkPolygonGeofence,validatePolygonVertices} from "./polygon-geofence";
/** Browser positions and persisted centers use WGS84. Floor-plan x/y are unrelated. */
export type GeoLocation={latitude:number;longitude:number;accuracy:number;timestamp:number};
export type StoreGeofence={
 storeId:string;storeName:string;enabled:boolean;latitude:number|null;longitude:number|null;radiusMeters:number|null;
 revision:number;updatedAt:number|null;coordinateSystem:"WGS84";shapeType?:"circle"|"polygon";polygonVertices?:MapCoordinate[]|null;
};
export type GeofenceState={fences:StoreGeofence[]};
export type GeofenceReason="not-configured"|"disabled"|"invalid-config"|"location-required"|"invalid-location"|"stale-location"|"inside"|"outside"|"uncertain"|"service-unavailable"|"config-changed";
export type GeofenceCheck={reason:GeofenceReason;inside:boolean;distanceMeters:number|null;accuracyMeters:number|null};
export const GEOFENCE_MIN_RADIUS=20,GEOFENCE_MAX_RADIUS=5000,GEOFENCE_POSITION_MAX_AGE_MS=30_000,GEOFENCE_POSITION_FUTURE_TOLERANCE_MS=5_000;
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
export const validCoordinates=(lat:unknown,lng:unknown)=>finite(lat)&&lat>=-90&&lat<=90&&finite(lng)&&lng>=-180&&lng<=180;
export const validRadius=(v:unknown):v is number=>finite(v)&&v>=GEOFENCE_MIN_RADIUS&&v<=GEOFENCE_MAX_RADIUS;
export const validGeoLocation=(value:unknown):value is GeoLocation=>{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const p=value as Record<string,unknown>;return validCoordinates(p.latitude,p.longitude)&&finite(p.accuracy)&&p.accuracy>=0&&finite(p.timestamp)&&p.timestamp>0;
};
export function distanceMeters(a:Pick<GeoLocation,"latitude"|"longitude">,b:Pick<GeoLocation,"latitude"|"longitude">){
 const rad=(d:number)=>d*Math.PI/180,sinLat=Math.sin(rad(b.latitude-a.latitude)/2),sinLng=Math.sin(rad(b.longitude-a.longitude)/2);
 const h=sinLat*sinLat+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*sinLng*sinLng;
 return 6_371_008.8*2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,h))),Math.sqrt(Math.max(0,1-h)));
}
/** Geometry only; enabled/revision are checked separately. Polygon radius is a compatibility envelope. */
export function validFenceGeometry(fence:{latitude:unknown;longitude:unknown;radiusMeters?:unknown;shapeType?:unknown;polygonVertices?:unknown}|null|undefined):boolean{
 if(!fence||!validCoordinates(fence.latitude,fence.longitude))return false;
 const shape=fence.shapeType??"circle";
 if(shape==="circle")return validRadius(fence.radiusMeters);
 if(shape!=="polygon")return false;
 const vertices=validatePolygonVertices(fence.polygonVertices);if(!vertices)return false;
 const anchor={latitude:fence.latitude as number,longitude:fence.longitude as number};
 return vertices.every(v=>distanceMeters(anchor,v)<=GEOFENCE_MAX_RADIUS);
}
/** The entire reported accuracy disk must fit. Boundary overlap never passes. */
export function checkGeofence(fence:StoreGeofence|null|undefined,location:unknown,now=Date.now()):GeofenceCheck{
 const result=(reason:GeofenceReason,distance:number|null=null,accuracy:number|null=null):GeofenceCheck=>({reason,inside:reason==="inside",distanceMeters:distance,accuracyMeters:accuracy});
 if(!fence||fence.revision===0)return result("not-configured");
 if(!fence.enabled)return result("disabled");
 if(!Number.isSafeInteger(fence.revision)||fence.revision<1||fence.coordinateSystem!=="WGS84"||!validFenceGeometry(fence))return result("invalid-config");
 if(location==null)return result("location-required");
 if(!validGeoLocation(location))return result("invalid-location");
 if(!finite(now)||now-location.timestamp>GEOFENCE_POSITION_MAX_AGE_MS||location.timestamp-now>GEOFENCE_POSITION_FUTURE_TOLERANCE_MS)return result("stale-location");
 const distance=distanceMeters({latitude:fence.latitude!,longitude:fence.longitude!},location);
 if(fence.shapeType==="polygon"){
  try{const r=checkPolygonGeofence(fence.polygonVertices!,location);return result(r.reason,distance,location.accuracy);}catch{return result("invalid-config");}
 }
 return result(distance+location.accuracy<=fence.radiusMeters!?"inside":distance-location.accuracy>fence.radiusMeters!?"outside":"uncertain",distance,location.accuracy);
}
export const geofenceMessage=(reason:GeofenceReason):string=>({
 "not-configured":"门店尚未设置到店范围，暂不能确认金币或领奖，请联系商家设置真实位置",
 disabled:"门店已暂停到店验证，暂不能确认金币或领奖",
 "invalid-config":"门店到店范围设置有误，暂不能确认金币或领奖，请联系商家",
 "location-required":"请先允许定位，到达门店范围后再确认金币或领奖",
 "invalid-location":"定位信息不完整或不正确，请重新定位后再试",
 "stale-location":"定位已过期，请重新定位后再确认金币或领奖",
 inside:"已到达门店范围。",
 outside:"你还未到达门店范围，请进入范围后再确认金币或领奖",
 uncertain:"定位精度不足，无法确认是否在围栏内，请靠近门店并重新定位",
 "service-unavailable":"门店范围暂时无法读取，请稍后重试或联系商家。",
 "config-changed":"门店围栏已更新，请重新定位并确认范围后再领奖",
})[reason];
