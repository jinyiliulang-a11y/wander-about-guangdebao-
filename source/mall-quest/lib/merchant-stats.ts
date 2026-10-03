/** Coupon-only merchant statistics. Date ranges use Beijing calendar days. */
export type MerchantCouponStats = {
  asOf: number;
  issued: number; unused: number; upcoming: number; redeemed: number; expired: number;
  recipients: number; redemptions: number; redemptionRate: number | null;
  inventory: {
    activeTemplates: number; total: number; remaining: number; used: number;
    storeRewardTotal: number; storeRewardRemaining: number; issuableUpperBound: number;
  };
  daily: { date: string; issued: number; redeemed: number }[];
};
type TemplateQuota = {
  status: string; totalCount: number; remaining: number;
  validStart: number | null; validEnd: number | null;
};
const count = (value: unknown) => Math.max(0, Number(value) || 0);
export function summarizeMerchantCoupons(input: {
  counts: Record<string, unknown>; templates: TemplateQuota[]; rewardTotal: number;
  storeEnabled: boolean; since: number; range: number; now: number;
  daily: Record<string, unknown>[];
}): MerchantCouponStats {
  const { counts, now } = input;
  const active = input.storeEnabled ? input.templates.filter(t => t.status === "active"
    && (t.validStart === null || t.validStart <= now) && (t.validEnd === null || t.validEnd > now)) : [];
  const total = active.reduce((sum, t) => sum + t.totalCount, 0);
  const remaining = active.reduce((sum, t) => sum + Math.min(t.totalCount, Math.max(0, t.remaining)), 0);
  const storeRewardTotal = input.rewardTotal;
  const storeRewardRemaining = Math.max(0, storeRewardTotal - count(counts.reward_issued));
  const issued = count(counts.issued), redeemed = count(counts.redeemed);
  const days = new Map(input.daily.map(r => [String(r.day), r]));
  return {
    asOf: now, issued, unused: count(counts.unused), upcoming: count(counts.upcoming), redeemed,
    expired: count(counts.expired), recipients: count(counts.recipients), redemptions: count(counts.redemptions),
    redemptionRate: issued ? Math.round(redeemed / issued * 1000) / 10 : null,
    inventory: { activeTemplates: active.length, total, remaining, used: total - remaining,
      storeRewardTotal, storeRewardRemaining, issuableUpperBound: Math.min(remaining, storeRewardRemaining) },
    daily: Array.from({ length: input.range }, (_, i) => {
      const date = new Date(input.since + 28_800_000 + i * 86_400_000).toISOString().slice(0, 10);
      const day = days.get(date);
      return { date, issued: count(day?.issued), redeemed: count(day?.redeemed) };
    }),
  };
}

/** Shared report rows keep CSV and Excel consistent with the merchant page. */
export function merchantCouponReportRows(stats: MerchantCouponStats | undefined, range: number): [string, string | number, string][] {
  const value = (n: number | undefined) => n === undefined ? "待统计" : n;
  const cohort = `近${range}日领取的优惠券批次，当前状态；不含积分奖励`;
  return [
    ["发放优惠券", value(stats?.issued), cohort],
    ["待使用券", value(stats?.unused), `${cohort}；含尚未生效的券`],
    ["尚未生效券", value(stats?.upcoming), "待使用券的子集，不能与待使用券重复相加"],
    ["本批已核销", value(stats?.redeemed), cohort],
    ["本批已过期", value(stats?.expired), `${cohort}；已核销券不重复归入过期`],
    ["领券顾客", value(stats?.recipients), `近${range}日成功领券的不同玩家；不代表到店人数`],
    ["期间核销发生", value(stats?.redemptions), `近${range}日发生的优惠券核销，可包含此前领券`],
    ["本批核销率", !stats ? "待统计" : stats.redemptionRate === null ? "暂无样本" : stats.redemptionRate / 100,
      "本批已核销 / 本批发放优惠券；不以期间核销次数作分子"],
    ["当前有效启用模板", value(stats?.inventory.activeTemplates), "门店启用、模板启用且已生效未过期；排除删除模板"],
    ["有效模板总配额", value(stats?.inventory.total), "当前有效启用模板的总配额合计；与所选时间范围无关"],
    ["有效模板剩余配额", value(stats?.inventory.remaining), "有效模板总配额减累计发放；核销不会恢复配额"],
    ["门店共享奖励剩余额度", value(stats?.inventory.storeRewardRemaining), "本活动门店总奖励额度减累计领奖；积分和优惠券均占用"],
    ["当前发券额度上限", value(stats?.inventory.issuableUpperBound), "模板剩余配额与门店共享剩余额度取较小值；实际发券还需有效任务等条件"],
  ];
}
