import { Link } from "react-router-dom";
import { ArrowRight, Phone } from "lucide-react";
import HangzhouSkyline from "../shared/HangzhouSkyline";

export default function HomeCTA() {
  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="container">
        <div className="reveal text-center max-w-4xl mx-auto">
          <h2 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold text-navy-950 leading-[1.05] mb-8">
            把商场变成
            <br />
            <span className="gradient-text-forest italic">寻宝乐园</span>
          </h2>
          <p className="text-lg md:text-xl text-navy-800/60 max-w-2xl mx-auto mb-12 leading-relaxed">
            无论你是商场运营方、品牌商家还是投资伙伴，我们都期待与你一起
            重新定义线下商业的游戏规则。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-full bg-navy-950 text-cream-100 font-semibold hover:bg-navy-800 transition-colors"
            >
              预约产品演示
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-full border-2 border-navy-950 text-navy-950 font-semibold hover:bg-navy-950 hover:text-cream-100 transition-colors"
            >
              <Phone className="w-4 h-4" />
              商务合作
            </Link>
          </div>
        </div>
      </div>

      {/* 杭州地标剪影 */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        <HangzhouSkyline className="w-full" opacity={0.06} color="#0a1230" />
      </div>
    </section>
  );
}
