import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/** One-shot section entrances. Content stays readable when motion APIs are absent. */
export function useScrollReveal() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    let active = true;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const show = (node: HTMLElement, immediate = false) => {
      if (!active) return;
      if (immediate) node.classList.add("reveal-instant");
      node.classList.remove("reveal-pending");
      node.classList.add("is-visible");
    };
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media || media.matches || !("IntersectionObserver" in window)) {
      nodes.forEach(node => show(node, true));
      return () => { active = false; };
    }

    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        show(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });

    nodes.forEach(node => {
      if (node.classList.contains("is-visible")) return;
      node.classList.add("reveal-pending");
      observer.observe(node);
    });
    const onMotion = () => {
      if (!media.matches) return;
      observer.disconnect();
      nodes.forEach(node => show(node, true));
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      let node = event.target.closest<HTMLElement>(".reveal");
      while (node) {
        show(node, true);
        observer.unobserve(node);
        node = node.parentElement?.closest<HTMLElement>(".reveal") || null;
      }
    };
    const modernMotionListener = typeof media.addEventListener === "function" && typeof media.removeEventListener === "function";
    if (modernMotionListener) media.addEventListener("change", onMotion);
    else media.addListener?.(onMotion);
    document.addEventListener("focusin", onFocus);
    return () => {
      active = false;
      observer.disconnect();
      if (modernMotionListener) media.removeEventListener("change", onMotion);
      else media.removeListener?.(onMotion);
      document.removeEventListener("focusin", onFocus);
      nodes.forEach(node => node.classList.remove("reveal-pending", "reveal-instant"));
    };
  }, [pathname]);
}
