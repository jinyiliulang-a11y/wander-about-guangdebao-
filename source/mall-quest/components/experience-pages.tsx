"use client";
import {
  ArrowRight,
  Compass,
  PenLine,
  LayoutDashboard,
  MapPin,
  CheckCircle2,
  Trophy,
  Sparkles,
  Map as MapIcon,
  Ticket,
  Footprints,
  ShieldCheck,
} from "lucide-react";
import type { Footprint, GameState, Page } from "@/lib/game-types";
import { Empty } from "./common/Empty";

export function EntryScreen({
  onEnter,
  ready,
  error,
  onRetry,
  theme = "light",
}: {
  onEnter: (page: Page) => void;
  ready: boolean;
  error: string;
  onRetry: () => void;
  theme?: "light" | "dark";
}) {
  return (
    <main className="entry-screen client-shell" data-client-theme={theme}>
      <header className="entry-header">
        <span className="brand-symbol">
          <Compass size={25} />
        </span>
        <strong>逛道宝<small className="brand-english">wander about</small></strong>
        <span className="pill">星光里 · 演示商场</span>
      </header>
      <section className="entry-content">
        <span className="eyebrow">PICK YOUR NEXT DISCOVERY</span>
        <h1>今天，你想怎样探索？</h1>
        <p>寻找一个惊喜，或把自己的发现留给别人。</p>
        <div className="entry-cards">
          {[
            {
              page: "map" as const,
              number: "01",
              title: "寻宝者",
              subtitle: "跟着线索，发现小店",
              description: "打开地图 · 解开谜题 · 收集奖励",
              action: "开始寻宝",
              icon: Compass,
              className: "hunter",
            },
            {
              page: "placements" as const,
              number: "02",
              title: "探索者",
              subtitle: "把你的发现，藏成宝藏",
              description: "选择店铺 · 创作线索 · 看见回响",
              action: "去创作",
              icon: PenLine,
              className: "explorer",
            },
            {
              page: "merchant" as const,
              number: "03",
              title: "商家端",
              subtitle: "让一次发现，成为一次相遇",
              description: "活动记录 · 奖励库存 · 优惠券核销",
              action: "进入工作台",
              icon: LayoutDashboard,
              className: "merchant",
            },
            {
              page: "staff" as const,
              number: "04",
              title: "运营端",
              subtitle: "让每条线索都值得探索",
              description: "内容审核 · 优质推荐 · 平台统计",
              action: "运营审核入口",
              icon: ShieldCheck,
              className: "staff",
            },
          ].map((item) => (
            <button
              key={item.page}
              className={`entry-card ${item.className}`}
              onClick={() => onEnter(item.page)}
              aria-label={item.action}
              disabled={!ready}
            >
              <span className="entry-card-number">{item.number}</span>
              <span className="entry-card-icon">
                <item.icon size={38} />
              </span>
              <h2>{item.title}</h2>
              <strong>{item.subtitle}</strong>
              <p>{item.description}</p>
              <span className="entry-card-action">
                {item.action}
                <ArrowRight size={18} />
              </span>
            </button>
          ))}
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={onRetry}>
              重新连接
            </button>
          </div>
        )}
        {!ready && !error && (
          <p className="muted" role="status">
            正在准备你的探索身份…
          </p>
        )}
        <div className="entry-note">
          <span>
            <Sparkles size={16} />
            寻宝者与探索者共用同一个身份，随时切换。
          </span>
          <small>模拟门店与权益 · 找到金币，碰一碰或扫码答题领奖</small>
        </div>
      </section>
    </main>
  );
}

export function getAchievements(game: GameState) {
  const discoveryCoupons = game.coupons.filter(coupon => !coupon.demo);
  if (game.achievements) {
    const icons = { Compass, Trophy, Sparkles, Footprints, MapPin, PenLine, Map: MapIcon, Ticket, ShieldCheck, "🌱": Compass, "🗺️": MapIcon, "🏆": Trophy, "🔥": Sparkles, "👑": Trophy, "📣": Sparkles };
    return game.achievements.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      description: achievement.desc,
      icon: icons[achievement.icon as keyof typeof icons] || Trophy,
      progress: achievement.progress,
      target: achievement.target,
      reward: achievement.reward,
      unlocked: achievement.unlocked,
    }));
  }
  const floors = new Set(
    discoveryCoupons
      .map((c) => game.stores.find((s) => s.id === c.storeId)?.floor)
      .filter(Boolean),
  );
  return [
    {
      id: "first",
      title: "第一份惊喜",
      description: "完成一次寻宝领奖",
      icon: Compass,
      progress: discoveryCoupons.length,
      target: 1,
    },
    {
      id: "roamer",
      title: "周末漫游者",
      description: "发现三家不同门店",
      icon: MapIcon,
      progress: discoveryCoupons.length,
      target: 3,
    },
    {
      id: "floors",
      title: "跨层探险家",
      description: "在两个楼层收集奖励",
      icon: Footprints,
      progress: floors.size,
      target: 2,
    },
    {
      id: "creator",
      title: "线索创作者",
      description: "提交第一条宝藏任务",
      icon: PenLine,
      progress: game.placements.length,
      target: 1,
    },
    {
      id: "guide",
      title: "发现引路人",
      description: "有一位玩家通过你的线索领奖",
      icon: Sparkles,
      progress: game.placements.reduce((n, t) => n + (t.claimedCount || 0), 0),
      target: 1,
    },
  ].map((achievement) => ({ ...achievement, reward: 0, unlocked: achievement.progress >= achievement.target }));
}

export function AchievementPage({ game, compact = false }: { game: GameState; compact?: boolean }) {
  const achievements = getAchievements(game);
  const unlocked = achievements.filter((a) => a.unlocked);
  const progress = achievements.length ? Math.round((unlocked.length / achievements.length) * 100) : 0;
  const tones = ["green", "amber", "blue", "rose", "purple"];
  return (
    <div className="journey-page reference-achievements">
      {!compact && <section className="achievement-summary badge-summary">
        <div className="badge-ring" role="img" aria-label={`已解锁${unlocked.length}枚，共${achievements.length}枚徽章`}>
          <strong>{unlocked.length}</strong>
          <span>/ {achievements.length}</span>
        </div>
        <div>
          <p className="eyebrow">BADGE PROGRESS</p>
          <h3>每一次发现，都有回响</h3>
          <small>已解锁 {unlocked.length} / {achievements.length} 枚徽章 · {progress}%</small>
          <progress value={unlocked.length} max={achievements.length || 1} aria-label="总成就进度" />
        </div>
      </section>}
      {[
        { title: "已解锁", items: unlocked },
        {
          title: "下一份惊喜",
          items: achievements.filter((a) => !a.unlocked),
        },
      ].map((section) => (
        <section key={section.title} className="achievement-section">
          <h2>
            {section.title}
            <small>{section.items.length} 枚</small>
          </h2>
          <div className="achievement-grid badge-grid">
            {section.items.map((a, index) => {
              const done = a.unlocked;
              return (
                <article
                  className={`surface achievement-tile badge-card ${done ? "done" : "locked"}`}
                  key={a.id}
                  aria-label={`${a.title}，${done ? "已获得" : "未解锁"}`}
                >
                  <span className={`badge-medal ${tones[index % tones.length]}`}>
                    <a.icon size={27} />
                  </span>
                  <b role="heading" aria-level={3}>{a.title}</b>
                  <small>{a.description}</small>
                  <div className="achievement-progress">
                    <progress
                      value={Math.min(a.progress, a.target)}
                      max={a.target}
                      aria-label={`${a.title}进度`}
                    />
                    <small>{Math.min(a.progress, a.target)} / {a.target}</small>
                  </div>
                  {a.reward > 0 && <p className="achievement-reward">{done ? "已获得" : "达成可获得"} {a.reward} 积分</p>}
                  <em>{done && <CheckCircle2 size={11} />}{done ? "已获得" : "未解锁"}</em>
                </article>
              );
            })}
          </div>
          {!section.items.length && (
            <p className="muted">
              {section.title === "已解锁"
                ? "从地图上的第一条线索开始吧。"
                : "这轮徽章全部集齐，邀请朋友来创作吧。"}
            </p>
          )}
        </section>
      ))}
      <p className="muted records-note">{game.achievements ? "成就依据后端记录更新，达成奖励由服务端一次性记账。分享成就只统计站内生成分享，不代表已发送到第三方。" : "徽章依据实际演示记录更新。"}</p>
    </div>
  );
}

export function FootprintPage({
  game,
  onExplore,
}: {
  game: GameState;
  onExplore: () => void;
}) {
  const footprints: (Footprint & { reward?: string })[] = game.footprints || game.coupons.filter(coupon => !coupon.demo).map((coupon) => {
    const store = game.stores.find((item) => item.id === coupon.storeId);
    return { id: coupon.id, storeId: coupon.storeId, storeName: coupon.storeName, logo: store?.logo || "", floor: store?.floor || "", category: store?.category || "", visitedAt: coupon.issuedAt, coinsFound: 1, mall: "星光里购物中心", verified: false, reward: coupon.reward };
  });
  const groups = new Map<string, typeof footprints>();
  for (const footprint of [...footprints].sort((a, b) => b.visitedAt - a.visitedAt)) {
    const day = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(footprint.visitedAt);
    groups.set(day, [...(groups.get(day) || []), footprint]);
  }
  const timeline = [...groups].flatMap(([day, items]) => items.map(item => ({ day, item })));
  const discoveries = footprints.reduce((count, item) => count + item.coinsFound, 0);
  const tones = ["amber", "blue", "green", "rose", "purple"];
  return (
    <div className="journey-page reference-footprints">
      <div className="records-topline"><span className="eyebrow">MY JOURNEY</span><span className="footprint-total">共 {discoveries} 次发现</span></div>
      <section className="footprint-summary" aria-label="足迹统计">
        <div>
          <strong>{new Set(footprints.map((item) => item.mall)).size}</strong>
          <span>探索商场</span>
        </div>
        <div>
          <strong>{new Set(footprints.map((item) => item.storeId)).size}</strong>
          <span>发现门店</span>
        </div>
        <div>
          <strong>{groups.size}</strong>
          <span>探索日</span>
        </div>
      </section>
      {groups.size ? (
        <section className="footprint-timeline footprint-list" aria-label="领奖足迹">
          {timeline.map(({ day, item }, index) => (
            <article className="footprint-row" key={item.id}>
              <div className="timeline-axis" aria-hidden="true">
                <span className={index === 0 ? "latest" : ""}>{index === 0 && <i />}</span>
                {index < timeline.length - 1 && <div />}
              </div>
              <div className="footprint-content">
                <div className="footprint-date">
                  <b>{day}</b>
                  <time dateTime={new Date(item.visitedAt).toISOString()}>
                    {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(item.visitedAt)}
                  </time>
                </div>
                <div className="footprint-card surface">
                  <span className={`footprint-art ${tones[index % tones.length]}`} aria-hidden="true"><MapPin size={27} /></span>
                  <span className="footprint-copy">
                    <b role="heading" aria-level={3}>{item.storeName}</b>
                    <small><MapPin size={12} />{[item.floor, item.category, item.mall].filter(Boolean).join(" · ")}</small>
                    <em><Ticket size={11} />{item.reward || `${item.coinsFound} 次领奖记录`}</em>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <Empty icon={Footprints} title="第一段足迹，等你出发" body="完成一次寻宝领奖，这里就会留下你的发现。" action={<button className="gold-button" onClick={onExplore}>
            去寻宝
            <ArrowRight size={17} />
          </button>} />
      )}
      {timeline.length > 0 && <p className="journey-start">第一条领奖记录 · {timeline[timeline.length - 1].day}</p>}
      <p className="muted records-note">
        按后端领奖时间生成足迹，暂不代表真实定位或实际到店。
      </p>
    </div>
  );
}

export function ExplorerProgress({ game }: { game: GameState }) {
  const finds = game.placements.reduce((n, t) => n + (t.claimedCount || 0), 0);
  const quota = game.dailyQuota;
  const limit = quota?.limit ?? game.settings?.dailyLimit ?? 5;
  return (
    <section className="surface explorer-progress">
      <span className="journey-icon" aria-hidden="true">
        <PenLine size={27} />
      </span>
      <div className="explorer-progress-copy">
        <span className="pill gold">
          Lv.{game.player.level ?? 1} 探索者
        </span>
        <h2>你的线索，带来了 {finds} 次发现</h2>
        <p>积分余额 {game.player.points ?? 0} · 已获得贡献积分 {game.contribution}</p>
      </div>
      <div className="explorer-quota">
        <small>今日投稿</small>
        <strong>
          {quota?.used ?? "—"}
          <span> / {limit}</span>
        </strong>
        <small>{quota ? `剩余 ${quota.remaining} 次` : "额度由后端确认"}</small>
      </div>
    </section>
  );
}

export function WeeklyRanking({ game }: { game: GameState }) {
  const ranking = game.ranking || [];
  return <section className="surface weekly-ranking">
    <div className="section-heading"><h2><Trophy size={19} /> 本周发现榜</h2><span className="muted">当前活动近七天领奖</span></div>
    {ranking.length ? <ol>{ranking.map((entry) => <li key={entry.id} className={entry.isMe ? "is-me" : ""}>
      <strong className="ranking-position">{entry.rank}</strong>
      <span className="ranking-name">{entry.nickname}{entry.isMe && <small>我</small>}</span>
      <span>{entry.claims} 次发现<small>{entry.points} 积分</small></span>
    </li>)}</ol> : <p className="muted">本周还没有领奖记录，先去发现第一站吧。</p>}
    <p className="muted">只依据当前活动的领奖记录排序，不代表真实消费或到店次数。</p>
  </section>;
}
