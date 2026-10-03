import { useEffect } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import Home from "@/pages/Home";
import Product from "@/pages/Product";
import ProductDetail from "@/pages/ProductDetail";
import Team from "@/pages/Team";
import Contact from "@/pages/Contact";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { PRODUCT_URL } from "@/data/contacts";
import { useScrollReveal } from "@/hooks/useScrollReveal";
const basename=import.meta.env.BASE_URL.replace(/[/]+$/, "") || "/";
function RouteFocusAndScroll(){
 const {pathname,hash,key}=useLocation();
 useEffect(()=>{
  if(pathname==="/contact")return;
  const frame=requestAnimationFrame(()=>{
   let id=hash.slice(1);try{id=decodeURIComponent(id);}catch{/* Keep malformed fragments harmless. */}
   const anchor=id?document.getElementById(id):null;
   const target=anchor||document.getElementById("main-content");
   if(target){let node:HTMLElement|null=target;while(node){if(node.classList.contains("reveal")){node.classList.remove("reveal-pending");node.classList.add("is-visible");}node=node.parentElement;}if(!target.hasAttribute("tabindex"))target.setAttribute("tabindex","-1");target.focus({preventScroll:true});}
   if(anchor)anchor.scrollIntoView({block:"start",behavior:"instant"});else window.scrollTo({top:0,left:0,behavior:"instant"});
  });
  return()=>cancelAnimationFrame(frame);
 },[pathname,hash,key]);
 return null;
}
function NotFound(){return <section className="container min-h-[70vh] pt-40 pb-24"><p className="text-sm text-forest-600">404</p><h1 className="mt-4 font-display text-4xl font-bold text-navy-950">暂时找不到这个页面</h1><p className="mt-5 text-navy-800/60">可以返回官网首页，或直接体验逛道宝。</p><div className="mt-8 flex flex-wrap gap-4"><Link to="/" className="rounded-full bg-navy-950 px-6 py-3 text-cream-100">返回首页</Link><a href={PRODUCT_URL} className="product-cta rounded-full bg-forest-300 px-6 py-3 text-navy-950">体验产品</a></div></section>;}
function AppContent(){const {pathname}=useLocation();useScrollReveal();return <div className="relative min-h-screen bg-cream-100"><div className="noise-overlay" aria-hidden="true"/><Header/><main id="main-content" key={pathname} tabIndex={-1} className="route-enter relative z-10"><Routes><Route path="/" element={<Home/>}/><Route path="/product" element={<Product/>}/><Route path="/product/detail" element={<ProductDetail/>}/><Route path="/team" element={<Team/>}/><Route path="/contact" element={<Contact/>}/><Route path="*" element={<NotFound/>}/></Routes></main><Footer/></div>;}
export default function App(){return <BrowserRouter basename={basename}><RouteFocusAndScroll/><AppContent/></BrowserRouter>;}
