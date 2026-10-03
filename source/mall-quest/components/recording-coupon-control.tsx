"use client";

import { Clapperboard } from "lucide-react";
import type { Coupon, GameState } from "@/lib/game-types";
import "./recording-coupon-control.css";

// Keep the caller contract while retiring the former direct grant control.
export type RecordingCouponControlProps = {
  game: GameState;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  onOpenReward: (coupon: Coupon) => void;
  onNewReward?: (coupon: Coupon) => void;
  onRefresh?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function RecordingCouponControl({ game }: RecordingCouponControlProps) {
  if (game.recordingShortcutAllowed !== true || !game.player.accountAuthenticated) return null;
  return <section className="recording-coupon-control" aria-label="设备联动演示">
    <div className="recording-coupon-heading"><Clapperboard size={22} /><div>
      <h3>设备联动演示</h3>
      <p>演示账号也使用金币设备的完整领取流程。</p>
    </div></div>
    <ol style={{ margin: 0, paddingLeft: "1.4em", display: "grid", gap: 10 }}>
      <li>碰金币 NFC 进入任务，允许门店定位并保存待领申请。</li>
      <li>把金币交给商家。商家在“金币领取确认”中扫描设备码 <code style={{ overflowWrap: "anywhere" }}>GTB-DEVICE:coin-tea-01</code>。</li>
      <li>商家核对玩家和领取编号，收到金币后点击“确认领取”。</li>
      <li>领取成功后，奖励进入当前玩家的卡包；定位许可过期时，先更新定位再请商家刷新。</li>
      <li>消费时出示卡包中的个人优惠券码，由对应门店另外确认核销。</li>
    </ol>
    <p className="recording-coupon-note">设备扫码只查询待领申请；个人券码用于之后的核销。奖励以门店当前活动配置为准。</p>
  </section>;
}
