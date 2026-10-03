import { db, staff } from "./game-server";
import { GameError } from "./game-error";
import { authorizationValues, staffAuthorizationSQL } from "./account-authorization";

type Row = Record<string, unknown>;
const CLOCK = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
function identifier(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 100) throw new GameError("设备、模板或任务标识不正确");
  return value;
}
/** Configure an existing bound task's future reward. This never issues or redeems a coupon. */
export async function bindDeviceCoupon(req: Request, input: Row) {
  await staff(req);
  const deviceId = identifier(input.deviceId), templateId = identifier(input.templateId), taskId = identifier(input.expectedTaskId);
  if (input.expectedCouponId !== null && typeof input.expectedCouponId !== "string") throw new GameError("请刷新并核对当前设备绑定");
  const previous = input.expectedCouponId === null ? null : identifier(input.expectedCouponId);
  const auth = await authorizationValues(req, true);
  const scope = await db().prepare(`SELECT h.id,t.id AS task_id,t.reward_type,t.reward_coupon_id
    FROM hardware_devices h JOIN tasks t ON t.id=h.bound_task_id AND t.store_id=h.store_id
    JOIN stores s ON s.id=h.store_id JOIN coupon_templates ct ON ct.id=? AND ct.store_id=s.id
    WHERE h.id=? AND t.id=? AND h.enabled=1 AND t.deleted_at IS NULL AND t.status='published'
      AND s.event_id='mall-48h' AND s.status='active' AND s.point_mode='hardware'
      AND (h.id<>'coin-tea-01' OR (s.id='tea' AND t.id='quest-tea'))
      AND (t.expires_at IS NULL OR t.expires_at>${CLOCK})
      AND ct.status='active' AND ct.deleted_at IS NULL AND (ct.valid_end IS NULL OR ct.valid_end>${CLOCK})
      AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count
      AND ${staffAuthorizationSQL("s.id")}`).bind(templateId, deviceId, taskId, ...auth).first<Row>();
  if (!scope) throw new GameError("请选择本店已登记并绑定活动的可用金币及优惠券", 403);
  if (scope.reward_type === "coupon" && scope.reward_coupon_id === templateId) return { deviceId, templateId, taskId, bound: true, replayed: true, message: "此金币已经绑定这张券" };
  const result = await db().prepare(`UPDATE tasks SET reward_type='coupon',reward_coupon_id=?,reward_value=50
    WHERE id=? AND reward_coupon_id IS ? AND deleted_at IS NULL AND status='published'
      AND EXISTS(SELECT 1 FROM hardware_devices h JOIN stores s ON s.id=h.store_id
        JOIN coupon_templates ct ON ct.store_id=s.id AND ct.id=?
        WHERE h.id=? AND h.enabled=1 AND h.bound_task_id=tasks.id AND h.store_id=tasks.store_id
          AND s.event_id='mall-48h' AND s.status='active' AND s.point_mode='hardware'
          AND (h.id<>'coin-tea-01' OR (s.id='tea' AND tasks.id='quest-tea'))
          AND (tasks.expires_at IS NULL OR tasks.expires_at>${CLOCK})
          AND ct.status='active' AND ct.deleted_at IS NULL AND (ct.valid_end IS NULL OR ct.valid_end>${CLOCK})
          AND (SELECT COUNT(*) FROM claims WHERE template_id=ct.id)<ct.total_count
          AND ${staffAuthorizationSQL("s.id")})`).bind(templateId, taskId, previous, templateId, deviceId, ...auth).run();
  if (!result.meta.changes) throw new GameError("设备绑定或券状态已变化，请刷新核对；请先启用券并保留可发额度", 409);
  return { deviceId, templateId, taskId, bound: true, message: "优惠券已绑定金币；后续申请使用此券，已发券保持原条款" };
}
