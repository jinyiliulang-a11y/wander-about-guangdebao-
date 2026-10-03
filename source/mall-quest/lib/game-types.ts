export type Page =
  | "entry"
  | "login"
  | "map"
  | "wallet"
  | "create"
  | "placements"
  | "profile"
  | "footprint"
  | "achievements"
  | "help"
  | "settings"
  | "geofence"
  | "merchant"
  | "staff";
export type Role = "hunter" | "explorer";
export type Task = {
  id: string;
  storeId: string;
  pointMode: "static" | "hardware";
  requiresNfcClaim?: boolean;
  title: string;
  authorId: string;
  author: string;
  floor: string;
  area: string;
  x: number;
  y: number;
  clues: string[];
  question: string;
  reward: string;
  conditions: string;
  remaining: number;
  status: string;
  isFeatured: boolean;
  own: boolean;
  claimed: boolean;
  claimedCount?: number;
  reviewNote?: string;
  storeName?: string;
  createdAt?: number;
  difficulty?: number;
  expiresAt?: number | null;
  rewardType?: "points" | "coupon";
  rewardValue?: number;
  rewardCouponId?: string | null;
  clueCosts?: number[];
  unlockedClues?: boolean[];
  photoURLs?: string[];
};
export type Store = {
  id: string;
  pointMode: "static" | "hardware";
  name: string;
  floor: string;
  area: string;
  category: string;
  reward: string;
  conditions: string;
  artwork: number;
  imageURL?: string;
  imageRevision?: number;
  stockTotal: number;
  logo?: string;
  address?: string;
  phone?: string;
  status?: "active" | "inactive";
  rating?: number | null;
};
export type Coupon = {
  demo?: boolean;
  id: string;
  taskId: string;
  taskTitle: string;
  storeName: string;
  storeId: string;
  reward: string;
  conditions: string;
  code: string;
  issuedAt: number;
  redeemedAt: number | null;
  artwork: number;
  imageURL?: string;
  author: string;
  validStart?: number | null;
  validEnd?: number | null;
  status?: "unused" | "used" | "expired" | "upcoming";
  rewardType?: "points" | "coupon";
  rewardValue?: number;
  type?: "discount" | "cash" | "gift";
  value?: number;
  minAmount?: number;
};
export type CouponPreview = { coupon: Coupon; canRedeem: boolean; message: string };
export type CoinCheckIn = {
  taskId: string; storeId: string; storeName: string; method: "link" | "dynamic"; expiresAt?: number;
};
export type { NfcDraft, NfcDraftPage, NfcDraftResult, NfcDraftOperationStatus, MerchantClaimDevice, MerchantPendingClaims, MerchantIssueClaimResult } from "./nfc-draft-types";
export type NfcClaimResult = { draft: import("./nfc-draft-types").NfcDraft; newlyCreated: boolean; requestId: string; message: string };
export type NfcClaimStatus = { found: boolean; requestId: string; draft?: import("./nfc-draft-types").NfcDraft; coupon?: Coupon };
export type RecordingCouponResult = { coupon: Coupon; newlyIssued: boolean; requestId: string; message: string };
export type RecordingCouponStatus = { found: boolean; requestId: string; coupon?: Coupon };
export type HardwareEntry = {
  deviceId: string; storeId: string; taskId: string; entryUrl: string; expiresAt: number; ttlSeconds: number;
};
export type GameState = {
  recordingShortcutAllowed?: boolean;
  recordingCouponAllowed?: boolean;
  player: { id: string; nickname: string; accountId?: string; username?: string; accountRole?: "player" | "merchant" | "admin"; accountAuthenticated?: boolean; phoneMasked?: string | null; authenticated?: boolean; points?: number; banned?: boolean; avatar?: string; level?: number; earnedPoints?: number };
  tasks: Task[];
  placements: Task[];
  stores: Store[];
  coupons: Coupon[];
  contribution: number;
  feedbackCount: number;
  feedback: { taskTitle: string; clarity: number; comment: string }[];
  ownFeedback?: { id: string; taskId: string; taskTitle: string; clarity: number; comment: string; createdAt: number }[];
  staff: { role: string; storeId: string | null } | null;
  settings?: GameSettings;
  couponTemplates?: CouponTemplate[];
  dailyQuota?: { used: number; limit: number; remaining: number };
  achievements?: Achievement[];
  ranking?: RankingEntry[];
  footprints?: Footprint[];
};
export type StaffState = {
  scope: { role: string; storeId: string | null };
  pending: Task[];
  coupons: Coupon[];
  tasks: Task[];
  claims: number;
  redeemed: number;
  distinctPlayers: number;
};
export type ReviewRecord = {
  id: string;
  taskId: string;
  reviewer: string;
  action: string;
  note: string;
  createdAt: number;
};

export type GameSettings = { dailyLimit: number; clueCosts: number[]; contributionRatio: number; ugcReview: boolean };
export type CouponTemplate = {
  id: string; storeId: string; title: string; type: "discount" | "cash" | "gift";
  value: number; minAmount: number; totalCount: number; issuedCount: number; remaining: number;
  validStart: number | null; validEnd: number | null; status: "active" | "inactive";
};
export type Achievement = { id: string; title: string; desc: string; icon: string; unlocked: boolean; progress: number; target: number; reward: number };
export type RankingEntry = { id: string; nickname: string; avatar: string; claims: number; points: number; rank: number; isMe: boolean };
export type Footprint = { id: string; storeId: string; storeName: string; logo: string; floor: string; category: string; visitedAt: number; coinsFound: number; mall: string; verified: false };
