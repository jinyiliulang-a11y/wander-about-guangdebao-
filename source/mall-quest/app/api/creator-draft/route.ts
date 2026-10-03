import { getCreatorDraft, writeCreatorDraft, creatorDraftRequestLimit } from "@/lib/creator-draft-server";
import { GameError } from "@/lib/game-server";

const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  return Response.json({ error: { message: error instanceof GameError ? error.message : "草稿服务暂不可用，内容仍保留在当前页面，请稍后重试" } }, { status: error instanceof GameError ? error.status : 503, headers });
}
async function body(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") || 0) > creatorDraftRequestLimit) throw new GameError("草稿过大，请减少照片后重试", 413);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new GameError("草稿请求须使用JSON格式", 415);
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > creatorDraftRequestLimit) throw new GameError("草稿过大，请减少照片后重试", 413);
  try { return JSON.parse(text); } catch { throw new GameError("草稿请求格式不正确"); }
}
export async function GET(req: Request) {
  try { return Response.json({ data: await getCreatorDraft(req) }, { headers }); } catch (error) { return failure(error); }
}
export async function PUT(req: Request) {
  try { return Response.json({ data: await writeCreatorDraft(req, await body(req)) }, { headers }); } catch (error) { return failure(error); }
}
export async function DELETE(req: Request) {
  try { return Response.json({ data: await writeCreatorDraft(req, await body(req), true) }, { headers }); } catch (error) { return failure(error); }
}
