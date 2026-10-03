"use client";
import { useState } from "react";
import { Copy, Compass, HelpCircle, Search, Sparkles } from "lucide-react";
import type { ExperiencePreferences } from "@/hooks/use-experience-preferences";
import type { GameState } from "@/lib/game-types";
import { Empty } from "./common/Empty";
import "./help-center.css";
import "./invitation-content.css";
import "./experience-settings.css";

const questions = [
  { group: "寻宝", question: "必须买东西才能完成寻宝吗？", answer: "寻宝本身不要求购买。登录玩家账号后，硬件任务通过 NFC 打开领取入口，到店通过范围校验后保存待领申请；商家扫描金币设备码、核对玩家并收到实物金币，确认后奖励进入卡包。独立网页任务仍需通过到店范围校验并答对观察题领奖。奖励的使用可能有消费门槛，参与前请查看任务条件；你可以只玩一站，也可以随时换任务。" },
  { group: "寻宝", question: "五条线索如何解锁？", answer: "每条线索会显示当前解锁费用，免费线索可直接查看。付费线索由后端扣除积分并保存解锁记录，同一条已解锁线索不会重复扣费；余额不足时可先尝试免费线索。" },
  { group: "寻宝", question: "观察答案不对，怎么办？", answer: "答错不会发券，输入会保留。再看看现场细节和任务线索；首次试玩也可以查看“试玩说明”中的观察答案。领取无需到店验证码，短时间连续尝试会暂缓验证。" },
  { group: "奖励", question: "同一家店的不同任务可以重复领奖吗？", answer: "同一玩家在同一活动、同一门店只能领取一次。换一道谜题也不会再占库存，已有券会继续显示在你的卡包中。" },
  { group: "奖励", question: "这些优惠券能在真实门店用吗？", answer: "不能。当前门店与权益用于比赛演示，卡包和发现卡均标注模拟权益。发现卡图片不含券码，核销时请在卡包查看奖励码。" },
  { group: "奖励", question: "任务下架后，已经领到的券会消失吗？", answer: "下架后停止新领奖，已经领到的模拟券仍保留。未过期、未核销的券可由对应门店的商家演示账号核销一次；券的有效期和领取时保存的条件以卡包为准。" },
  { group: "创作", question: "为什么我的投稿没有出现在地图上？", answer: "只有已发布且未到期的任务会公开。可在“我的投放”查看审核状态和修改建议，退回后可以复制内容重新投稿；投稿额度和是否需要人工审核由当前活动配置。" },
  { group: "创作", question: "可以领取自己创作的任务奖励吗？", answer: "作者不能领取自己任务的奖励。可以邀请朋友体验；他们成功领奖后，贡献积分按任务奖励和当前系统系数计算，以后端记录为准，重复打开原奖励不会再次加分。" },
  { group: "使用", question: "切换角色或刷新后，记录还在吗？", answer: "寻宝者和探索者共用一个玩家账号，注册后用用户名和密码登录，切换角色或刷新会读取该账号的记录。注册时可以保留当前尚未绑定账号的浏览身份记录；登录已有账号时使用该账号记录，不自动合并其他身份的券。商家和运营各自注册并经运营审核后登录，不能使用玩家账号互相登录。退出不会删除账号记录。" },
  { group: "使用", question: "怎么邀请朋友、保存发现卡？", answer: "从个人中心复制邀请文案与链接，或在发现卡中复制谜题链接、下载图片，再通过聊天工具发送。成就只统计站内生成分享，同任务每天一次，不代表第三方发送成功；没有邀请带新积分或人数归因。" },
  { group: "使用", question: "朋友打不开我分享的本机链接怎么办？", answer: "127.0.0.1和localhost只能在运行网站的电脑上使用。朋友需要同一局域网的访问地址或已发布的网站网址；演示前先确认链接能打开。" },
];

export function HelpCenter({ onDemo, game }: { onDemo: () => void; game?: GameState }) {
  const [search, setSearch] = useState(""), [group, setGroup] = useState("全部");
  const matches = questions.filter(q => (group === "全部" || q.group === group) && `${q.question}${q.answer}`.includes(search.trim()));
  return <section className="surface help-center">
    <div className="help-center-top">
      <div><span className="pill gold"><HelpCircle size={14} /> 玩法帮助</span><h2>遇到疑问，先看看这里</h2>{game && <p className="muted">本次投稿剩余额度以“我的投放”和投稿页显示为准。</p>}</div>
      <button className="outline-button" onClick={onDemo}><Compass size={16} /> 查看试玩点位牌</button>
    </div>
    <label className="search-field faq-search"><Search size={17} /><input aria-label="搜索常见问题" placeholder="搜索线索、领券、投稿…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></label>
    <div className="tabs faq-filters" aria-label="帮助分类">{["全部", "寻宝", "奖励", "创作", "使用"].map(value => <button key={value} className={group === value ? "active" : ""} aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</button>)}</div>
    <div className="faq-list">{matches.map(q => <details key={q.question}><summary>{q.question}<span aria-hidden="true">＋</span></summary><p>{q.answer}</p></details>)}</div>
    {!matches.length && <Empty icon={Search} title="没有找到相关问题" body="换个关键词，或清除筛选再看看。" action={<button className="text-button" onClick={() => {setSearch(""); setGroup("全部");}}>清除筛选</button>} />}
  </section>;
}

export function ExperienceSettings({ preferences, onChange, ready }: {
  preferences: ExperiencePreferences;
  onChange: (value: ExperiencePreferences) => void;
  ready: boolean;
}) {
  return <section className="surface experience-settings">
    <span className="pill gold"><Sparkles size={14} /> 按你的节奏探索</span>
    <h2>让体验更适合你</h2><p className="muted">偏好保存在当前浏览器，刷新后保留。</p>
    <div className="preference-row">
      <div><h3 id="pref-theme">显示主题</h3><p>选择浅色或深色页面。</p></div>
      <div className="preference-theme" aria-labelledby="pref-theme">
        {([ ["light", "浅色"], ["dark", "深色"] ] as const).map(([value, label]) => <button className="outline-button" key={value} disabled={!ready} aria-pressed={preferences.theme === value} onClick={() => onChange({ ...preferences, theme: value })}>{label}</button>)}
      </div>
    </div>
    {([
      ["sound", "领奖音效", "新奖励保存成功时播放短音；打开已有奖励或失败时不播放，浏览器可能限制声音。"],
      ["vibrate", "振动反馈", "新奖励保存成功时短振动，仅支持此能力的设备会响应。"],
      ["notify", "页面消息提示", "控制可选页面提醒；必要操作反馈仍保留。此开关不启用浏览器推送或后台通知。"],
      ["reduceMotion", "减弱动效", "减少地图光圈和界面过渡；同时尊重系统的减弱动态效果设置。"],
      ["showExploreTips", "显示探索提示", "在地图下方显示玩法提示，奖励条件始终可查看。"],
    ] as const).map(([key, title, description]) => <div className="preference-row" key={key}>
      <div><h3 id={`pref-${key}`}>{title}</h3><p id={`pref-${key}-description`}>{description}</p></div>
      <button className={`preference-switch ${preferences[key] ? "on" : ""}`} role="switch" aria-labelledby={`pref-${key}`} aria-describedby={`pref-${key}-description`} aria-checked={preferences[key]} disabled={!ready} onClick={() => onChange({ ...preferences, [key]: !preferences[key] })}><span /></button>
    </div>)}
  </section>;
}

export function InvitationContent({ link, onCopy }: { link: string; onCopy: (text: string) => void }) {
  const invitation = `一起花15分钟逛道宝：跟着线索发现隐藏小店，收集一张发现卡。可只玩一站，模拟权益不用于真实消费。\n${link}`;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(link);
  return <div className="invitation-content">
    <div className="invite-emblem"><Compass size={36} /></div><h3>下一次发现，和朋友一起</h3>
    <p className="muted">复制后发到你常用的聊天工具。朋友会使用各自的玩家账号，完成记录独立保存。</p>
    <label className="field-label">邀请文案与链接<textarea aria-label="邀请文案与链接" readOnly value={invitation} rows={5} onFocus={e => e.target.select()} /></label>
    {local && <p className="invitation-local-note">当前是本机试玩链接，朋友需使用可访问的局域网地址或线上网址。</p>}
    <button className="gold-button full" onClick={() => onCopy(invitation)}><Copy size={16} /> 复制邀请文案与链接</button>
  </div>;
}
