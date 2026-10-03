import { env } from "cloudflare:workers";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const unavailable = "门店搜索暂不可用，可稍后重试或手动填写门店位置。";
function failure(code: string, message: string, status = 503) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** REST POI requests use their own server key, independently of the JS SDK proxy. */
export async function GET(req: Request) {
  if (req.method !== "GET") return Response.json({ error: { code: "MAP_POI_METHOD", message: "门店搜索仅支持 GET 请求。" } },
    { status: 405, headers: { ...headers, Allow: "GET" } });
  const input = new URL(req.url), params = input.searchParams, kind = params.get("kind");
  const allowed = new Set(kind === "tips" ? ["kind", "keywords", "city"] : ["kind", "id"]);
  if (input.search.length > 1024 || (kind !== "tips" && kind !== "detail") ||
      [...params.keys()].some(name => !allowed.has(name) || params.getAll(name).length !== 1)) {
    return failure("MAP_POI_INVALID_REQUEST", "门店搜索参数不正确，请重新输入。", 400);
  }
  const keywords = (params.get("keywords") || "").trim(), id = params.get("id") || "", city = params.get("city");
  if (kind === "tips" && (keywords.length < 2 || keywords.length > 60 || /[\u0000-\u001f\u007f]/.test(keywords)) ||
      kind === "detail" && !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
      city !== null && !/^[A-Za-z0-9\u3400-\u9fff\u00b7 -]{1,60}$/.test(city)) {
    return failure("MAP_POI_INVALID_REQUEST", "请输入有效的门店名称或门店编号。", 400);
  }
  const key = (env as unknown as Record<string, string | undefined>).AMAP_REST_KEY;
  if (!key || !/^[a-f0-9]{32}$/i.test(key)) return failure("MAP_POI_NOT_CONFIGURED",
    "门店搜索尚未配置，可手动填写名称、地址并在地图选点。");

  const target = new URL(kind === "tips" ? "/v3/assistant/inputtips" : "/v3/place/detail", "https://restapi.amap.com");
  target.searchParams.set("key", key);
  target.searchParams.set("output", "JSON");
  if (kind === "tips") {
    target.searchParams.set("keywords", keywords);
    target.searchParams.set("datatype", "poi");
    if (city !== null) target.searchParams.set("city", city);
  } else target.searchParams.set("id", id);

  try {
    const response = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      return failure("MAP_POI_UPSTREAM_ERROR", unavailable);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("MAP_POI_UPSTREAM_ERROR", unavailable);
    const result = body as Record<string, unknown>;
    if ((result.status !== "1" && result.status !== 1) || (result.infocode !== undefined && String(result.infocode) !== "10000")) {
      const mismatch = ["10001", "10008", "10009"].includes(String(result.infocode));
      return failure(mismatch ? "MAP_POI_KEY_MISMATCH" : "MAP_POI_UPSTREAM_ERROR", mismatch
        ? "门店搜索的高德服务配置不匹配，可手动填写门店位置。" : unavailable);
    }
    const items = kind === "tips" ? result.tips : result.pois;
    if (!Array.isArray(items)) return failure("MAP_POI_UPSTREAM_ERROR", unavailable);
    const pois = items.slice(0, kind === "tips" ? 8 : 1).flatMap(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const source = value as Record<string, unknown>, poi: Record<string, string | string[]> = {};
      for (const field of ["id", "name", "address", "district", "pname", "cityname", "adname", "location"]) {
        const text = source[field];
        if (typeof text === "string" && !text.includes(key)) poi[field] = text.slice(0, field === "location" ? 80 : 400);
        else if (Array.isArray(text) && text.every(part => typeof part === "string" && !part.includes(key))) {
          poi[field] = text.slice(0, 5).map(part => String(part).slice(0, 400));
        }
      }
      return [poi];
    });
    return Response.json({ data: kind === "tips" ? { tips: pois } : { poiList: { pois } } }, { headers });
  } catch (cause) {
    const timedOut = cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name);
    return failure(timedOut ? "MAP_POI_TIMEOUT" : "MAP_POI_UPSTREAM_ERROR", timedOut
      ? "门店搜索超时，可重试或手动填写门店位置。" : unavailable);
  }
}
