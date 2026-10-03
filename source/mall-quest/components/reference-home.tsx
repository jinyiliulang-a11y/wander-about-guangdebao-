"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import type { Role, Store, Task } from "@/lib/game-types";
import { ClientWordmark } from "./client-wordmark";
import { ThemeToggle } from "./theme-toggle";
import { StoreImage } from "./store-image";
import { ClientStoreMap } from "./client-store-map";
import "./store-image-surfaces.css";
import "./reference-home-motion.css";
import "./map-controls-motion.css";

export type ReferenceHomeProps = {
  theme: "light" | "dark";
  onThemeToggle: () => void;
  stores: Store[];
  tasks: Task[];
  floor: string;
  points: number;
  claimedCount: number;
  displayName: string;
  onFloor: (floor: string) => void;
  onTask: (task: Task, origin: HTMLElement) => void;
  onProfile: () => void;
  onHome?: () => void;
  onRefresh?: () => void;
  onWallet?: () => void;
  onNotifications?: () => void;
  onGeofence?: () => void;
  notificationCount?: number;
  avatar?: string;
  role?: Role;
  mallName?: string;
};

// These paths and SVG attributes match the reference rather than substituting
// icons with different proportions or stroke weights.
const icons = {
  pin: <><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>,
  arrow: <path d="m9 18 6-6-6-6" />,
  spark: <><path d="m12 2 1.3 5.2L18 9l-4.7 1.8L12 16l-1.3-5.2L6 9l4.7-1.8L12 2Z" /><path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6L19 15Z" /></>,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" /></>,
  expand: <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></>,
  profile: <><circle cx="12" cy="8.2" r="3.4" /><path d="M5.5 20c.5-4 2.6-6 6.5-6s6 2 6.5 6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1.4L20 9M4 15l2.3 3.4A7 7 0 0 0 17.9 17"/></>,
} satisfies Record<string, ReactNode>;

function Icon({ name, size = 22 }: { name: keyof typeof icons; size?: number }) {
  return <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}>{icons[name]}</svg>;
}

type MapPhase = "normal" | "expanded" | "closing";
type MapArtworkFrame = { width: number; height: number; x: number; y: number; scale: number };
type MapDecoration = { element: HTMLElement; frame: Record<string, string>; original: Record<string, string> };
const decorationProperties = [
  [".map-grid", ["backgroundSize", "transform"]],
  [".map-water", ["width", "height", "top", "right"]],
  [".road-one", ["width", "height", "top", "left"]],
  [".road-two", ["width", "height", "top", "left"]],
  [".label-one", ["top", "left"]],
  [".label-two", ["top", "left"]],
  [".you-are-here", ["top", "left"]],
] as const;
const cssProperty = (property: string) => property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
function mapDecorations(card: HTMLElement): MapDecoration[] {
  return decorationProperties.flatMap(([selector, properties]) => {
    const element = card.querySelector<HTMLElement>(selector);
    if (!element) return [];
    const css = window.getComputedStyle(element);
    return [{
      element,
      frame: Object.fromEntries(properties.map(property => [property, css.getPropertyValue(cssProperty(property))])),
      original: Object.fromEntries(properties.map(property => [property, element.style.getPropertyValue(cssProperty(property))])),
    }];
  });
}
function freezeDecorations(parts: MapDecoration[]) {
  for (const part of parts) for (const [property, value] of Object.entries(part.frame)) part.element.style.setProperty(cssProperty(property), value);
}
function restoreDecorations(parts: MapDecoration[]) {
  for (const part of parts) for (const [property, value] of Object.entries(part.original)) {
    if (value) part.element.style.setProperty(cssProperty(property), value);
    else part.element.style.removeProperty(cssProperty(property));
  }
}
function artworkFrame(width: number, height: number): MapArtworkFrame {
  const scale = Math.min(window.innerWidth / Math.max(1, width), window.innerHeight / Math.max(1, height));
  return { width, height, scale, x: (window.innerWidth - width * scale) / 2, y: (window.innerHeight - height * scale) / 2 };
}
const artworkTransform = (frame: MapArtworkFrame) => `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale})`;
const mapBounds = (rect: DOMRect | DOMRectReadOnly): Keyframe => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
const reducedMotion = () => document.documentElement.dataset.questReduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const focusable = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']")].filter(node => node.getClientRects().length > 0);

/** Reference TreasureHome composition, backed exclusively by actual game state. */
export function ReferenceHome({
  theme, onThemeToggle,
  stores, tasks, floor, points, claimedCount, displayName, onFloor, onTask,
  onProfile, onHome, onRefresh, onWallet, onNotifications, onGeofence, notificationCount = 0,
  avatar, role = "hunter", mallName = "星光里购物中心",
}: ReferenceHomeProps) {
  const [mapState, setMapState] = useState<MapPhase>("normal");
  const [slotHeight, setSlotHeight] = useState(0);
  const [search, setSearch] = useState("");
  const [artwork, setArtwork] = useState<MapArtworkFrame>({ width: 0, height: 0, x: 0, y: 0, scale: 1 });
  const map = useRef<HTMLElement>(null);
  const artworkLayer = useRef<HTMLDivElement>(null);
  const mapSlot = useRef<HTMLDivElement>(null);
  const floorTreasures = useRef<HTMLElement>(null);
  const treasureHeadingId = useId();
  const animations = useRef<Animation[]>([]);
  const closedDecorations = useRef<MapDecoration[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);
  const phase = useRef<MapPhase>("normal");
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocusFrame = useRef<number | null>(null);
  const originRect = useRef<DOMRect | null>(null);
  const originRadius = useRef("0px");
  const originalScroll = useRef({ x: 0, y: 0 });
  const historyMarker = useId();
  const active = mapState !== "normal";
  const visible = tasks.filter(task => task.floor === floor && task.status === "published");
  const floors = [...new Set(["B1", "F1", "F2", "F3", ...stores.map(store => store.floor), ...tasks.map(task => task.floor)])];
  const storeMap = new Map(stores.map(store => [store.id, store]));
  const query = search.trim().normalize("NFKC").toLocaleLowerCase();
  const results = visible.filter(task => [task.title, task.reward, task.storeName || storeMap.get(task.storeId)?.name || "", task.area].join(" ").normalize("NFKC").toLocaleLowerCase().includes(query));


  const showFloorTreasures = () => {
    const section = floorTreasures.current;
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start", behavior: reducedMotion() ? "instant" : "smooth" });
  };

  const finishClose = useCallback(() => {
    phase.current = "normal";
    setMapState("normal");
  }, []);

  const cancelAnimations = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);

  const closeMap = useCallback((fromHistory = false) => {
    if (phase.current === "normal" || phase.current === "closing") return;
    phase.current = reducedMotion() ? "normal" : "closing";
    setMapState(phase.current);
    // Only remove this component's own same-URL history entry. A task detail
    // can sit above the map with its own history and modal ownership.
    if (!fromHistory && window.history.state?.mallReferenceMap === historyMarker) window.history.back();
  }, [historyMarker]);

  const expandMap = (event: MouseEvent<HTMLButtonElement>) => {
    if (phase.current !== "normal") return;
    if (restoreFocusFrame.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrame.current);
      restoreFocusFrame.current = null;
    }
    const card = event.currentTarget.closest<HTMLElement>(".map-card") || map.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    originRect.current = rect;
    originRadius.current = window.getComputedStyle(card).borderRadius;
    setSlotHeight(rect.height);
    closedDecorations.current = mapDecorations(card);
    setArtwork(artworkFrame(rect.width, rect.height));
    opener.current = event.currentTarget;
    originalScroll.current = { x: window.scrollX, y: window.scrollY };
    const oldState = window.history.state;
    window.history.pushState({ ...(oldState && typeof oldState === "object" ? oldState : {}), mallReferenceMap: historyMarker }, "", window.location.href);
    phase.current = "expanded";
    setMapState("expanded");
  };

  useLayoutEffect(() => {
    if (!active) return;
    // Keep the underlying layout at its former width when its scrollbar is
    // hidden. Otherwise the shrink target shifts sideways just before unlock.
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const previousPadding = document.body.style.paddingRight;
    const computedPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    const releaseScroll = acquireOverlayScroll();
    if (scrollbar) document.body.style.paddingRight = `${computedPadding + scrollbar}px`;
    const frame = window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      const node = map.current;
      if (!node || phase.current === "closing") return;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(dialog => dialog.getClientRects().length > 0);
      // A real task/reward dialog owns ESC and focus while it is above the map.
      if (dialogs.at(-1) !== node) return;
      if (event.key === "Escape") { event.preventDefault(); closeMap(); }
      if (event.key === "Tab") {
        const nodes = focusable(node), first = nodes[0], last = nodes.at(-1);
        if (!first) { event.preventDefault(); node.focus({ preventScroll: true }); }
        else if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const onPop = () => {
      if (window.history.state?.mallReferenceMap === historyMarker) return;
      // Navigating between a task and its underlying expanded map must not
      // collapse the map or race the parent's task focus/scroll cleanup.
      if (/^\/client\/(coin|task)\//.test(window.location.pathname)) return;
      closeMap(true);
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (!motion.matches) return;
      cancelAnimations();
      if (phase.current === "closing") finishClose();
    };
    const onResize = () => {
      // A rotation should settle at the new viewport rather than finish an
      // animation whose dimensions were captured before that rotation.
      cancelAnimations();
      if (phase.current === "closing") { finishClose(); return; }
      const card = map.current, layer = artworkLayer.current;
      if (!card || !layer || phase.current !== "expanded") return;
      // A viewport change may alter the *compact* responsive reference size.
      // Take that new reference once, then keep its contents together again.
      const classes = card.className;
      card.classList.remove("map-fullscreen", "map-collapsing");
      restoreDecorations(closedDecorations.current);
      layer.style.width = "100%"; layer.style.height = "100%"; layer.style.transform = "none";
      const rect = card.getBoundingClientRect();
      closedDecorations.current = mapDecorations(card);
      const next = artworkFrame(rect.width, rect.height);
      card.className = classes;
      freezeDecorations(closedDecorations.current);
      layer.style.width = `${next.width}px`; layer.style.height = `${next.height}px`; layer.style.transform = artworkTransform(next);
      setArtwork(next);
      setSlotHeight(rect.height);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    motion.addEventListener("change", onMotion);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      motion.removeEventListener("change", onMotion);
      document.body.style.paddingRight = previousPadding;
      releaseScroll();
      // Only a normal close returns to this page's source. Unmounting into a
      // different primary page must keep that page's own scroll/focus policy.
      if (phase.current === "normal") {
        window.scrollTo({ left: originalScroll.current.x, top: originalScroll.current.y, behavior: "instant" });
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        // React layout cleanup can precede removal of the temporary disabled
        // attribute on the compact expand button. Retry after that commit.
        restoreFocusFrame.current = window.requestAnimationFrame(() => {
          restoreFocusFrame.current = null;
          if (phase.current === "normal" && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        });
      }
    };
  }, [active, closeMap, finishClose, historyMarker, cancelAnimations]);

  useLayoutEffect(() => {
    const card = map.current;
    const layer = artworkLayer.current;
    if (!card || !layer || mapState === "normal") {
      cancelAnimations();
      restoreDecorations(closedDecorations.current);
      return;
    }
    const closing = mapState === "closing";
    const fromBounds = closing ? card.getBoundingClientRect() : originRect.current;
    const fromRadius = closing ? window.getComputedStyle(card).borderRadius : originRadius.current;
    const chromeElements = [...card.querySelectorAll<HTMLElement>(".map-fullscreen-title,.map-close,.map-controls,.map-zoom-button")];
    const chromeFrames = new Map(chromeElements.map(element => {
      const style = window.getComputedStyle(element);
      return [element, { opacity: style.opacity, transform: style.transform, bottom: style.bottom }];
    }));
    cancelAnimations();
    // Fullscreen CSS must never redraw the compact map. These are the same
    // original coordinates and sizes, all inside one uniformly scaled layer.
    freezeDecorations(closedDecorations.current);
    let toBounds: DOMRect;
    let toRadius: string;
    let compactControlsTransform = "none";
    let compactControlsBottom = "16px";
    if (closing) {
      // Measure the actual current responsive card without painting it. This
      // also gives a fresh target after a phone rotates while the map is open.
      const classes = card.className;
      card.classList.remove("map-fullscreen", "map-collapsing");
      toBounds = card.getBoundingClientRect();
      toRadius = window.getComputedStyle(card).borderRadius;
      const controls = card.querySelector<HTMLElement>(".map-controls");
      if (controls) {
        const style = window.getComputedStyle(controls);
        compactControlsTransform = style.transform;
        compactControlsBottom = style.bottom;
      }
      if (mapSlot.current) mapSlot.current.style.height = `${toBounds.height}px`;
      card.className = classes;
    } else {
      toBounds = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      toRadius = window.getComputedStyle(card).borderRadius;
    }
    if (reducedMotion() || !fromBounds) {
      return;
    }
    // The outer window and one intact artwork share a single timeline. No
    // road, water, grid, label or marker has its own resize/morph animation.
    const timing: KeyframeAnimationOptions = {
      duration: 680,
      easing: closing ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.16,.84,.22,1)",
      fill: "both",
    };
    const main = card.animate([
      { ...mapBounds(fromBounds), borderRadius: fromRadius, opacity: 1 },
      { ...mapBounds(toBounds), borderRadius: toRadius, opacity: 1 },
    ], timing);

    const chrome = chromeElements.map(element => {
      const controls = element.matches(".map-controls"), zoom = element.matches(".map-zoom-button"), title = element.matches(".map-fullscreen-title");
      // The compact-only expand button retains its layout slot in fullscreen.
      // Fade it back over the same geometry timeline, rather than remounting
      // it at the boundary and shifting the floor bar by half its width.
      if (zoom) return element.animate([
        { opacity: closing ? chromeFrames.get(element)?.opacity || "0" : 1 },
        { opacity: closing ? 1 : 0 },
      ], { ...timing, duration: closing ? 680 : 280 });
      // Keep the floor controls' horizontal centering. Only their chrome
      // moves a few pixels; the map artwork retains its single morph timeline.
      const restingTransform = window.getComputedStyle(element).transform;
      const restingBottom = window.getComputedStyle(element).bottom;
      const offset = controls ? 8 : title ? -6 : 0;
      const offsetTransform = offset
        ? `${restingTransform === "none" ? "" : restingTransform} translateY(${offset}px)`
        : restingTransform;
      return element.animate([
        closing ? chromeFrames.get(element) || { opacity: 1, transform: restingTransform }
          : { opacity: 0, transform: offsetTransform },
        { opacity: closing && !controls ? 0 : 1,
          transform: closing ? controls ? compactControlsTransform : offsetTransform : restingTransform,
          ...(controls ? { bottom: closing ? compactControlsBottom : restingBottom } : {}) },
      ], {
        duration: closing ? controls ? 680 : 180 : controls ? 280 : title ? 300 : 200,
        delay: closing ? 0 : controls ? 140 : 80,
        easing: closing && controls ? timing.easing : "cubic-bezier(.2,.8,.2,1)",
        fill: "both",
      });
    });
    animations.current = [main, ...chrome];
    main.finished.then(() => {
      if (closing && phase.current === "closing") finishClose();
      else if (!closing && phase.current === "expanded") cancelAnimations();
    }).catch(() => { /* A close, resize, navigation or unmount cancels safely. */ });
  }, [mapState, cancelAnimations, finishClose]);

  useEffect(() => () => {
    if (restoreFocusFrame.current !== null) window.cancelAnimationFrame(restoreFocusFrame.current);
    cancelAnimations();
    restoreDecorations(closedDecorations.current);
  }, [cancelAnimations]);

  useEffect(() => {
    if (mapState !== "closing") return;
    // The original collapse takes .68s. A missing animationend, disabled
    // animations, or a replaced stylesheet must never strand a fixed dialog.
    const disabled = reducedMotion() || animations.current.length === 0;
    const timer = window.setTimeout(finishClose, disabled ? 0 : 850);
    return () => window.clearTimeout(timer);
  }, [mapState, finishClose]);

  return <section className="reference-home">
    <header className="app-header quest-theme-home-header">
      <div>
        <p className="location"><Icon name="pin" size={14} /> {mallName} · {floor}</p>
        <h2 className="home-brand"><ClientWordmark onHome={onHome} className="home-wordmark" /></h2>
        <h1 className="map-page-title">寻宝地图</h1>
      </div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        {onRefresh && <button className="icon-button" aria-label="刷新活动数据" onClick={onRefresh} type="button"><Icon name="refresh" size={18}/></button>}
        <button aria-label={onNotifications ? "打开玩法帮助" : "打开个人中心"} className="icon-button notification-shortcut" onClick={onNotifications || onProfile} type="button">
          <Icon name={onNotifications ? "compass" : "profile"} size={18} />
          {onNotifications && notificationCount > 0 && <span>{notificationCount}</span>}
        </button>
        <button className="avatar map-profile-button" aria-label={`打开${displayName}的个人中心`} title={displayName} onClick={onProfile} type="button" style={{ border: 0, padding: 0 }}><span>{avatar || (role === "hunter" ? "寻" : "探")}</span></button>
      </div>
    </header>
    <div ref={mapSlot} className="reference-map-slot" style={active ? { height: slotHeight } : undefined}>
    <section
      ref={map}
      className={`map-card map-morph ${active ? "map-fullscreen" : ""} ${mapState === "closing" ? "map-collapsing" : ""}`}
      role={active ? "dialog" : "region"}
      aria-modal={active ? true : undefined}
      aria-label={`${floor}门店寻宝地图`}
      tabIndex={active ? -1 : undefined}
    >
      <div ref={artworkLayer} className="map-artwork real-geographic-artwork" style={active ? { width: artwork.width, height: artwork.height } : undefined}>
          <ClientStoreMap stores={stores} tasks={tasks} floor={floor} onTask={onTask} />
        </div>
      <div className="map-controls">
        <div className="floor-tabs" aria-label="选择商场楼层">
          {floors.map(value => <button className={floor === value ? "active" : ""} key={value} aria-pressed={floor === value} onClick={() => onFloor(value)} type="button">{value}</button>)}
        </div>
        <button className="map-zoom-button" onClick={expandMap} aria-label="全屏展开地图" aria-hidden={active || undefined} tabIndex={active ? -1 : undefined} disabled={active} type="button"><Icon name="expand" size={19} /></button>
      </div>
      {active && <>
        <div className="map-fullscreen-title"><p>探索地图 · {floor}</p><span>点击门店标记查看线索 · 门店到店范围</span></div>
        <button ref={closeButton} className="map-close" onClick={() => closeMap()} aria-label="收起地图" type="button"><Icon name="close" size={21} /></button>
      </>}
    </section>
    </div>
    <section className="quick-stats">
      <button onClick={showFloorTreasures} aria-label={`查看${floor}楼层宝藏`} type="button"><strong>{visible.length}</strong><span>本层宝藏</span></button>
      <button onClick={onWallet || onProfile} type="button"><strong>{claimedCount}</strong><span>已收集奖励</span></button>
      <button onClick={onProfile} type="button"><strong>{points}</strong><span>可用积分</span></button>
    </section>
    {onGeofence && <button type="button" className="outline-button geofence-entry" onClick={onGeofence}><Icon name="pin" size={18} />附近门店<Icon name="arrow" size={16} /></button>}
    <section ref={floorTreasures} className="section-block floor-treasures-section" tabIndex={-1} aria-labelledby={treasureHeadingId}>
      <div className="section-heading">
        <div><p className="eyebrow">EXPLORE</p><h3 id={treasureHeadingId}>这一层的宝藏</h3></div>
        <label className="search-field"><Icon name="search" size={16} /><input aria-label="搜索宝藏" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索宝藏" maxLength={100} /></label>
        <button onClick={event => expandMap(event)} type="button" aria-label="展开楼层地图查看全部宝藏">查看地图 <Icon name="arrow" size={14} /></button>
      </div>
      <div className="treasure-list">
        {results.map((task, index) => {
          const store = storeMap.get(task.storeId);
          const artwork = store?.artwork ?? index;
          const tone = ["amber", "blue", "green"][((artwork % 3) + 3) % 3];
          return <button className="treasure-card" key={task.id} onClick={event => onTask(task, event.currentTarget)} type="button">
            <div className={`treasure-art ${tone}${store?.imageURL ? " has-store-image" : ""}`}>
              {task.claimed ? <span>已收集</span> : task.isFeatured ? <span>精选</span> : null}
              {store?.imageURL ? <StoreImage imageURL={store.imageURL} artwork={artwork} alt={store.name} className="treasure-store-image" /> : <Icon name={tone === "blue" ? "compass" : "spark"} size={32} />}
            </div>
            <div className="treasure-copy">
              <b>{store?.name || task.storeName || task.title}</b>
              <p>{task.title} · {task.reward}</p>
              <small><Icon name="pin" size={13} /> {task.floor} · {task.area} · {task.claimed ? "已领取" : task.remaining > 0 ? `剩余 ${task.remaining} 份` : "本店奖励已领完"}</small>
            </div>
            <Icon name="arrow" size={18} />
          </button>;
        })}
        {results.length === 0 && <div className="empty-state"><Icon name="compass" size={32} /><h3>{visible.length ? "没有找到匹配的宝藏" : "这一层暂时没有宝藏"}</h3><p>{visible.length ? "试试任务名称、奖励或门店位置。" : "在地图中切换楼层，继续寻找公开任务。"}</p>{query && <button type="button" onClick={() => setSearch("")}>清除搜索</button>}</div>}
      </div>
    </section>
  </section>;
}
