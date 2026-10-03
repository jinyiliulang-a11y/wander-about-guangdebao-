import { TrendingUp } from "lucide-react";
import { caseStudy } from "@/data/product";

export default function CaseStudy() {
  return (
    <section className="relative py-24 lg:py-32 bg-cream-100">
      <div className="container">
        <div className="reveal bg-navy-950 rounded-[2.5rem] p-8 lg:p-16 relative overflow-hidden">
          <div className="absolute inset-0 grid-bg-dark opacity-20" />
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-forest-400/10 rounded-full blur-[80px]" />

          <div className="relative grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-forest-400/10 border border-forest-400/20 text-forest-300 text-sm mb-6">
                <TrendingUp className="w-4 h-4" />
                试点案例
              </div>
              <h2 className="font-display text-3xl md:text-5xl font-bold text-cream-100 mb-4 leading-tight">
                {caseStudy.mall}
              </h2>
              <p className="text-cream-100/50 text-lg mb-8">{caseStudy.period}</p>
              <p className="text-cream-100/60 leading-relaxed max-w-lg">
                以官方宝藏为主、UGC 为辅的冷启动策略，优先联动餐饮、生活服务类高到店意愿商家，
                快速验证商业转化效果。核心数据全面超越行业平均水平。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {caseStudy.metrics.map((m, idx) => (
                <div
                  key={m.label}
                  className={`reveal reveal-delay-${idx + 1} bg-navy-900/50 backdrop-blur rounded-2xl p-6 border border-forest-400/10`}
                >
                  <div className="font-display text-4xl md:text-5xl font-bold gradient-text-forest mb-2">
                    {m.value}
                  </div>
                  <div className="text-cream-100 font-medium text-sm mb-1">
                    {m.label}
                  </div>
                  <div className="text-cream-100/40 text-xs">{m.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
