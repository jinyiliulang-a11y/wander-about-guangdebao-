import { env } from "cloudflare:workers";
export async function GET() {
  const config = env as unknown as Record<string, string | undefined>;
  const key = config.AMAP_WEB_KEY, securityCode = config.AMAP_SECURITY_JS_CODE;
  const ready = typeof key === "string" && /^[a-f0-9]{32}$/i.test(key) && typeof securityCode === "string" && /^[a-f0-9]{32}$/i.test(securityCode);
  return Response.json({ data: ready ? { available: true, key, servicePath: "/api/maps/service" } : { available: false } },
    { headers: { "Cache-Control": "no-store" } });
}
