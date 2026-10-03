import { Map, Coins, Users, ShieldCheck } from "lucide-react";

const capabilities = [
  {
    icon: Users,
    tag: "双角色体系",
    title: "探索者 × 寻宝者",
    desc: "首创双角色不互斥模式，用户自由切换身份，既是内容消费者也是生产者，形成 UGC 自循环。",
    points: ["探索者：挖掘冷门店铺，创作解谜线索", "寻宝者：地图解谜，到店扫码领券"],
  },
  {
    icon: Map,
    tag: "LBS 实景解谜",
    title: "模糊地图 + 分级线索",
    desc: "完整的探索流程具备更强的游戏感与仪式感，天然带动逛店路径延长，而非单点打卡即走。",
    points: ["地图获取大致区域", "逐步解锁线索缩小范围", "线下找到实体金币完成核销"],
  },
  {
    icon: Coins,
    tag: "权益激励绑定",
    title: "先寻宝 · 后得券",
    desc: "反转「先给券、再促到店」逻辑，优惠券设为寻宝成功奖励，到店行为从「任务」变为「目标」。",
    points: ["奖励精准绑定目标门店", "定向引流 → 到店核销 → 消费转化"],
  },
  {
    icon: ShieldCheck,
    tag: "三重校验",
    title: "保障真实到店",
    desc: "针对定位作弊、远程打卡问题，三重校验确保所有奖励发放均对应真实到店行为。",
    points: ["LBS 地理围栏初筛", "实体金币唯一二维码核验", "门店范围终验"],
  },
];

export default function Capabilities() {
  return (
    <section className="relative py-24 lg:py-32 bg-navy-950 text-cream-100 overflow-hidden">
      <div className="absolute inset-0 grid-bg-dark opacity-30" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-forest-400/5 rounded-full blur-[150px]" />

      <div className="container relative">
        <div className="reveal text-center max-w-3xl mx-auto mb-20">
          <span className="text-forest-400 font-mono text-sm tracking-wider">
            02 / 核心能力
          </span>
          <h2 className="font-display text-4xl md:text-6xl font-bold mt-4 leading-tight">
            四大引擎驱动
            <br />
            <span className="gradient-text-forest">线下寻宝闭环</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-forest-400/10 rounded-3xl overflow-hidden border border-forest-400/10">
          {capabilities.map((cap, idx) => (
            <div
              key={cap.title}
              className={`reveal reveal-delay-${idx + 1} group relative bg-navy-950 p-8 lg:p-12 hover:bg-navy-900/50 transition-colors duration-500`}
            >
              <div className="flex items-start gap-6 mb-6">
                <div className="shrink-0 w-14 h-14 rounded-2xl bg-forest-400/10 border border-forest-400/20 flex items-center justify-center group-hover:bg-forest-400 group-hover:border-forest-400 transition-all duration-500">
                  <cap.icon className="w-7 h-7 text-forest-400 group-hover:text-navy-950 transition-colors duration-500" />
                </div>
                <div>
                  <span className="text-forest-400/70 font-mono text-xs tracking-wider">
                    {cap.tag}
                  </span>
                  <h3 className="font-display text-2xl font-bold mt-1">
                    {cap.title}
                  </h3>
                </div>
              </div>

              <p className="text-cream-100/60 leading-relaxed mb-6">
                {cap.desc}
              </p>

              <ul className="space-y-3">
                {cap.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-forest-400 shrink-0" />
                    <span className="text-cream-100/70">{point}</span>
                  </li>
                ))}
              </ul>

              <div className="absolute top-6 right-8 font-display text-6xl font-bold text-forest-400/5 group-hover:text-forest-400/10 transition-colors">
                0{idx + 1}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
