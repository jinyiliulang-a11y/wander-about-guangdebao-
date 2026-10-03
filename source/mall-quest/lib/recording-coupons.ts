import { db, staff } from "./game-server";
import { recordingShortcutAllowed, registeredPlayer } from "./account-auth";
import { authorizationValues, playerAuthorizationSQL, staffAuthorizationSQL } from "./account-authorization";
import { GameError } from "./game-error";
import type { Coupon, CouponPreview, RecordingCouponResult, RecordingCouponStatus } from "./game-types";

type Row=Record<string,unknown>;
const EVENT="mall-48h";
const CLOCK="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE=/^GTB-D-[0-9A-F]{20}$/;
const IMAGE="(SELECT image_url FROM stores image_s WHERE image_s.id=c.store_id) AS image_url";
function gate(req:Request){if(!recordingShortcutAllowed(req))throw new GameError("当前地址未启用录制展示券",403);}
function identifier(value:unknown){if(typeof value!=="string"||!UUID.test(value.toLowerCase()))throw new GameError("展示券请求标识不正确");return value.toLowerCase();}
export const isRecordingCouponCode=(value:string)=>value.startsWith("GTB-D-");
export function recordingCoupon(row:Row):Coupon {
  const redeemedAt=row.redeemed_at==null?null:Number(row.redeemed_at),validEnd=Number(row.valid_end);
  return {demo:true,id:String(row.id),taskId:"recording-coupon",taskTitle:"录制展示奖励卡",storeName:String(row.store_name_snapshot),storeId:String(row.store_id),
    reward:String(row.reward_snapshot),conditions:String(row.conditions_snapshot),code:String(row.coupon_code),issuedAt:Number(row.issued_at),redeemedAt,
    artwork:Number(row.artwork),imageURL:String(row.image_url||""),author:"逛道宝演示",validStart:Number(row.issued_at),validEnd,status:redeemedAt!==null?"used":validEnd<=Date.now()?"expired":"unused",
    rewardType:"coupon",rewardValue:0,type:"gift",value:0,minAmount:0};
}
async function exact(req:Request,pid:string,requestId:string){const auth=await authorizationValues(req);return db().prepare(`SELECT c.*,${IMAGE} FROM recording_coupon_requests r JOIN recording_coupons c ON c.id=r.coupon_id
  WHERE r.request_id=? AND r.player_id=? AND c.player_id=r.player_id AND c.event_id=? AND ${playerAuthorizationSQL("c.player_id")}`)
  .bind(requestId,pid,EVENT,...auth).first<Row>();}
export async function recordingCouponStatus(req:Request,input:Row):Promise<RecordingCouponStatus>{
  gate(req);const pid=await registeredPlayer(req),requestId=identifier(input.requestId),row=await exact(req,pid,requestId);gate(req);
  return row?{found:true,requestId,coupon:recordingCoupon(row)}:{found:false,requestId};
}
export async function recordingCouponGrant(req:Request,_input:Row):Promise<RecordingCouponResult>{
  gate(req);await registeredPlayer(req);gate(req);
  throw new GameError("演示领取已改为设备联动：请碰金币 NFC 保存待领申请，再由商家扫描金币设备码、确认收到金币后发放奖励。",410);
}
export async function recordingCouponsForPlayer(req:Request,pid:string):Promise<Coupon[]>{
  if(!recordingShortcutAllowed(req))return [];
  const auth=await authorizationValues(req),rows=await db().prepare(`SELECT c.*,${IMAGE} FROM recording_coupons c WHERE c.player_id=? AND c.event_id=?
    AND ${playerAuthorizationSQL("c.player_id")} ORDER BY c.issued_at DESC,c.id`).bind(pid,EVENT,...auth).all<Row>();
  return recordingShortcutAllowed(req)?rows.results.map(recordingCoupon):[];
}
export async function recordingCouponsForMerchant(req:Request):Promise<Coupon[]>{
  if(!recordingShortcutAllowed(req))return [];
  const scope=await staff(req);if(scope.role!=="merchant")return [];
  const auth=await authorizationValues(req,true),rows=await db().prepare(`SELECT c.*,${IMAGE} FROM recording_coupons c WHERE c.store_id=? AND c.event_id=?
    AND ${staffAuthorizationSQL("c.store_id")} ORDER BY c.issued_at DESC,c.id`).bind(scope.store_id,EVENT,...auth).all<Row>();
  return recordingShortcutAllowed(req)?rows.results.map(recordingCoupon):[];
}
async function merchant(req:Request,code:string){
  gate(req);if(!CODE.test(code))throw new GameError("展示券核销码不正确");const scope=await staff(req);
  if(scope.role!=="merchant")throw new GameError("请使用对应门店的商家账号核销展示券",403);
  return scope;
}
export async function recordingCouponPreview(req:Request,code:string):Promise<CouponPreview>{
  const scope=await merchant(req,code),auth=await authorizationValues(req,true);
  const row=await db().prepare(`SELECT c.*,${IMAGE},s.status AS store_status FROM recording_coupons c JOIN stores s ON s.id=c.store_id
    WHERE c.coupon_code=? AND c.store_id=? AND c.event_id=? AND ${staffAuthorizationSQL("c.store_id")}`).bind(code,scope.store_id,EVENT,...auth).first<Row>();gate(req);
  if(!row)throw new GameError("展示券不存在，或不属于当前门店");const current=recordingCoupon(row),canRedeem=current.status==="unused"&&row.store_status==="active";
  return {coupon:current,canRedeem,message:current.status==="used"?"这张展示券已经核销":current.status==="expired"?"这张展示券已过期":row.store_status!=="active"?"演示门店已下线":"展示券有效，确认后完成演示核销"};
}
export async function recordingCouponRedeem(req:Request,code:string):Promise<{message:string}>{
  const scope=await merchant(req,code),auth=await authorizationValues(req,true);gate(req);
  const result=await db().prepare(`UPDATE recording_coupons SET redeemed_at=${CLOCK} WHERE coupon_code=? AND store_id=? AND event_id=?
    AND redeemed_at IS NULL AND issued_at<=${CLOCK} AND valid_end>${CLOCK} AND ?=1
    AND EXISTS(SELECT 1 FROM stores s WHERE s.id=recording_coupons.store_id AND s.event_id=recording_coupons.event_id AND s.status='active')
    AND ${staffAuthorizationSQL("recording_coupons.store_id")}`).bind(code,scope.store_id,EVENT,recordingShortcutAllowed(req)?1:0,...auth).run();gate(req);
  if(!result.meta.changes){const preview=await recordingCouponPreview(req,code);throw new GameError(preview.canRedeem?"核销权限已变化，请刷新核对":preview.message);}
  return {message:"展示券核销成功，玩家卡包状态已更新；不计正常活动数据"};
}
