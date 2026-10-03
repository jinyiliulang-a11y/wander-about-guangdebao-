import type { MapCoordinate } from "./amap-coordinates";
type XY={x:number;y:number};
export interface PolygonInspection {inside:boolean;distanceMeters:number}
export interface PolygonFenceCheck {reason:"inside"|"outside"|"uncertain";distanceMeters:number}
export class FenceGeometryError extends Error {
 constructor(public readonly code:string,message:string){super(message);this.name="FenceGeometryError";}
}
const EARTH=6371008.8,RAD=Math.PI/180;
function fail(code:string,message:string):never{throw new FenceGeometryError(code,message);}
function vertex(value:unknown):MapCoordinate{
 if(!value||typeof value!=="object"||Array.isArray(value))fail("INVALID_VERTEX","围栏坐标格式不正确");
 const {latitude,longitude}=value as Record<string,unknown>;
 if(typeof latitude!=="number"||typeof longitude!=="number"||!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180)fail("INVALID_COORDINATE","围栏坐标必须是有效经纬度");
 return {latitude,longitude};
}
function projection(vertices:readonly MapCoordinate[]){
 const lat=vertices.reduce((sum,p)=>sum+p.latitude,0)/vertices.length,lng=vertices[0].longitude;
 const xScale=Math.cos(lat*RAD)*EARTH*RAD,yScale=EARTH*RAD;
 return (p:MapCoordinate):XY=>({x:(((p.longitude-lng+180)%360+360)%360-180)*xScale,y:(p.latitude-lat)*yScale});
}
function cross(a:XY,b:XY,c:XY){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function orientation(a:XY,b:XY,c:XY): -1|0|1{
 const v=cross(a,b,c),eps=16*Number.EPSILON*(Math.abs((b.x-a.x)*(c.y-a.y))+Math.abs((b.y-a.y)*(c.x-a.x)));
 return Math.abs(v)<=eps?0:v>0?1:-1;
}
function onSegment(p:XY,a:XY,b:XY){return orientation(a,b,p)===0&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y);}
function touch(a:XY,b:XY,c:XY,d:XY){
 const abC=orientation(a,b,c),abD=orientation(a,b,d),cdA=orientation(c,d,a),cdB=orientation(c,d,b);
 return abC*abD<0&&cdA*cdB<0||abC===0&&onSegment(c,a,b)||abD===0&&onSegment(d,a,b)||cdA===0&&onSegment(a,c,d)||cdB===0&&onSegment(b,c,d);
}
/** WGS84; local plane approximation for store boundaries. Does not enlarge the fence. */
export function normalizePolygon(input:unknown):MapCoordinate[]{
 if(!Array.isArray(input))fail("INVALID_POLYGON","围栏必须是坐标点数组");
 if(input.length<3||input.length>65)fail("VERTEX_COUNT","围栏需要3至64个坐标点");
 const vertices=input.map(vertex);
 if(vertices.length>1&&vertices[0].latitude===vertices[vertices.length-1].latitude&&vertices[0].longitude===vertices[vertices.length-1].longitude)vertices.pop();
 if(vertices.length<3||vertices.length>64)fail("VERTEX_COUNT","围栏需要3至64个坐标点");
 const points=vertices.map(projection(vertices)),n=points.length;let area=0;
 for(let i=0;i<n;i++){
  const a=points[i],b=points[(i+1)%n],before=points[(i+n-1)%n];
  if(a.x===b.x&&a.y===b.y)fail("DUPLICATE_VERTEX","围栏不能有连续重复点");
  area+=a.x*b.y-b.x*a.y;
  if(orientation(before,a,b)===0&&(before.x-a.x)*(b.x-a.x)+(before.y-a.y)*(b.y-a.y)>0)fail("SELF_INTERSECTION","围栏边界不能重叠或自相交");
  for(let j=i+1;j<n;j++){
   if(j===i+1||i===0&&j===n-1)continue;
   if(touch(a,b,points[j],points[(j+1)%n]))fail("SELF_INTERSECTION","围栏边界不能重叠或自相交");
  }
 }
 const scale=Math.max(1,...points.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y))));
 if(Math.abs(area)<=Number.EPSILON*scale*scale*n*32)fail("ZERO_AREA","围栏不能退化为一条线");
 return vertices;
}
export function validatePolygonVertices(input:unknown):MapCoordinate[]|null{try{return normalizePolygon(input);}catch{return null;}}
function segmentDistance(p:XY,a:XY,b:XY){
 const dx=b.x-a.x,dy=b.y-a.y,r=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
 return Math.hypot(p.x-a.x-r*dx,p.y-a.y-r*dy);
}
export function inspectPolygon(location:MapCoordinate,input:readonly MapCoordinate[]):PolygonInspection{
 const vertices=normalizePolygon(input),project=projection(vertices),points=vertices.map(project),p=project(vertex(location));
 let inside=false,boundary=false,distanceMeters=Infinity;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];distanceMeters=Math.min(distanceMeters,segmentDistance(p,a,b));if(onSegment(p,a,b))boundary=true;
 }
 if(boundary){inside=true;distanceMeters=0;}else for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }
 return {inside,distanceMeters};
}
export function checkPolygonGeofence(vertices:readonly MapCoordinate[],location:MapCoordinate&{accuracy:number}):PolygonFenceCheck{
 if(typeof location?.accuracy!=="number"||!Number.isFinite(location.accuracy)||location.accuracy<0)fail("INVALID_ACCURACY","定位精度必须是有效的非负数");
 const r=inspectPolygon(location,vertices);
 return {reason:r.inside?(r.distanceMeters>=location.accuracy?"inside":"uncertain"):(r.distanceMeters>location.accuracy?"outside":"uncertain"),distanceMeters:r.distanceMeters};
}
