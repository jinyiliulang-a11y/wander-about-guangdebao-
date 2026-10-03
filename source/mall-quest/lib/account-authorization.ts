import { cookie, hash } from "./game-server";

const CLOCK = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
/** Expressions are code-owned SQL column names, never request data. */
export function staffAuthorizationSQL(storeExpression?: string, adminOnly = false) {
  return `EXISTS(SELECT 1 FROM sessions auth_s JOIN accounts auth_a ON auth_a.id=auth_s.account_id
    JOIN players auth_p ON auth_p.id=auth_a.player_id
    WHERE auth_s.token_hash=? AND auth_s.expires_at>MAX(?,${CLOCK}) AND auth_p.banned=0
    AND auth_a.status='approved' AND auth_s.player_id=auth_a.player_id AND auth_s.role=auth_a.role
    AND ${adminOnly ? "auth_s.role='admin'" : "auth_s.role IN ('admin','merchant')"}
    AND (auth_s.role='admin' OR (auth_a.store_id IS NOT NULL AND auth_s.store_id=auth_a.store_id${storeExpression ? ` AND auth_s.store_id=${storeExpression}` : ""})))`;
}
export function playerAuthorizationSQL(playerExpression: string) {
  return `EXISTS(SELECT 1 FROM sessions auth_s JOIN players auth_p ON auth_p.id=auth_s.player_id
    LEFT JOIN accounts auth_a ON auth_a.id=auth_s.account_id
    WHERE auth_s.token_hash=? AND auth_s.expires_at>MAX(?,${CLOCK}) AND auth_s.role='player'
    AND auth_s.player_id=${playerExpression} AND auth_p.banned=0
    AND auth_s.account_id IS NOT NULL AND auth_a.status='approved' AND auth_a.role='player' AND auth_a.player_id=auth_s.player_id)`;
}
export async function authorizationValues(req: Request, workspace = false): Promise<[string, number]> {
  return [await hash(cookie(req, workspace ? "mall_staff" : "mall_player") || ""), Date.now()];
}
