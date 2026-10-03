import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, ArrowRight } from "lucide-react";
import { PRODUCT_URL } from "@/data/contacts";
const links = [{ label: "首页", path: "/" }, { label: "产品介绍", path: "/product" }, { label: "功能与落地", path: "/product/detail" }, { label: "团队与联系", path: "/team" }];
export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { const update = () => setScrolled(window.scrollY > 24); update(); window.addEventListener("scroll", update, { passive: true }); return () => window.removeEventListener("scroll", update); }, []);
  useEffect(() => setOpen(false), [pathname]);
  const dark = !scrolled && !open;
  return <header className={`fixed inset-x-0 top-0 z-50 border-b py-3 transition-colors duration-300 ${dark ? "border-transparent bg-navy-950/80 text-cream-100" : "border-navy-900/10 bg-cream-100/95 text-navy-950 backdrop-blur-md"}`}><div className="container flex items-center justify-between gap-4"><Link to="/" aria-label="逛道宝官网首页" className="flex shrink-0 items-center gap-3"><img src={`${import.meta.env.BASE_URL}images/app-icon.jpg`} alt="" className="h-10 w-10 rounded-xl object-cover" /><span className="font-display text-xl font-bold">逛道宝</span></Link><nav aria-label="主导航" className="hidden items-center gap-1 lg:flex">{links.map((link) => <Link key={link.path} to={link.path} aria-current={pathname === link.path ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm ${pathname === link.path ? (dark ? "bg-forest-300/20 text-forest-300" : "bg-forest-100 text-forest-700") : "hover:bg-forest-300/10"}`}>{link.label}</Link>)}</nav><div className="flex items-center gap-2"><a href={PRODUCT_URL} className="product-cta inline-flex items-center gap-2 rounded-full bg-forest-300 px-4 py-2.5 text-sm font-semibold text-navy-950 sm:px-5">体验产品 <ArrowRight className="hidden h-4 w-4 sm:block" /></a><button type="button" className="rounded-xl p-2 lg:hidden" aria-label={open ? "关闭菜单" : "打开菜单"} aria-expanded={open} aria-controls="official-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button></div></div>{open && <nav id="official-mobile-nav" aria-label="手机导航" className="container flex flex-col gap-1 pt-4 lg:hidden">{links.map((link) => <Link key={link.path} to={link.path} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm hover:bg-forest-100">{link.label}</Link>)}</nav>}</header>;
}
