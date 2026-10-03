/** Player accounts work in both seeker/explorer modes; merchant and admin namespaces are independent. */
export type AccountRole = "player" | "merchant" | "admin";
export type AccountStatus = "pending" | "approved" | "rejected";
export type RegistrationCoupon = {
  /** Registration discounts: 8.8 means 8.8折; persisted templates use 88. Cash is yuan, gifts are zero. */
  title: string; type: "cash" | "discount" | "gift"; value: number; minAmount: number;
  totalCount: number; conditions: string; validStart: number | null; validEnd: number | null;
};
export type MerchantRegistration = {
  name: string; address: string; floor: string; area: string; category: string; phone: string;
  latitude: number; longitude: number; radiusMeters: number; coupon: RegistrationCoupon;
};
export type AccountApplication = {
  id: string; requestId: string | null; username: string; role: AccountRole; nickname: string;
  phoneMasked: string | null; status: AccountStatus; reviewNote: string; revision: number;
  storeId: string | null; merchant: MerchantRegistration | null; createdAt: number; updatedAt: number;
};
export type AccountRegistrationResult = {
  registered: true; status: AccountStatus; username: string; message: string; replayed?: true;
};
export type AccountLoginResult = {
  authenticated: true; accountId: string; username: string; role: AccountRole; storeId: string | null;
  message: string; setCookie: string[];
};
export type AccountApplicationsResult = {
  applications: AccountApplication[];
  pagination: { page: number; pageSize: 20; total: number; totalPages: number };
};
export type AccountStatusResult = { application: AccountApplication; message: string };
export type EmailPurpose="login"|"register"|"bind";
export type EmailCodeResult={challengeId:string;expiresAt:number;retryAfter:60;message:string};
export type AccountEmailBindResult={bound:true;role:AccountRole;email:string;message:string};
