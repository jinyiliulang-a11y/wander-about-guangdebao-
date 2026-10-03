/** Device handling is independent of personal coupon issuance/redemption. */
export type MerchantDeviceCapabilityState = "reserved" | "available";
export type MerchantDeviceCapabilities = {
  apiVersion: 1;
  storeId: string;
  deviceVerification: MerchantDeviceCapabilityState;
  returnRegistration: MerchantDeviceCapabilityState;
  operationStatus: MerchantDeviceCapabilityState;
  fixedDeviceCode: "available";
  pendingClaimIssuance: "available";
  offlineCryptographicProof: "reserved";
};

/** Future adapters determine the proof format; the reservation does not interpret it. */
export type MerchantDeviceProof = unknown;
export type MerchantDeviceOperationInput = {
  deviceId: string;
  /** UUID identifying the original round; not allocated by the reserved API. */
  roundId: string;
  /** UUID identifying this exact operation, retained for result recovery. */
  requestId: string;
  proof: MerchantDeviceProof;
};
export type MerchantDeviceOperationStatusInput = { requestId: string };
/** Only an implemented, successful future adapter may construct this result. */
export type MerchantDeviceConfirmedOperation = {
  state: "confirmed";
  operation: "verify" | "return";
  deviceId: string;
  roundId: string;
  requestId: string;
  message: string;
};
export type MerchantDeviceOperationStatus = {
  found: boolean;
  requestId: string;
  result?: MerchantDeviceConfirmedOperation;
};
export type MerchantDeviceErrorCode =
  | "MERCHANT_DEVICE_FORBIDDEN"
  | "MERCHANT_DEVICE_INVALID_REQUEST"
  | "MERCHANT_DEVICE_NOT_FOUND"
  | "MERCHANT_DEVICE_NOT_CONFIGURED";
