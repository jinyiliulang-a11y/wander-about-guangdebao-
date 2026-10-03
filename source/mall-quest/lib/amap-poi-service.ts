import { apiRequest } from "./game-api";
import type { AmapAutoComplete, AmapPlaceSearch, AmapPoiCallback, AmapPoiResult } from "./amap-sdk";

export type AmapPoiServices = { autocomplete: AmapAutoComplete; placeSearch: AmapPlaceSearch };

/** SDK-shaped callbacks backed only by the dedicated REST endpoint. */
export function createAmapPoiServices(): AmapPoiServices {
  let searchAlive = true, detailAlive = true;
  let searchRequest: AbortController | null = null, detailRequest: AbortController | null = null;
  const cancelSearch = () => { searchRequest?.abort(); searchRequest = null; };
  const cancelDetail = () => { detailRequest?.abort(); detailRequest = null; };
  const run = (kind: "tips" | "detail", value: string, callback: AmapPoiCallback) => {
    if (kind === "tips" ? !searchAlive : !detailAlive) return;
    if (kind === "tips") cancelSearch(); else cancelDetail();
    const controller = new AbortController();
    if (kind === "tips") searchRequest = controller; else detailRequest = controller;
    const current = () => !controller.signal.aborted && (kind === "tips"
      ? searchAlive && searchRequest === controller : detailAlive && detailRequest === controller);
    const done = () => { if (kind === "tips") searchRequest = null; else detailRequest = null; };
    const params = new URLSearchParams({ kind, [kind === "tips" ? "keywords" : "id"]: value });
    void apiRequest<AmapPoiResult>("/api/maps/poi?" + params, { signal: controller.signal },
      { readOnly: true, timeoutMs: 10_000 }).then(result => {
      if (!current()) return;
      const items = kind === "tips" ? result.tips : result.poiList?.pois;
      done();
      callback(Array.isArray(items) && items.length > 0 ? "complete" : "no_data", result);
    }).catch(cause => {
      if (!current()) return;
      done();
      callback("error", { info: cause instanceof Error ? cause.message : "门店搜索暂不可用，可手动填写门店位置。" });
    });
  };
  return {
    autocomplete: {
      search: (query, callback) => run("tips", query, callback),
      destroy: () => { searchAlive = false; cancelSearch(); },
    },
    placeSearch: {
      getDetails: (id, callback) => run("detail", id, callback),
      clear: cancelDetail,
      destroy: () => { detailAlive = false; cancelDetail(); },
    },
  };
}
