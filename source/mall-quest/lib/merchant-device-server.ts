import { db, session } from "./game-server";
import { authorizationValues, staffAuthorizationSQL } from "./account-authorization";
import { GameError } from "./game-error";
import type { MerchantDeviceCapabilities, MerchantDeviceErrorCode } from "./merchant-device-types";

type Input = Record<string, unknown>;
const EVENT = "mall-48h";
export class MerchantDeviceError extends GameError {
  constructor(message: string, status: number, public readonly code: MerchantDeviceErrorCode) { super(message, status); }
}

/** Registry permission checks only: neither a device proof nor a physical return. */
async function merchantStore(req: Request, input: Input): Promise<string> {
  const scope = await session(req, true);
  if (!scope || scope.role !== "merchant" || !scope.store_id || !scope.account_id || !scope.player_id)
    throw new MerchantDeviceError("请使用已通过审核的本店商家账号", 403, "MERCHANT_DEVICE_FORBIDDEN");
  if (input.storeId !== undefined && input.storeId !== scope.store_id)
    throw new MerchantDeviceError("不能操作其他门店的设备接口", 403, "MERCHANT_DEVICE_FORBIDDEN");
  const auth = await authorizationValues(req, true);
  // The generic workbench guard also permits operators. Pin this merchant's
  // session/account/player so a changed role cannot broaden these interfaces.
  const merchant = `EXISTS(SELECT 1 FROM sessions md_s WHERE md_s.token_hash=? AND md_s.role='merchant'
    AND md_s.account_id=? AND md_s.player_id=? AND md_s.store_id=s.id)`;
  const store = await db().prepare(`SELECT s.id FROM stores s WHERE s.id=? AND s.event_id=?
    AND ${staffAuthorizationSQL("s.id")} AND ${merchant}`)
    .bind(scope.store_id, EVENT, ...auth, auth[0], scope.account_id, scope.player_id).first<{ id: string }>();
  if (!store) throw new MerchantDeviceError("当前商家门店权限已变化，请重新登录核对", 403, "MERCHANT_DEVICE_FORBIDDEN");
  if (input.deviceId !== undefined) {
    if (typeof input.deviceId !== "string" || !input.deviceId || input.deviceId.length > 100)
      throw new MerchantDeviceError("设备标识格式不正确", 400, "MERCHANT_DEVICE_INVALID_REQUEST");
    const device = await db().prepare(`SELECT h.id FROM hardware_devices h JOIN stores s ON s.id=h.store_id
      WHERE h.id=? AND s.id=? AND s.event_id=? AND ${staffAuthorizationSQL("s.id")} AND ${merchant}`)
      .bind(input.deviceId, store.id, EVENT, ...auth, auth[0], scope.account_id, scope.player_id).first();
    if (!device) throw new MerchantDeviceError("设备未登记或不属于当前门店", 404, "MERCHANT_DEVICE_NOT_FOUND");
  }
  return store.id;
}

export async function merchantDeviceCapabilities(req: Request, input: Input): Promise<MerchantDeviceCapabilities> {
  const storeId = await merchantStore(req, input);
  return { apiVersion: 1, storeId, deviceVerification: "reserved", returnRegistration: "reserved", operationStatus: "reserved",
    fixedDeviceCode: "available", pendingClaimIssuance: "available", offlineCryptographicProof: "reserved" };
}
async function unavailable(req: Request, input: Input): Promise<never> {
  await merchantStore(req, input);
  // Do not parse a proof, reserve a round, claim a coupon, or save a return.
  throw new MerchantDeviceError("设备核验与回收接口已预留，接入方案尚未配置；本次未执行操作", 409, "MERCHANT_DEVICE_NOT_CONFIGURED");
}
export const merchantDeviceVerify = unavailable;
export const merchantDeviceReturn = unavailable;
export const merchantDeviceOperationStatus = unavailable;

export async function merchantDeviceAction(req: Request, input: Input): Promise<MerchantDeviceCapabilities | null> {
  switch (input.action) {
    case "merchantDeviceCapabilities": return merchantDeviceCapabilities(req, input);
    case "merchantDeviceVerify": return merchantDeviceVerify(req, input);
    case "merchantDeviceReturn": return merchantDeviceReturn(req, input);
    case "merchantDeviceOperationStatus": return merchantDeviceOperationStatus(req, input);
    default: return null;
  }
}
