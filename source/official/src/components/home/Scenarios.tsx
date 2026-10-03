import { Building2, MapPinned, Store, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const scenarios = [
  {
    icon: Building2,
    title: "大型购物中心",
    desc: "多楼层、多业态联动，引导客流二次分发，激活冷门区域与边角店铺。",
    metric: "日均到店 +62%",
  },
  {
    icon: MapPinned,
    title: "商圈街区",
    desc: "户外街区寻宝，串联多家商户，打造城市级打卡路线与社交话题。",
    metric: "跨店连带 +38%",
  },
  {
    icon: Store,
    title: "连锁品牌",
    desc: "跨门店联动寻宝，会员积分互通，提升品牌忠诚度与复购率。",
    metric: "复购率 +45%",
  },
];

export default function Scenarios() {
  return (
    <section id="scenarios" className="relative py-24 lg:py-32 bg-cream-100">
      <div className="container">
        <div className="reveal flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 lg:mb-20">
          <div className="max-w-2xl">
            <span className="text-forest-600 font-mono text-sm tracking-wider">
              03 / 应用场景
            </span>
            <h2 className="font-display text-4xl md:text-6xl font-bold text-navy-950 mt-4 leading-tight">
              适配多种
              <br />
              <span className="text-stroke-navy">线下商业形态</span>
            </h2>
          </div>
          <Link
            to="/product/detail"
            className="group inline-flex items-center gap-2 text-navy-900 font-medium hover:text-forest-600 transition-colors"
          >
            查看完整案例
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {scenarios.map((s, idx) => (
            <div
              key={s.title}
              className={`reveal reveal-delay-${idx + 1} group relative bg-white rounded-3xl overflow-hidden border border-navy-900/5 hover:shadow-2xl hover:shadow-navy-900/10 transition-all duration-500 hover:-translate-y-1`}
            >
              <div className="p-8 lg:p-10">
                <div className="w-16 h-16 rounded-2xl bg-navy-950 flex items-center justify-center mb-8 group-hover:bg-forest-400 transition-colors duration-500">
                  <s.icon className="w-8 h-8 text-forest-400 group-hover:text-navy-950 transition-colors duration-500" />
                </div>
                <h3 className="font-display text-2xl font-bold text-navy-950 mb-3">
                  {s.title}
                </h3>
                <p className="text-navy-800/60 leading-relaxed mb-6">
                  {s.desc}
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-forest-400/10 text-forest-600 text-sm font-semibold">
                  {s.metric}
                </div>
              </div>
              <div className="h-1 w-full bg-gradient-to-r from-forest-400 to-forest-600 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
