import type { StoreGeofence } from "./geofence";

/** Activity announcements never create tasks, check-ins, rewards or stock changes. */
export type StoreActivityStatus = "pending" | "published" | "rejected" | "offline";
export type StoreActivityPhase = "upcoming" | "active" | "expired";
export type StoreActivityFilter = "all" | StoreActivityStatus | "expired";
export type StoreActivity = {
  id: string; eventId: string; storeId: string; storeName: string;
  title: string; description: string; startAt: number; endAt: number;
  status: StoreActivityStatus; phase: StoreActivityPhase; revision: number;
  createdAt: number; updatedAt: number; fence: StoreGeofence | null;
  /** Management responses only; public responses omit author and review details. */
  authorId?: string; requestId?: string; reviewNote?: string;
};
export type StoreActivitiesInput = {
  manage?: boolean; storeId?: string; filter?: StoreActivityFilter; page?: number;
};
export type StoreActivitiesState = {
  activities: StoreActivity[]; ugcReview: boolean; fences: StoreGeofence[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
/** Exactly one of id or requestId. requestId lookup requires manage + storeId. */
export type StoreActivityStateInput = {
  manage?: boolean; id?: string; requestId?: string; storeId?: string;
};
export type StoreActivityState = { activity: StoreActivity | null; ugcReview: boolean; fences: StoreGeofence[] };
/** Milliseconds since epoch. A past start is allowed; end must still be in the future. */
export type StoreActivitySaveInput = {
  storeId: string; title: string; description: string; startAt: number; endAt: number;
  expectedRevision: number;
  /** Required for create, retained unchanged when retrying an uncertain create. */
  requestId?: string;
  /** Omit for create (expectedRevision 0); editing requires id and revision >= 1. */
  id?: string;
};
export type StoreActivityWithdrawInput = { id: string; expectedRevision: number };
export type StoreActivityReviewInput = {
  id: string; expectedRevision: number; decision: "publish" | "reject" | "offline";
  /** A rejection requires a 2–160 character reason. */
  reviewNote?: string;
};
export type StoreActivityMutationResult = { activity: StoreActivity; message: string; replayed?: boolean };
export const STORE_ACTIVITY_PAGE_SIZE = 20;
export const STORE_ACTIVITY_TITLE_LIMIT = 40;
export const STORE_ACTIVITY_DESCRIPTION_LIMIT = 500;
export const STORE_ACTIVITY_REVIEW_NOTE_LIMIT = 160;
/** Last millisecond of year 9999 in China Standard Time; date inputs use four-digit years. */
export const STORE_ACTIVITY_MAX_TIME = 253_402_271_999_999;
