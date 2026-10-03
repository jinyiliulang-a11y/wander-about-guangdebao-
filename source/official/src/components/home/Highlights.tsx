import { Footprints, Ticket, RefreshCw } from "lucide-react";

const highlights = [
  {
    icon: Footprints,
    title: "真实到店转化",
    subtitle: "到店率提升 62%",
    description:
      "以「寻宝解谜」为驱动力，强制用户抵达线下门店完成验证。用户为寻找宝藏主动遍历商场多个区域，自然延长停留时长，带动途经门店随机消费，实现「寻宝一次、逛店多家」的客流放大效应。",
    accent: "from-forest-400 to-forest-600",
  },
  {
    icon: Ticket,
    title: "营销效率跃升",
    subtitle: "核销率达 28%",
    description:
      "优惠券作为寻宝奖励，是用户主动探索后的成果，而非被动推送的沉睡券。当优惠券获得时有所付出，用户核销意愿大幅提升，营销 ROI 远高于传统泛投放。",
    accent: "from-navy-500 to-navy-700",
  },
  {
    icon: RefreshCw,
    title: "UGC 内容自循环",
    subtitle: "运营成本持续降低",
    description:
      "通过探索者角色让用户成为内容生产者，自主挖掘冷门店铺、创作解谜线索。平台仅需承担审核与基础运营职责，内容生产成本随用户规模扩大持续降低，形成自生长的内容生态。",
    accent: "from-navy-600 to-navy-800",
  },
];

export default function Highlights() {
  return (
    <section className="relative py-24 lg:py-32 bg-cream-100">
      <div className="container">
        <div className="reveal max-w-3xl mb-16 lg:mb-24">
          <span className="text-forest-600 font-mono text-sm tracking-wider">
            01 / 核心价值
          </span>
          <h2 className="font-display text-4xl md:text-6xl font-bold text-navy-950 mt-4 leading-tight">
            破解线下商业
            <br />
            <span className="text-stroke-navy">三大营销痛点</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {highlights.map((item, idx) => (
            <div
              key={item.title}
              className={`reveal reveal-delay-${idx + 1} group relative bg-white rounded-3xl p-8 lg:p-10 border border-navy-900/5 hover:border-forest-400/30 transition-all duration-500 hover:shadow-2xl hover:shadow-navy-900/5 hover:-translate-y-1`}
            >
              <div
                className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.accent} flex items-center justify-center mb-8`}
              >
                <item.icon className="w-7 h-7 text-white" />
              </div>

              <div className="font-mono text-xs text-forest-600 mb-2">
                0{idx + 1}
              </div>
              <h3 className="font-display text-2xl font-bold text-navy-950 mb-2">
                {item.title}
              </h3>
              <div className="text-forest-600 font-semibold mb-4">
                {item.subtitle}
              </div>
              <p className="text-navy-800/60 leading-relaxed">
                {item.description}
              </p>

              <div className="mt-8 h-1 w-12 bg-forest-400 rounded-full group-hover:w-20 transition-all duration-500" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
