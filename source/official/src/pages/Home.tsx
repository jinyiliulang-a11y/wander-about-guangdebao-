import { Link } from "react-router-dom";
import { ArrowRight, Compass, MapPin, Radio, ScanLine, Ticket, PenLine, Store, ShieldCheck } from "lucide-react";
import { PRODUCT_URL } from "@/data/contacts";
import ProductVideo from "@/components/home/ProductVideo";

const steps = [
  { icon: MapPin, title: "地图找线索", detail: "选择宝藏，跟着线索探索门店。" },
  { icon: Radio, title: "碰金币 NFC", detail: "通过到店范围校验，保存领取申请。" },
  { icon: ScanLine, title: "商家确认", detail: "商家核对金币设备，收回实物并确认奖励。" },
  { icon: Ticket, title: "奖励进卡包", detail: "正式优惠券进入个人卡包，积分奖励计入账户。" },
  { icon: Store, title: "到店用优惠券", detail: "以后消费时，出示个人券二维码办理核销。" },
] as const;
const roles = [
  { icon: PenLine, title: "客户端", label: "寻宝者 × 探索者", text: "寻找宝藏、解锁线索、查看奖励；也可以创作自己的线索并提交审核。", path: "/product" },
  { icon: Store, title: "商家端", label: "门店的寻宝工作台", text: "配置优惠券和金币设备，设置门店范围，确认奖励、核销个人券并查看记录。", path: "/product/detail" },
  { icon: ShieldCheck, title: "运营端", label: "让每一场探索有序开展", text: "管理门店与账号申请，审核内容和活动，查看平台记录并维护游戏设置。", path: "/product/detail" },
] as const;
const videoUrl = import.meta.env.VITE_PRODUCT_VIDEO_URL?.trim();
const asset = (name: string) => `${import.meta.env.BASE_URL}images/${name}`;

export default function Home() {
  return (
    <div className="home-page">
      <section className="home-hero relative overflow-hidden bg-navy-950 pt-32 pb-20 text-cream-100 lg:pt-40 lg:pb-28">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-bg-dark opacity-25" />
        <div aria-hidden="true" className="home-hero-light" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="reveal mb-6 flex items-center gap-2 text-sm tracking-widest text-forest-300"><Compass className="h-4 w-4" /> 逛道宝 · WANDER ABOUT</p>
            <h1 className="reveal reveal-delay-1 font-display text-5xl font-bold leading-[1.18] tracking-tight sm:text-6xl xl:text-7xl">让每次路过，<br /><span className="text-forest-300">多一次发现。</span></h1>
            <p className="reveal reveal-delay-2 mt-7 max-w-xl text-lg leading-relaxed text-cream-100/60">地图上的一条线索，门店里的一枚金币。把一次普通的逛街，变成一场有奖励的小探索。</p>
            <div className="reveal reveal-delay-3 mt-9 flex flex-wrap gap-4">
              <a href={PRODUCT_URL} className="product-cta inline-flex items-center gap-2 rounded-full bg-forest-300 px-7 py-4 font-semibold text-navy-950 hover:bg-forest-200">体验产品 <ArrowRight className="h-4 w-4" /></a>
              <Link to="/product" className="inline-flex items-center gap-2 rounded-full border border-cream-100/20 px-7 py-4 text-cream-100 hover:bg-cream-100/10">了解玩法</Link>
            </div>
          </div>
          <figure className="home-product-visual mx-auto w-full max-w-lg">
            <div className="home-product-stage relative flex items-start justify-center gap-5 rounded-[2rem] border border-forest-300/20 bg-navy-900/60 px-5 pt-7 pb-10 sm:gap-7 sm:px-9">
              <div className="home-phone home-phone-map w-[46%] overflow-hidden rounded-[1.7rem] border border-cream-100/15 shadow-xl"><img src={asset("ppt-map.png")} alt="逛道宝寻宝地图设计图" className="h-auto w-full" fetchPriority="high" /></div>
              <div className="home-phone home-phone-wallet mt-14 w-[46%] overflow-hidden rounded-[1.7rem] border border-cream-100/15 shadow-xl"><img src={asset("ppt-wallet.png")} alt="逛道宝卡包设计图" className="h-auto w-full" decoding="async" /></div>
            </div>
            <figcaption className="mt-4 text-center text-xs text-cream-100/40">产品界面设计展示</figcaption>
          </figure>
        </div>
      </section>

      <section id="how-it-works" className="home-flow-section bg-cream-100 py-16 lg:py-24">
        <div className="container">
          <div className="reveal max-w-2xl"><p className="text-sm tracking-widest text-forest-600">一次探索，怎样完成</p><h2 className="mt-4 font-display text-3xl font-bold leading-tight text-navy-950 sm:text-5xl">找到金币，<br />让发现变成奖励。</h2><p className="mt-5 leading-relaxed text-navy-800/60">金币的 NFC 打开领取入口，设备码用于商家核对金币。领取后，个人券二维码用于以后消费时核销。</p></div>
          <div className="relative mt-10">
            <div aria-hidden="true" className="home-flow-track mb-7"><span className="home-flow-trace" /></div>
            <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-5">{steps.map((step, index) => { const Icon = step.icon; return <li key={step.title} className={`reveal home-flow-node reveal-delay-${index + 1} rounded-3xl border border-navy-900/5 bg-white p-6`}><div className="flex items-center justify-between"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-100 text-forest-700"><Icon className="h-6 w-6" /></span><span className="font-mono text-xs text-navy-800/30">0{index + 1}</span></div><h3 className="mt-6 font-display text-lg font-bold text-navy-950">{step.title}</h3><p className="mt-3 text-sm leading-relaxed text-navy-800/60">{step.detail}</p></li>; })}</ol>
          </div>
        </div>
      </section>

      <section className="bg-white py-16 lg:py-24">
        <div className="container">
          <div className="reveal mb-10 max-w-2xl"><p className="text-sm tracking-widest text-forest-600">三端协作</p><h2 className="mt-4 font-display text-3xl font-bold text-navy-950 sm:text-5xl">把探索连成一条线。</h2></div>
          <div className="grid gap-6 lg:grid-cols-3">{roles.map((role, index) => { const Icon = role.icon; return <article key={role.title} className={`reveal home-role-card reveal-delay-${index + 1} rounded-3xl border border-navy-900/5 bg-cream-100 p-8`}><Icon className="h-8 w-8 text-forest-600" /><p className="mt-7 text-xs text-forest-600">{role.label}</p><h3 className="mt-2 font-display text-2xl font-bold text-navy-950">{role.title}</h3><p className="mt-5 leading-relaxed text-navy-800/60">{role.text}</p><Link to={role.path} className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-forest-700">查看功能 <ArrowRight className="h-4 w-4" /></Link></article>; })}</div>
        </div>
      </section>

      <section id="demo" className="bg-cream-100 py-16 lg:py-24">
        <div className="container"><div className="reveal overflow-hidden rounded-[2rem] bg-navy-950 text-cream-100"><div className="grid items-center gap-8 px-5 py-8 sm:p-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"><div><p className="text-sm tracking-widest text-forest-300">从屏幕，走进门店</p><h2 className="mt-4 font-display text-3xl font-bold sm:text-4xl">下一场探索，<br />从这里开始。</h2><p className="mt-5 leading-relaxed text-cream-100/60">{videoUrl ? "看看地图、金币与奖励怎样串起完整体验。" : "先在线体验逛道宝。产品演示视频稍后更新。"}</p><a href={PRODUCT_URL} className="product-cta mt-7 inline-flex items-center gap-2 rounded-full bg-forest-300 px-7 py-3 font-semibold text-navy-950 hover:bg-forest-200">体验产品 <ArrowRight className="h-4 w-4" /></a></div>{videoUrl ? <ProductVideo src={videoUrl} poster={import.meta.env.VITE_PRODUCT_VIDEO_POSTER?.trim() || undefined} /> : <div className="rounded-2xl border border-forest-300/20 bg-forest-400/10 p-8"><Compass className="h-10 w-10 text-forest-300" /><p className="mt-6 font-display text-2xl font-bold">探索身边，发现更多。</p><p className="mt-4 text-sm leading-relaxed text-cream-100/60">寻宝者寻找奖励，探索者创作线索。每一次发现，都可以成为下一次探索的起点。</p></div>}</div></div></div>
      </section>
    </div>
  );
}
