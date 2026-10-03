"use client";

import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeft, Check, Coins, Compass, MapPin, Trophy } from "lucide-react";
import type { GameState } from "@/lib/game-types";

export type ReferenceLevelCenterProps = {
  game: GameState;
  now: number;
  onBack: () => void;
};

const DAY = 86_400_000;
const SHANGHAI_OFFSET = 28_800_000;
const LEVEL_POINTS = 100;
const DISCOVERY_ACHIEVEMENTS = new Set(["a1", "a2", "a3", "a5"]);
const NODE_X = [34, 138, 242, 346, 450, 554, 658, 762, 866, 926];
const TRACK_PATH = "M34 112C95 112 98 70 160 79s82 48 142 18 80-58 143-29 72 62 138 26 78-58 137-25 77 61 139 18 76-43 107-43";
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const ratio = (value: number | null, target: number | null) => value !== null && target !== null && target > 0 ? clamp(value / target * 100) : 0;
const amount = (value: number | null) => value === null ? "—" : value.toLocaleString("zh-CN");

export function levelCenterData(game: GameState, now: number) {
  const discoveriesOnly = game.coupons.filter(coupon => !coupon.demo);
  const level = Math.max(1, Math.floor(game.player.level || 1));
  const rawEarned = game.player.earnedPoints;
  const earned = typeof rawEarned === "number" && Number.isFinite(rawEarned) && rawEarned >= 0 ? rawEarned : null;
  const nextLevelTarget = level * LEVEL_POINTS;
  const levelProgress = earned === null ? null : clamp((earned - (level - 1) * LEVEL_POINTS) / LEVEL_POINTS * 100);
  const discoveries = discoveriesOnly.length;
  const targets = (game.achievements || [])
    .filter(achievement => DISCOVERY_ACHIEVEMENTS.has(achievement.id) && achievement.target > 0)
    .map(achievement => achievement.target)
    .sort((a, b) => a - b);
  const nextDiscoveryTarget = targets.find(target => target > discoveries) ?? null;
  const discoveryTarget = nextDiscoveryTarget ?? targets[targets.length - 1] ?? null;
  const unlockedBadges = game.achievements ? game.achievements.filter(achievement => achievement.unlocked).length : null;
  const badgeTarget = game.achievements ? game.achievements.length : null;
  const storeIds = new Set(game.stores.map(store => store.id));
  const discoveredStores = new Set(discoveriesOnly.map(coupon => coupon.storeId).filter(id => storeIds.has(id))).size;
  const todayStart = Math.floor((now + SHANGHAI_OFFSET) / DAY) * DAY - SHANGHAI_OFFSET;
  const weekStart = todayStart - 6 * DAY;
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "narrow" });
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });
  const activity = Array.from({ length: 7 }, (_, index) => ({
    timestamp: weekStart + index * DAY,
    weekday: weekday.format(weekStart + index * DAY),
    date: dateLabel.format(weekStart + index * DAY),
    count: 0,
  }));
  for (const coupon of discoveriesOnly) {
    if (!Number.isFinite(coupon.issuedAt)) continue;
    const index = Math.floor((coupon.issuedAt - weekStart) / DAY);
    if (index >= 0 && index < activity.length) activity[index].count++;
  }
  return {
    level, earned, nextLevelTarget, levelProgress,
    discoveries, discoveryTarget, nextDiscoveryTarget,
    unlockedBadges, badgeTarget, discoveredStores, storeTarget: storeIds.size,
    activity,
    activityTotal: activity.reduce((total, day) => total + day.count, 0),
    activityPeak: Math.max(0, ...activity.map(day => day.count)),
  };
}

export function ReferenceLevelCenter({ game, now, onBack }: ReferenceLevelCenterProps) {
  const data = levelCenterData(game, now);
  const firstLevel = Math.max(1, data.level - 7);
  const levels = Array.from({ length: 10 }, (_, index) => firstLevel + index);
  const currentIndex = data.level - firstLevel;
  const completeX = NODE_X[currentIndex] + ((NODE_X[currentIndex + 1] ?? NODE_X[currentIndex]) - NODE_X[currentIndex]) * (data.levelProgress || 0) / 100;
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `level-curve-${generatedId}`;
  const hintId = `level-hint-${generatedId}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, pointerId: -1, startX: 0, scrollLeft: 0 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const alignCurrent = () => {
      const node = element.querySelector<HTMLElement>("[data-current='true']");
      if (!node || drag.current.active) return;
      const previousBehavior = element.style.scrollBehavior;
      element.style.scrollBehavior = "auto";
      element.scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, node.offsetLeft - element.clientWidth / 2));
      element.style.scrollBehavior = previousBehavior;
    };
    const scheduleAlign = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(alignCurrent);
    };
    scheduleAlign();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleAlign) : null;
    observer?.observe(element);
    window.addEventListener("resize", scheduleAlign);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleAlign);
      window.cancelAnimationFrame(frame);
    };
  }, [data.level, firstLevel]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    drag.current = { active: true, pointerId: event.pointerId, startX: event.clientX, scrollLeft: target.scrollLeft };
    target.setPointerCapture(event.pointerId);
    target.classList.add("dragging");
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current.active && drag.current.pointerId === event.pointerId) {
      event.currentTarget.scrollLeft = drag.current.scrollLeft - (event.clientX - drag.current.startX);
    }
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current.pointerId !== event.pointerId) return;
    drag.current.active = false;
    drag.current.pointerId = -1;
    event.currentTarget.classList.remove("dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const left = event.key === "ArrowLeft" ? target.scrollLeft - 104
      : event.key === "ArrowRight" ? target.scrollLeft + 104
      : event.key === "Home" ? 0
      : event.key === "End" ? target.scrollWidth - target.clientWidth
      : null;
    if (left === null) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !!target.closest("[data-reduce-motion]");
    target.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
  }

  const metrics = [
    { key: "discoveries", tone: "green", icon: Compass, value: data.discoveries, target: data.discoveryTarget, label: "发现宝藏", note: data.discoveryTarget === null ? "下一目标待同步" : data.nextDiscoveryTarget === null ? "已达成已定义的最高发现目标" : `下一发现目标：${data.discoveryTarget}次` },
    { key: "badges", tone: "amber", icon: Trophy, value: data.unlockedBadges, target: data.badgeTarget, label: "已获得徽章", note: data.badgeTarget === null ? "成就记录待同步" : `当前活动共${data.badgeTarget}枚` },
    { key: "points", tone: "blue", icon: Coins, value: data.earned, target: data.nextLevelTarget, label: "累计成长积分", note: `Lv.${data.level + 1}门槛：${amount(data.nextLevelTarget)}积分` },
    { key: "stores", tone: "purple", icon: MapPin, value: data.discoveredStores, target: data.storeTarget, label: "已发现门店", note: "依据当前门店的实际领奖记录" },
  ];

  return (
    <div className="reference-level-center">
      <header className="level-header">
        <button className="back-button" onClick={onBack} aria-label="返回我的" type="button"><ArrowLeft size={21} /></button>
        <div><p className="eyebrow">LEVEL CENTER</p><h1>成就中心</h1></div>
        <span className="level-badge">Lv.{data.level}</span>
      </header>
      <section className="level-journey" aria-label="等级成长轨迹">
        <div className="journey-heading">
          <div><small>当前等级</small><h3>Lv.{data.level}</h3></div>
          <span>{data.earned === null ? "累计成长积分待同步" : `${amount(data.earned)} / ${amount(data.nextLevelTarget)} 成长积分`}</span>
        </div>
        <div
          aria-label={`等级轨迹，Lv.${firstLevel}至Lv.${firstLevel + 9}，当前Lv.${data.level}`}
          aria-describedby={hintId}
          className="level-track-scroll"
          ref={scrollRef}
          role="region"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKeyDown}
        >
          <div className="level-track" role="list">
            <svg viewBox="0 0 940 170" preserveAspectRatio="none" aria-hidden="true">
              <defs><clipPath id={clipId}><rect x="0" y="0" width={completeX} height="170" /></clipPath></defs>
              <path d={TRACK_PATH} />
              <path className="track-complete" d={TRACK_PATH} clipPath={`url(#${clipId})`} />
            </svg>
            {levels.map((level, index) => (
              <div
                key={level}
                className={`level-node ${level < data.level ? "passed" : level === data.level ? "current" : "future"} node-${index + 1}`}
                data-current={level === data.level}
                role="listitem"
                aria-current={level === data.level ? "step" : undefined}
                aria-label={`Lv.${level}，${level < data.level ? "已达成" : level === data.level ? "当前等级" : "尚未达到"}`}
              >
                <span>{level < data.level ? <Check size={14} /> : level}</span>
                <b>Lv.{level}</b>
                {level === data.level && <small>当前位置</small>}
              </div>
            ))}
          </div>
        </div>
        <p className="track-swipe-hint" id={hintId}><span>←</span>左右滑动查看等级轨迹<span>→</span><span className="level-keyboard-hint">键盘左右 / Home / End</span></p>
        <div className="level-progress-copy">
          <span>{data.earned === null ? "等级进度待同步" : `距离 Lv.${data.level + 1} 还需 ${amount(Math.max(0, data.nextLevelTarget - data.earned))} 成长积分`}</span>
          <b>{data.levelProgress === null ? "—" : `${Math.round(data.levelProgress)}%`}</b>
        </div>
        <div className="progress level-progress" role="progressbar" aria-label="下一等级进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.levelProgress === null ? undefined : Math.round(data.levelProgress)} aria-valuetext={data.levelProgress === null ? "待同步" : undefined}>
          <span style={{ width: `${data.levelProgress ?? 0}%` }} />
        </div>
      </section>
      <section className="data-section">
        <div className="section-heading"><div><p className="eyebrow">YOUR DATA</p><h3>探索数据</h3></div><span className="data-period">累计</span></div>
        <div className="data-grid">
          {metrics.map(metric => {
            const water = ratio(metric.value, metric.target);
            return <article key={metric.key} aria-label={`${metric.label}：${amount(metric.value)}${metric.target === null ? "" : ` / ${amount(metric.target)}`}，${metric.note}`}>
              <span className={`data-water water-${metric.tone}`} style={{ "--water-level": `${water}%` } as CSSProperties} data-empty={water === 0} aria-hidden="true"><i /></span>
              <span className={`data-icon ${metric.tone}`} aria-hidden="true"><metric.icon size={20} /></span>
              <strong>{amount(metric.value)}{metric.target !== null && <span className="data-target"> / {amount(metric.target)}</span>}</strong>
              <small>{metric.label}</small>
              <span className="data-note">{metric.note}</span>
            </article>;
          })}
        </div>
        <p className="level-data-note">成长积分按累计获得计算，消费积分不降低等级；水位表示各自目标的完成比例。</p>
      </section>
      <section className="activity-card">
        <div className="activity-heading"><div><p className="eyebrow">ACTIVITY</p><h3>近7日寻宝记录</h3></div><strong>{data.activityTotal} 次</strong></div>
        <div className="activity-chart" role="list" aria-label="近七个北京时间自然日领奖次数">
          {data.activity.map(day => (
            <div key={day.timestamp} role="listitem" aria-label={`${day.date}：${day.count}次领奖`} title={`${day.date}：${day.count}次领奖`}>
              <span style={{ height: `${data.activityPeak ? day.count / data.activityPeak * 100 : 0}%` }} data-count={day.count} data-empty={day.count === 0} aria-hidden="true" />
              <small>{day.weekday}</small>
            </div>
          ))}
        </div>
        <p className="level-data-note">{data.activity[0].date}—{data.activity[6].date} · 按北京时间的实际领奖时间统计。</p>
      </section>
    </div>
  );
}
