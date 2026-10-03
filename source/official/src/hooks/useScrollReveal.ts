import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
export function useScrollReveal(){
 const {pathname}=useLocation();
 useLayoutEffect(()=>{
  let active=true;
  const nodes=Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
  const show=(node:HTMLElement)=>{if(!active)return;node.classList.remove("reveal-pending");node.classList.add("is-visible");};
  const media=window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if(!media||media.matches||!("IntersectionObserver" in window)){nodes.forEach(show);return()=>{active=false;};}
  const observer=new IntersectionObserver(entries=>{if(!active)return;entries.forEach(entry=>{if(!entry.isIntersecting)return;show(entry.target as HTMLElement);observer.unobserve(entry.target);});},{threshold:0,rootMargin:"0px 0px -24px 0px"});
  nodes.forEach(node=>{if(node.classList.contains("is-visible"))return;node.classList.add("reveal-pending");observer.observe(node);});
  const onMotion=()=>{if(!media.matches)return;observer.disconnect();nodes.forEach(show);};
  const onFocus=(event:FocusEvent)=>{const target=event.target;if(!(target instanceof Node))return;nodes.forEach(node=>{if(!node.contains(target))return;show(node);observer.unobserve(node);});};
  media.addEventListener("change",onMotion);document.addEventListener("focusin",onFocus);
  return()=>{active=false;observer.disconnect();media.removeEventListener("change",onMotion);document.removeEventListener("focusin",onFocus);nodes.forEach(node=>node.classList.remove("reveal-pending"));};
 },[pathname]);
}
