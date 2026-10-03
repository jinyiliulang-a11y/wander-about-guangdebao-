"use client";

import { ArrowRight, Coins, Sparkles, Ticket } from "lucide-react";
import type { Coupon } from "@/lib/game-types";
import { StoreImage } from "./store-image";
import "./store-image-surfaces.css";

export type ReferenceWalletFilter = "unused" | "used" | "expired" | "upcoming" | "points" | "all";
type WalletStatus = Exclude<ReferenceWalletFilter, "all">;

export type ReferenceWalletProps = {
  coupons: Coupon[];
  /** Parent-owned clock keeps expiry consistent with the rest of the client. */
  now: number;
  filter: string;
  onFilter: (filter: ReferenceWalletFilter) => void;
  onOpen: (coupon: Coupon, origin: HTMLElement) => void;
  onExplore: () => void;
};

const styles = ["sun-card", "flower-card", "night-card", "city-card", "coin-card"];
const labels: Record<WalletStatus, string> = {
  unused: "待使用", used: "已使用", expired: "已过期", upcoming: "未生效", points: "积分已入账",
};

export function referenceWalletStatus(coupon: Coupon, now: number): WalletStatus {
  if (coupon.rewardType === "points") return "points";
  if (coupon.redeemedAt || coupon.status === "used") return "used";
  if (coupon.status === "expired" || (coupon.validEnd != null && coupon.validEnd < now)) return "expired";
  if (coupon.status === "upcoming" || (coupon.validStart != null && coupon.validStart > now)) return "upcoming";
  return "unused";
}

const dateLabel = (value: number) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(value);

/** Reference CardPack composition with real reward records and parent-owned actions. */
export function ReferenceWallet({ coupons, now, filter, onFilter, onOpen, onExplore }: ReferenceWalletProps) {
  const rows = coupons.map(coupon => ({ coupon, status: referenceWalletStatus(coupon, now) }));
  const count = (status: WalletStatus) => rows.filter(row => row.status === status).length;
  const available = count("unused"), used = count("used"), points = count("points");
  const couponCount = rows.filter(row => row.status !== "points").length;
  const demoCount = coupons.filter(coupon => coupon.demo).length;
  const visible = rows.filter(row => filter === "all" || row.status === filter);
  const historyFilter = filter === "used" || filter === "expired" || filter === "upcoming";
  const emptyTitle = filter === "points" ? "还没有积分记录"
    : filter === "used" || filter === "expired" ? "这里空空如也"
    : filter === "upcoming" ? "暂无未生效的奖励"
    : coupons.length ? "暂无待使用的奖励" : "第一张发现卡，等你去寻找";
  const emptyDescription = filter === "used" ? "暂无核销记录，使用过的奖励会在这里留下记录。"
    : filter === "expired" ? "暂无到期奖励，超过有效期的奖励会显示在这里。"
    : filter === "upcoming" ? "暂无等待生效的奖励，可在全部奖励中查看已有记录。"
    : filter === "points" ? "完成带积分奖励的任务后，这里会记录每次发现。"
    : "跟着一条线索出发，成功领取后奖励就会保存在这里。";
  const tabs: { value: ReferenceWalletFilter; label: string }[] = [
    { value: "all", label: "全部" }, { value: "unused", label: "待使用" },
    { value: "used", label: "已使用" }, { value: "expired", label: "已过期" },
    ...(count("upcoming") ? [{ value: "upcoming" as const, label: "未生效" }] : []),
  ];

  return <section className="reference-wallet" aria-label="我的卡包">
    <div className="simple-header">
      <div><p className="eyebrow">COLLECTION</p><h2>我的卡包</h2></div>
      <span className="count-pill">{coupons.length} 份奖励</span>
    </div>
    <section className="pack-hero" aria-label="卡包奖励概览">
      <div><p>{demoCount ? "卡包共有" : "已经收集"}</p><strong>{coupons.length} 份</strong></div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${couponCount ? available / couponCount * 100 : 0}%` }} /></div>
      <small>待使用 {available} 张 · 已使用 {used} 张 · 积分记录 {points} 份</small>
      {demoCount > 0 && <small>包含 {demoCount} 张功能展示券，不计入寻宝记录</small>}
    </section>
    <div className="pack-type-tabs" aria-label="奖励类型">
      <button type="button" className={filter !== "points" ? "active" : ""} aria-pressed={filter !== "points"} onClick={() => onFilter("all")}>奖励卡牌</button>
      <button type="button" className={filter === "points" ? "active" : ""} aria-pressed={filter === "points"} onClick={() => onFilter("points")}>积分记录{points > 0 ? ` · ${points}` : ""}</button>
    </div>
    <div className="filter-row" aria-label="奖励状态筛选">
      {tabs.map(tab => <button key={tab.value} type="button" className={filter === tab.value ? "active" : ""} aria-pressed={filter === tab.value} onClick={() => onFilter(tab.value)}>{tab.label}</button>)}
    </div>
    <p className="flip-hint">{filter === "points" ? "积分已记入账户，点击查看本次发现" : "点击奖励卡查看真实券码与使用条件"}</p>
    <section className="card-grid">
      {visible.map(({ coupon, status }) => {
        const artwork = Number.isInteger(coupon.artwork) ? ((coupon.artwork % styles.length) + styles.length) % styles.length : 0;
        const pointsReward = status === "points";
        const canShowCode = !pointsReward && !!coupon.code.trim();
        const actionLabel = canShowCode ? "查看券码" : "查看发现卡";
        return <button
          key={coupon.id}
          type="button"
          className={`coupon-card${status === "used" ? " used" : status === "expired" ? " wallet-expired" : ""}`}
          aria-label={`查看${coupon.demo ? "功能展示券" : "发现卡"}：${coupon.storeName} · ${coupon.reward}`}
          onClick={event => onOpen(coupon, event.currentTarget)}
        >
          <span className="coupon-card-inner">
            <span className={`collect-card coupon-front ${pointsReward ? "coin-card" : styles[artwork]}`}>
              <span className="rarity">{coupon.demo ? `展示券 · ${labels[status]}` : labels[status]}</span>
              <span className="coupon-brand-icon">{coupon.imageURL ? <StoreImage imageURL={coupon.imageURL} artwork={coupon.artwork} alt={coupon.storeName} className="wallet-store-image" /> : pointsReward ? <Coins size={28} /> : <Sparkles size={28} />}</span>
              <span className="coupon-details coupon-body">
                <small>{coupon.storeName}</small>
                <b>{coupon.reward}</b>
                <em>{pointsReward ? "积分已记账，无需核销" : coupon.conditions}</em>
                {coupon.validEnd != null && !pointsReward && <em>有效期至 {dateLabel(coupon.validEnd)}</em>}
                {status === "upcoming" && coupon.validStart != null && <em>{dateLabel(coupon.validStart)} 生效</em>}
              </span>
              <span className="coupon-action">{actionLabel}<ArrowRight size={13} /></span>
            </span>
          </span>
        </button>;
      })}
    </section>
    {!visible.length && <div className="reference-wallet-empty" role="status">
      {filter === "points" ? <Coins size={30} aria-hidden="true" /> : <Ticket size={30} aria-hidden="true" />}
      <h3>{emptyTitle}</h3>
      <p>{emptyDescription}</p>
      {historyFilter ? coupons.length > 0 && <button type="button" className="primary-button" onClick={() => onFilter("all")}>查看全部奖励<ArrowRight size={17} /></button>
        : <button type="button" className="primary-button" onClick={onExplore}>{filter === "points" ? "寻找积分任务" : "去寻宝"}<ArrowRight size={17} /></button>}
    </div>}
  </section>;
}
