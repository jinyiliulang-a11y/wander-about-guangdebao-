import { GameError } from "@/lib/game-server";
import { issueHardwareCode } from "@/lib/hardware-server";

const headers = { "Cache-Control": "no-store" };
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") || 0) > 1024) throw new GameError("设备请求过大", 413);
    const body = await req.text();
    if (body.length > 1024) throw new GameError("设备请求过大", 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new GameError("设备请求格式不正确"); }
    if (!input || Array.isArray(input) || typeof input !== "object") throw new GameError("设备请求格式不正确");
    return Response.json(await issueHardwareCode(req, input as Record<string, unknown>), { headers });
  } catch (error) {
    // Never log request bodies or authorization headers containing a device credential.
    const status = error instanceof GameError ? error.status : 503;
    return Response.json({ error: { message: error instanceof GameError ? error.message : "设备服务暂不可用，请稍后重试" } }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "5" } : {}) } });
  }
}
