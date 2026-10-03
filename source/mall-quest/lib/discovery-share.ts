import type { Coupon } from "./game-types";

export function discoveryShare(coupon: Coupon, origin: string) {
  const title = coupon.taskTitle || "一次小发现";
  const link = `${origin}/client/coin/${encodeURIComponent(coupon.taskId)}`;
  const text = `我在逛道宝找到了「${title}」，获得模拟权益：${coupon.reward}！快来一起跟着线索发现小店吧～\n模拟权益不用于真实消费。\n${link}`;
  return { title, link, text };
}
