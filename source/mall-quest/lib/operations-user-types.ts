import type { Coupon, Task } from "./game-types";

export type OperationsUser = {
  id: string;
  nickname: string;
  phoneMasked: string | null;
  authenticated: boolean;
  points: number;
  level: number;
  banned: boolean;
  claimCount: number;
  createdAt: number;
};

export type OperationsUserDetailInput = {
  playerId: string;
  claimsPage?: number;
  placementsPage?: number;
  ledgerPage?: number;
};

export type OperationsUserPagination = {
  page: number;
  pageSize: 10;
  total: number;
  // Empty collections still have page 1, so pagination never returns page 0.
  totalPages: number;
};

export type OperationsUserLedgerEntry = {
  id: string;
  delta: number;
  kind: string;
  reason: string;
  createdAt: number;
};

export type OperationsUserActivity = {
  earnedPoints: number;
  couponRewards: number;
  pointsRewards: number;
  redeemedCoupons: number;
  placements: number;
  // Published is the stored status, including records that have since expired.
  publishedPlacements: number;
  ledgerEntries: number;
  lastActiveDay: string | null;
};

export type OperationsUserPermissions = {
  canChangeStatus: boolean;
  statusReason: string | null;
};

export type OperationsUserDetail = {
  user: OperationsUser;
  claims: Coupon[];
  placements: Task[];
  ledger: OperationsUserLedgerEntry[];
  pagination: {
    claims: OperationsUserPagination;
    placements: OperationsUserPagination;
    ledger: OperationsUserPagination;
  };
  activity: OperationsUserActivity;
  permissions: OperationsUserPermissions;
};
