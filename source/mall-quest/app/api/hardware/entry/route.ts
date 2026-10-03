import { GameError } from "@/lib/game-server";
import { hardwareDynamicEntry } from "@/lib/hardware-server";

const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.getAll("deviceId").length !== 1)
      throw new GameError("请填写唯一设备标识");
    return Response.json(await hardwareDynamicEntry(req, { deviceId: url.searchParams.get("deviceId") }), { headers });
  } catch (error) {
    return Response.json({ error: { message: error instanceof GameError ? error.message : "金币入口服务暂不可用，请稍后重试" } },
      { status: error instanceof GameError ? error.status : 503, headers });
  }
}

export function POST() {
  return Response.json({ error: { message: "请使用 GET 获取动态金币入口" } }, { status: 405, headers: { ...headers, Allow: "GET" } });
}
