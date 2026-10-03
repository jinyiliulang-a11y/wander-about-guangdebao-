import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PRODUCT_URL } from "@/data/contacts";
export default function Footer() {
  return <footer className="relative bg-navy-950 text-cream-100"><div className="container py-12"><div className="flex flex-col justify-between gap-8 border-b border-cream-100/10 pb-8 md:flex-row md:items-start"><div><Link to="/" className="font-display text-2xl font-bold">逛道宝</Link><p className="mt-2 text-xs tracking-widest text-forest-300">WANDER ABOUT</p><p className="mt-5 text-sm text-cream-100/60">让每次路过，多一次发现。</p></div><nav aria-label="页脚导航" className="flex flex-wrap gap-x-7 gap-y-4 text-sm text-cream-100/70"><Link to="/product">产品介绍</Link><Link to="/product/detail">功能与落地</Link><Link to="/team">团队介绍</Link><Link to="/team#contact">联系团队</Link></nav><a href={PRODUCT_URL} className="product-cta inline-flex w-fit items-center gap-2 rounded-full bg-forest-300 px-6 py-3 text-sm font-semibold text-navy-950 hover:bg-forest-200">体验产品 <ArrowRight className="h-4 w-4" /></a></div><p className="pt-6 text-xs text-cream-100/40">© 2026 逛道宝 · Wander About</p></div></footer>;
}
