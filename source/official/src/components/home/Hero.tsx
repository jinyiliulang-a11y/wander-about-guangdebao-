import { Link } from "react-router-dom";
import { ArrowRight, Play, ChevronDown } from "lucide-react";
import HangzhouSkyline from "../shared/HangzhouSkyline";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-navy-950 text-cream-100 pt-24">
      {/* Background layers */}
      <div className="absolute inset-0 grid-bg-dark opacity-30" />
      <div className="absolute top-1/4 -right-32 w-[600px] h-[600px] bg-forest-400/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 -left-32 w-[500px] h-[500px] bg-navy-500/20 rounded-full blur-[100px]" />

      {/* Floating coins */}
      <div className="absolute top-32 right-1/4 w-16 h-16 rounded-full bg-forest-400/20 border border-forest-400/30 animate-float" />
      <div
        className="absolute top-1/2 right-1/3 w-10 h-10 rounded-full bg-forest-400/15 border border-forest-400/20 animate-float"
        style={{ animationDelay: "1.5s" }}
      />
      <div
        className="absolute bottom-32 right-1/4 w-12 h-12 rounded-full bg-forest-400/10 border border-forest-400/20 animate-float"
        style={{ animationDelay: "3s" }}
      />

      <div className="container relative grid lg:grid-cols-12 gap-12 items-center py-20">
        {/* Left content */}
        <div className="lg:col-span-7">
          <div className="reveal inline-flex items-center gap-2 px-4 py-2 rounded-full bg-forest-400/10 border border-forest-400/20 text-forest-300 text-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-forest-400 animate-pulse" />
            商场 LBS 游戏化营销解决方案
          </div>

          <h1 className="reveal reveal-delay-1 font-display font-bold leading-[0.95] tracking-tight mb-8">
            <span className="block text-5xl md:text-7xl lg:text-8xl text-cream-100">
              让每一次到店
            </span>
            <span className="block text-5xl md:text-7xl lg:text-8xl">
              都成为一场{" "}
              <span className="gradient-text-forest italic">寻宝冒险</span>
            </span>
          </h1>

          <p className="reveal reveal-delay-2 text-lg md:text-xl text-cream-100/60 max-w-2xl mb-10 leading-relaxed">
            以「实景寻宝」为核心玩法，打造探索者与寻宝者双角色体系。依托 LBS
            地理定位与实体金币凭证，将地图导航、到店解谜、优惠券奖励深度串联，
            破解传统营销核销率低、到店动力不足、冷门区域客流稀缺三大痛点。
          </p>

          <div className="reveal reveal-delay-3 flex flex-wrap items-center gap-4">
            <Link
              to="/product"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-full bg-forest-400 text-navy-950 font-semibold hover:bg-forest-300 transition-all hover:shadow-lg hover:shadow-forest-400/20"
            >
              探索产品
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/product/detail"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-full border border-cream-100/20 text-cream-100 font-medium hover:bg-cream-100/10 transition-colors"
            >
              <Play className="w-4 h-4 text-forest-400" />
              观看演示
            </Link>
          </div>
        </div>

        {/* Right visual */}
        <div className="lg:col-span-5 relative hidden lg:block">
          <div className="reveal reveal-delay-2 relative w-full aspect-square">
            {/* Compass ring */}
            <div className="absolute inset-0 rounded-full border border-forest-400/20 animate-spin" style={{ animationDuration: "60s" }} />
            <div className="absolute inset-8 rounded-full border border-forest-400/10" />
            <div className="absolute inset-16 rounded-full border border-forest-400/5" />

            {/* Center app icon mock */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-48 h-48 rounded-[2rem] bg-gradient-to-br from-navy-800 to-navy-950 border border-forest-400/30 shadow-2xl shadow-forest-400/10 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(74,124,94,0.15),transparent_70%)]" />
                {/* Stylized cityscape */}
                <div className="absolute bottom-0 left-0 right-0 h-1/2 flex items-end justify-center gap-1 px-4 pb-6">
                  <div className="w-3 h-16 bg-forest-400/60 rounded-t" />
                  <div className="w-4 h-24 bg-forest-400/80 rounded-t" />
                  <div className="w-5 h-32 bg-forest-400 rounded-t relative">
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-6 bg-forest-400" />
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-forest-400" />
                  </div>
                  <div className="w-4 h-20 bg-forest-400/70 rounded-t" />
                  <div className="w-3 h-14 bg-forest-400/50 rounded-t" />
                </div>
                {/* Treasure markers */}
                <div className="absolute top-8 left-6 w-3 h-3 rounded-full bg-forest-300 shadow-lg shadow-forest-400/50" />
                <div className="absolute top-12 right-10 w-2 h-2 rounded-full bg-forest-300" />
              </div>
            </div>

            {/* Orbiting dots */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-forest-400 shadow-lg shadow-forest-400/50" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-forest-400/60" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-forest-400/80" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-forest-400/70" />
          </div>
        </div>
      </div>

      {/* 杭州地标剪影 */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        <HangzhouSkyline className="w-full" opacity={0.13} />
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-cream-100/40">
        <span className="text-xs uppercase tracking-widest">向下滚动</span>
        <ChevronDown className="w-5 h-5 animate-bounce" />
      </div>
    </section>
  );
}
