import { Map, Footprints, Scan, Gift } from "lucide-react";

const steps = [
  {
    icon: Map,
    num: "01",
    title: "查看地图",
    desc: "打开小程序 / APP，获取宝藏的模糊区域位置",
  },
  {
    icon: Footprints,
    num: "02",
    title: "解锁线索",
    desc: "逐步解锁分级线索，缩小寻宝范围",
  },
  {
    icon: Scan,
    num: "03",
    title: "到店扫码",
    desc: "抵达线下门店，扫描实体金币完成三重校验",
  },
  {
    icon: Gift,
    num: "04",
    title: "领取奖励",
    desc: "校验通过后领取优惠券，到店消费核销",
  },
];

export default function Process() {
  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-50" />

      <div className="container relative">
        <div className="reveal text-center max-w-3xl mx-auto mb-16 lg:mb-20">
          <span className="text-forest-600 font-mono text-sm tracking-wider">
            04 / 寻宝流程
          </span>
          <h2 className="font-display text-4xl md:text-6xl font-bold text-navy-950 mt-4 leading-tight">
            四步完成
            <span className="gradient-text-forest"> 到店寻宝</span>
          </h2>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden lg:block absolute top-20 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-forest-400/40 to-transparent" />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, idx) => (
              <div
                key={step.num}
                className={`reveal reveal-delay-${idx + 1} relative text-center`}
              >
                <div className="relative inline-flex items-center justify-center mb-6">
                  <div className="w-20 h-20 rounded-2xl bg-navy-950 flex items-center justify-center relative z-10">
                    <step.icon className="w-9 h-9 text-forest-400" />
                  </div>
                  <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-forest-400 text-navy-950 font-display font-bold text-sm flex items-center justify-center">
                    {step.num}
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-navy-950 mb-2">
                  {step.title}
                </h3>
                <p className="text-navy-800/60 text-sm leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
