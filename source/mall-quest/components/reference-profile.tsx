"use client";

import { ArrowRight, Compass, Footprints, HelpCircle, NotebookPen, Settings2, Ticket, UserPlus } from "lucide-react";
import type { GameState, Page, Role } from "@/lib/game-types";

export type ReferenceProfileProps = {
  game: GameState;
  role: Role;
  badges: number;
  visitedStoreCount: number;
  onNavigate: (page: Page) => void;
  onHelp: () => void;
  onSettings: () => void;
  onLogin: () => void;
  onLogout: () => void | Promise<unknown>;
  onSwitchRole: (role: Role) => void;
  onInvite?: () => void;
  onContribution?: () => void;
  busy?: boolean;
};

/** The reference Profile composition, populated only by existing player records. */
export function ReferenceProfile({
  game, role, badges, visitedStoreCount, onNavigate, onHelp, onSettings,
  onLogin, onLogout, onSwitchRole, onInvite, onContribution, busy = false,
}: ReferenceProfileProps) {
  const player = game.player;
  const points = Number.isFinite(player.points) ? player.points! : 0;
  const level = Number.isFinite(player.level) ? player.level! : 1;
  const nickname = player.nickname || "探索者";
  const earnedPoints = player.earnedPoints;
  const growthKnown = typeof earnedPoints === "number" && Number.isFinite(earnedPoints);
  const growthProgress = growthKnown ? Math.max(0, Math.min(100, earnedPoints - (level - 1) * 100)) : 0;
  const growthRemaining = growthKnown ? Math.max(0, level * 100 - earnedPoints) : 0;
  const menu = [
    { label: "我的足迹", icon: Footprints, action: () => onNavigate("footprint") },
    { label: "我的投放", icon: NotebookPen, action: onContribution || (() => onNavigate("placements")) },
    { label: "玩法帮助", icon: HelpCircle, action: onHelp },
    { label: "体验设置", icon: Settings2, action: onSettings },
    { label: "附近门店", icon: Compass, action: () => onNavigate("geofence") },
    ...(onInvite ? [{ label: "邀请好友", icon: UserPlus, action: onInvite }] : []),
  ];

  return <section className="reference-profile" aria-label="我的探索账户">
    <section className="profile-hero">
      <div className="profile-avatar">
        {Array.from(nickname)[0] || <Compass size={30} />}
        {player.authenticated && <span aria-hidden="true" />}
      </div>
      <h2>{nickname}</h2>
      <p>{role === "hunter" ? "寻宝者" : "探索者"} · {player.authenticated ? player.username || player.phoneMasked || "已登录账户" : "尚未登录"}</p>
      <div className="profile-stats">
        <button type="button" onClick={() => onNavigate(role === "hunter" ? "footprint" : "placements")}>
          <b>{role === "hunter" ? visitedStoreCount : game.placements.length}</b>
          <span>{role === "hunter" ? "发现门店" : "我的投放"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("wallet")}>
          <b>{points.toLocaleString("zh-CN")}</b><span>可用积分</span>
        </button>
        <div><b>{badges}</b><span>已得徽章</span></div>
      </div>
      <div className="pack-type-tabs profile-role-toggle" aria-label="切换探索角色">
        <button type="button" className={role === "hunter" ? "active" : ""} aria-pressed={role === "hunter"} disabled={busy} onClick={() => onSwitchRole("hunter")}>寻宝者</button>
        <button type="button" className={role === "explorer" ? "active" : ""} aria-pressed={role === "explorer"} disabled={busy} onClick={() => onSwitchRole("explorer")}>探索者</button>
      </div>
    </section>
    <button type="button" className="achievement" aria-label={`打开成就中心，探索等级 Lv.${level}`} onClick={() => onNavigate("achievements")}>
      <div className="achievement-top">
        <div><p className="eyebrow">NEXT LEVEL</p><h3>成就中心 · Lv.{level}</h3></div>
        <strong>{growthKnown ? `${Math.round(growthProgress)}%` : "待同步"}</strong>
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${growthProgress}%` }} /></div>
      <p>{growthKnown ? `距离 Lv.${level + 1} 还需 ${growthRemaining} 成长积分` : "成长进度等待同步"} · 累计贡献 {game.contribution} 积分</p>
      <span className="achievement-arrow"><ArrowRight size={17} /></span>
    </button>
    <button type="button" className="store-entry" onClick={() => onNavigate("wallet")}>
      <span><Ticket size={22} /></span>
      <div><b>我的卡包</b><small>{game.coupons.filter(coupon => !coupon.demo).length} 份寻宝奖励与积分记录{game.coupons.some(coupon => coupon.demo) ? " · 含功能展示券" : ""}</small></div>
      <ArrowRight size={18} />
    </button>
    <section className="menu-list" aria-label="探索账户功能">
      {menu.map(({ label, icon: Icon, action }, index) => <button key={label} type="button" onClick={action}>
        <span className={`menu-icon menu-${index % 4}`}><Icon size={19} /></span>
        <b>{label}</b><ArrowRight size={17} />
      </button>)}
      <button type="button" onClick={() => onNavigate("entry")}>
        <span className="menu-icon menu-3"><Compass size={19} /></span>
        <b>返回角色入口</b><ArrowRight size={17} />
      </button>
    </section>
    <button type="button" className={`logout${player.authenticated ? "" : " profile-login"}`} disabled={busy} onClick={player.authenticated ? () => void onLogout() : onLogin}>
      {player.authenticated ? "退出登录" : "登录探索账号"}
    </button>
  </section>;
}
