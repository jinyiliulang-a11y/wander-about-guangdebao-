export type CreatorDraftOptions = {
  difficulty: number;
  expiresAt: number | null;
  rewardType: "points" | "coupon";
  rewardValue: number;
  rewardCouponId: string | null;
  photoURLs: string[];
};
export type CreatorDraft = {
  storeId: string;
  title: string;
  clues: string[];
  options: CreatorDraftOptions;
  step: 0 | 1 | 2;
  submissionId: string | null;
};
export type CreatorDraftState = {
  eventId: string;
  playerId: string;
  revision: number;
  updatedAt: number | null;
  draft: CreatorDraft | null;
};
export type CreatorDraftStatus = "idle" | "loading" | "saving" | "saved" | "error" | "conflict";
