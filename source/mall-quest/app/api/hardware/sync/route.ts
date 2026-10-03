import { GameError } from "@/lib/game-server";
import { hardwareStoreSync } from "@/lib/hardware-server";

const headers = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") || 0) > 1024)
      throw new GameError("设备请求过大", 413);
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 1024)
      throw new GameError("设备请求过大", 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new GameError("设备请求格式不正确"); }
    if (!input || Array.isArray(input) || typeof input !== "object")
      throw new GameError("设备请求格式不正确");
    return Response.json(await hardwareStoreSync(req, input as Record<string, unknown>), { headers });
  } catch (error) {
    const status = error instanceof GameError ? error.status : 503;
    return Response.json({ error: { message: error instanceof GameError ? error.message : "设备服务暂不可用，请稍后重试" } }, { status, headers });
  }
}

export function GET() {
  return Response.json({ error: { message: "请使用 POST 同步设备点位" } },
    { status: 405, headers: { ...headers, Allow: "POST" } });
}
