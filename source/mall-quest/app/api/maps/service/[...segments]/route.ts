import { env } from "cloudflare:workers";

/** A fixed AMap destination; never accepts arbitrary URLs or forwards cookies. */
export async function GET(req: Request) {
  const config = env as unknown as Record<string, string | undefined>;
  if (!config.AMAP_WEB_KEY || !/^[a-f0-9]{32}$/i.test(config.AMAP_WEB_KEY) || !config.AMAP_SECURITY_JS_CODE || !/^[a-f0-9]{32}$/i.test(config.AMAP_SECURITY_JS_CODE)) return new Response("Map unavailable", { status: 503 });
  const input = new URL(req.url), path = input.pathname.slice("/api/maps/service".length);
  if (path.length > 180 || !/^\/(v3|v4|v5)\/[a-zA-Z0-9_/-]+$/.test(path) || input.search.length > 4000)
    return new Response("Invalid map request", { status: 400 });
  const target = new URL(path, path === "/v4/map/styles" ? "https://webapi.amap.com" : "https://restapi.amap.com");
  target.search = input.search;
  target.searchParams.set("key", config.AMAP_WEB_KEY);
  target.searchParams.set("jscode", config.AMAP_SECURITY_JS_CODE);
  try {
    const response = await fetch(target, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8000) });
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response("Map unavailable", { status: 503 }); }
}
