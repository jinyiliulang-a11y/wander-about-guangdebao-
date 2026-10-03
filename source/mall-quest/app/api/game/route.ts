import {
  db,
  seed,
  session,
  player,
  hash,
  sessionCookie,
  state,
  execute,
  GameError,
} from "@/lib/game-server";
import { recordStateActivity } from "@/lib/game-business";
import { GeofenceError } from "@/lib/geofence-server";
import { MerchantDeviceError } from "@/lib/merchant-device-server";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  console.error("game request failed", error);
  return Response.json(
    {
      error: {
        ...(error instanceof GeofenceError ? { reason: error.reason } : {}),
        ...(error instanceof MerchantDeviceError ? { code: error.code } : {}),
        message:
          error instanceof GameError
            ? error.message
            : "活动服务暂时不可用，请保留内容并重试",
      },
    },
    { status: error instanceof GameError ? error.status : 503, headers },
  );
}
export async function GET(req: Request) {
  try {
    await seed();
    let s = await session(req);
    let token: string | undefined;
    if (!s?.player_id) {
      const id = crypto.randomUUID();
      token = crypto.randomUUID() + crypto.randomUUID();
      const now = Date.now();
      await db().batch([
        db()
          .prepare("INSERT INTO players(id,nickname,created_at) VALUES(?,?,?)")
          .bind(id, "寻宝客 " + id.slice(0, 4).toUpperCase(), now),
        db()
          .prepare(
            "INSERT INTO sessions(token_hash,role,player_id,expires_at) VALUES(?,?,?,?)",
          )
          .bind(await hash(token), "player", id, now + 2592000000),
      ]);
      s = { role: "player", player_id: id, store_id: null, account_id: null, legacy_authenticated: 0, account_username: null, account_role: null };
    }
    return Response.json(
      { data: await state(req, s.player_id!) },
      {
        headers: {
          ...headers,
          ...(token ? { "Set-Cookie": sessionCookie(req, token) } : {}),
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    if(Number(req.headers.get('content-length')||0)>1200000)throw new GameError('请求过大；照片合计不超过1MB',413);
    const body=await req.text();
    if(new TextEncoder().encode(body).byteLength>1200000)throw new GameError('请求过大；照片合计不超过1MB',413);
    let input:Record<string,unknown>;
    try { input=JSON.parse(body); } catch { throw new GameError('请求格式不正确'); }
    if (!input || Array.isArray(input) || typeof input.action !== "string")
      throw new GameError("请求格式不正确");
    const expectedPlayerId = req.headers.get("X-Mall-Quest-Player");
    if (expectedPlayerId !== null && !["playerLogout", "staffLogout"].includes(input.action)) {
      if (!expectedPlayerId || expectedPlayerId.length > 100) throw new GameError("页面身份标识不正确");
      if ((await player(req)).id !== expectedPlayerId)
        throw new GameError("登录身份已变化，请刷新确认当前账号后再操作", 409);
    }
    const result = await execute(req, input);
    if(['place','claim','nfcClaim','feedback','feedbackDelete','taskDelete','unlockClue','recordShare'].includes(input.action)) {
      const current=await session(req);
      if(current?.player_id)await recordStateActivity(req,current.player_id);
    }
    const { setCookie, ...data } = result as Record<string, unknown>;
    const responseHeaders=new Headers(headers);
    for(const value of Array.isArray(setCookie)?setCookie:setCookie?[setCookie]:[])responseHeaders.append('Set-Cookie',String(value));
    return Response.json({data},{headers:responseHeaders});
  } catch (error) {
    return failure(error);
  }
}
