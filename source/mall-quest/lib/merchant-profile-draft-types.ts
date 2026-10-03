/** Merchant-owned unfinished profile data. Raw strings deliberately preserve
 * incomplete editing; a draft never changes the published store. */
export type MerchantProfileDraftForm = {
  name: string;
  logo: string;
  category: string;
  floor: string;
  address: string;
  phone: string;
  imageURL: string;
  artwork: number;
  expectedImageRevision: number;
};

export type MerchantProfileDraftState = {
  storeId: string;
  revision: number;
  updatedAt: number | null;
  draft: MerchantProfileDraftForm | null;
  lastRequestId: string | null;
};

export type MerchantProfileDraftSaveInput = {
  requestId: string;
  expectedRevision: number;
  draft: MerchantProfileDraftForm;
};

export type MerchantProfileDraftDeleteInput = {
  requestId: string;
  expectedRevision: number;
};
