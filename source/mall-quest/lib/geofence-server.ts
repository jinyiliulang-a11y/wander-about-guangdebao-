import { cookie, db, hash, staff } from "./game-server";
import { GameError } from "./game-error";
import { staffAuthorizationSQL } from "./account-authorization";
import { checkGeofence, geofenceMessage, validCoordinates, validRadius } from "./geofence";
import type { GeoLocation, GeofenceCheck, GeofenceReason, GeofenceState, StoreGeofence } from "./geofence";

const EVENT = "mall-48h";
type Row = Record<string, unknown>;
export class GeofenceError extends GameError {
  constructor(public reason: GeofenceReason, status = 409) { super(geofenceMessage(reason), status); }
}
const SELECT = `SELECT s.id AS store_id,s.name AS store_name,g.enabled,g.latitude,g.longitude,g.radius_meters,g.revision,g.updated_at
  FROM stores s LEFT JOIN store_geofences g ON g.store_id=s.id WHERE s.event_id=?`;
function dto(row: Row): StoreGeofence {
  return { storeId: String(row.store_id), storeName: String(row.store_name), enabled: row.enabled === 1,
    latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
    radiusMeters: row.radius_meters == null ? null : Number(row.radius_meters), revision: row.revision == null ? 0 : Number(row.revision),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at), coordinateSystem: "WGS84" };
}
function storeIdentifier(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 100) throw new GameError("门店标识不正确");
  return input;
}
/** A missing migration or failed read always closes access; it never means no fence. */
export async function readGeofences(storeId?: unknown): Promise<GeofenceState> {
  const id = storeId === undefined ? undefined : storeIdentifier(storeId);
  let rows: Row[];
  try {
    rows = (await db().prepare(SELECT + (id ? " AND s.id=?" : "") + " ORDER BY s.id")
      .bind(EVENT, ...(id ? [id] : [])).all<Row>()).results;
  } catch { throw new GeofenceError("service-unavailable", 503); }
  if (id && !rows.length) throw new GameError("门店不存在", 404);
  return { fences: rows.map(dto) };
}
export async function saveGeofence(req: Request, input: Row): Promise<{ fence: StoreGeofence; message: string }> {
  const scope = await staff(req), id = storeIdentifier(input.storeId);
  if (scope.role === "merchant" && scope.store_id !== id) throw new GameError("不能设置其他门店的围栏", 403);
  if (typeof input.enabled !== "boolean") throw new GameError("围栏启用状态不正确");
  const expected = input.expectedRevision;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER)
    throw new GameError("围栏版本不正确，请刷新后再保存");
  const latitude = input.latitude == null ? null : input.latitude, longitude = input.longitude == null ? null : input.longitude;
  const radius = input.radiusMeters == null ? null : input.radiusMeters;
  const empty = latitude === null && longitude === null && radius === null;
  if ((!empty && (!validCoordinates(latitude, longitude) || !validRadius(radius))) || (input.enabled && empty))
    throw new GameError("请填写真实 WGS84 经纬度及 20–5000 米范围；不能用楼层示意坐标");
  // Prove event/store existence and migration availability before the CAS write.
  await readGeofences(id);
  const staffHash = await hash(cookie(req, "mall_staff") || "");
  let changes: number;
  try {
    const result = await db().prepare(`INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at)
      SELECT s.id,?,?,?,?,1,? FROM stores s WHERE s.id=? AND s.event_id=?
        AND ${staffAuthorizationSQL("s.id")}
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM store_geofences WHERE store_id=s.id))
          OR EXISTS(SELECT 1 FROM store_geofences WHERE store_id=s.id AND revision=?))
      ON CONFLICT(store_id) DO UPDATE SET enabled=excluded.enabled,latitude=excluded.latitude,longitude=excluded.longitude,
        radius_meters=excluded.radius_meters,revision=store_geofences.revision+1,updated_at=excluded.updated_at
      WHERE store_geofences.revision=?`).bind(input.enabled ? 1 : 0, latitude as number | null, longitude as number | null,
        radius as number | null, Date.now(), id, EVENT, staffHash, Date.now(), expected, expected, expected).run();
    changes = Number(result.meta.changes);
  } catch { throw new GeofenceError("service-unavailable", 503); }
  if (!changes) { await staff(req); throw new GeofenceError("config-changed"); }
  const { fences } = await readGeofences(id);
  return { fence: fences[0], message: input.enabled ? "围栏已保存，确认金币和领奖均需进入此范围" : "围栏已停用，此门店暂停新的金币确认和领奖；历史奖励保留" };
}
export type VerifiedGeofence = { fence: StoreGeofence; location: GeoLocation; check: GeofenceCheck };
export async function requireStoreGeofence(storeId: string, location: unknown, now = Date.now()): Promise<VerifiedGeofence> {
  const { fences } = await readGeofences(storeId), fence = fences[0];
  const check = checkGeofence(fence, location, now);
  if (!check.inside) throw new GeofenceError(check.reason, check.reason === "location-required" || check.reason === "invalid-location" ? 400 : 409);
  return { fence, location: location as GeoLocation, check };
}
