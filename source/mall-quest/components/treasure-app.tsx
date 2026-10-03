"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { interceptHistory } from "@/lib/history-interceptor";
import {
  Compass,
  Map,
  Ticket,
  PenLine,
  UserRound,
  Coins,
  Store as StoreIcon,
  ChevronDown,
  RefreshCw,
  Sparkles,
  MapPin,
  Check,
  CheckCircle2,
  X,
  HelpCircle,
  Copy,
  Gift,
  NotebookPen,
  ShieldCheck,
  Plus,
  MessageCircle,
  Megaphone,
  Flag,
  LayoutDashboard,
  ArrowLeft,
  Download,
  History,
  Settings2,
  LogOut,
  Share2,
  Trash2,
  ScanLine,
} from "lucide-react";
import { ReferenceHome } from "./reference-home";
import { ClientWordmark } from "./client-wordmark";
import { BrandLogo } from "./brand-logo";
import { ReferenceWallet } from "./reference-wallet";
import { ReferenceProfile } from "./reference-profile";
import { ReferenceLevelCenter } from "./reference-level-center";
import { ReferenceEntry } from "./reference-entry";
import { WorkspaceNavOverflow } from "./workspace-nav-overflow";
import { ThemeToggle } from "./theme-toggle";
import { PlacementEmpty } from "./placement-empty";
import { useThemeSwitch } from "@/hooks/use-theme-switch";
import { ReferenceCardModal, cardOrigin, type CardOrigin } from "./reference-motion";
import { CreatorWizard } from "./creator-wizard";
import { TaskReviewPanel } from "./task-review-panel";
import { HelpCenter, ExperienceSettings, InvitationContent } from "./profile-tools";
import { MerchantInfo } from "./merchant-info";
import { PlayerLogin } from "./player-login";
import { RoleLoginScreen, WorkspaceLogin } from "./role-login-screen";
import { CouponQr } from "./coupon-qr";
import { NfcCouponFlow } from "./nfc-coupon-flow";
import { PlayerClaimDrafts } from "./player-claim-drafts";
import { MerchantClaimIssue } from "./merchant-claim-issue";
import { RecordingCouponControl } from "./recording-coupon-control";
import { StoreImage } from "./store-image";
import { deferred } from "./deferred-component";
import { NetworkStatus } from "./network-status";
import { useCreatorDraft } from "@/hooks/use-creator-draft";
import { emptyCreatorDraft } from "@/lib/creator-draft-client";
import { useCelebration } from "@/hooks/use-celebration";
import { acquireOverlayScroll } from "@/lib/overlay-scroll";
import { useModalHistory } from "@/hooks/use-modal-history";
import {
  WorkbenchDashboard, CouponTemplateManager, DeviceTaskManager,
  MerchantProfileEditor, OperationsUsers, OperationsMerchants,
  OperationsSettings, type WorkbenchData,
} from "./deferred-workbench";
import { BackButton } from "./common/BackButton";
import { Empty } from "./common/Empty";
import { DiscoverySharePanel } from "./discovery-share-panel";
import { useExperiencePreferences } from "@/hooks/use-experience-preferences";
import {
  FootprintPage,
  AchievementPage,
  ExplorerProgress,
  getAchievements,
  WeeklyRanking,
} from "./experience-pages";
import { pagePath, routeView, pushGamePath } from "@/lib/game-navigation";
import { PROJECT_EDITION, editionEntryPath, editionNavigation, editionRoutePath, editionScope } from "@/lib/project-edition";
import { loadGame, loadStaff, request, isUncertainResult, GameApiError } from "@/lib/game-api";
import "./fast-navigation.css";
import "./pending-operation.css";
import "./coin-checkin.css";
import "./store-image-surfaces.css";
import { browserRequestId } from "@/lib/browser-id";
import { readBrowserLocation } from "@/lib/browser-location";
import type { GeoLocation } from "@/lib/geofence";
import { GeofencePanel } from "./geofence-panel";
import type {
  GameState,
  Task,
  Coupon,
  CouponPreview,
  Page,
  Role,
  StaffState,
  ReviewRecord,
} from "@/lib/game-types";
const statusLabels: Record<string, string> = {
  published: "寻宝中",
  found: "有人发现",
  expired: "已过期",
  pending: "待审核",
  rejected: "待修改",
  offline: "已下架",
};
type ActionResult = { message?: string; coupon?: Coupon; newlyIssued?: boolean; demoCode?: string; expiresAt?: number; retryAfter?: number; [key: string]: unknown };
const CouponScanner = deferred<{ onCode: (code: string) => void; onClose: () => void }>(async () => ({ default: (await import("./coupon-scanner")).CouponScanner }));
const AccountApplicationManager = deferred<{ onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>; busy: boolean; onBusyChange: (busy: boolean) => void }>(async () => ({ default: (await import("./account-application-manager")).AccountApplicationManager }));
const StoreActivityManager = deferred<{ scope: WorkbenchData["scope"]; stores: GameState["stores"]; reviewRequired: boolean; onConfigureFence: () => void; onBusyChange?: (value: boolean) => void }>(async () => ({ default: (await import("./store-activity-manager")).StoreActivityManager }));
type PendingOperation = { action: "place" | "claim" | "redeem"; payload: Record<string, unknown>; playerId: string;
  storeId?: string; requestId?: string; checked: boolean };
type CouponLookup = CouponPreview & { code: string; storeId: string };
type CoinConfirmation = { key: string; expiresAt?: number };
function coinEntryFromUrl() {
  const entries = new URLSearchParams(window.location.search).getAll("entry");
  if (!entries.length) return { token: undefined, error: "" };
  if (entries.length !== 1 || !entries[0] || entries[0].length > 160) return { token: undefined, error: "金币入口凭证格式不正确，请重新读取 NFC 标签。" };
  return { token: entries[0], error: "" };
}
const examples: Record<string, { title: string; clues: string[] }> = {
  tea: {
    title: "把花香，藏进一杯茶",
    clues: [
      "不卖鲜花，却把花香装进杯子。",
      "去 F1 中庭东侧找一个绿色角落。",
      "留意墙上三片茶叶的图案。",
      "找找菜单中的花香茶底。",
      "看到茉莉茶时，查看店旁的点位牌。",
    ],
  },
  book: {
    title: "一封写给未来的信",
    clues: [
      "这里收集纸张，也收集故事。",
      "沿 F2 西侧连廊慢慢寻找。",
      "找找给未来的自己主题陈列。",
      "看看陈列旁的银色书签。",
      "找到月亮图案，再查看桌边点位牌。",
    ],
  },
  craft: {
    title: "给日常盖一颗小星星",
    clues: [
      "一双手，让想法变成礼物。",
      "在 F1 南侧生活区探索。",
      "寻找摆着木头印章的小桌。",
      "看看印章手柄上的图案。",
      "星星就是答案，点位牌在体验桌旁。",
    ],
  },
};
function Art({ index, imageURL, alt }: { index: number; imageURL?: string; alt?: string }) {
  return <StoreImage artwork={index} imageURL={imageURL} alt={alt} />;
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
  sheet = false,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  sheet?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            ".modal button,.modal input,.modal textarea,.modal select",
          ),
        ].filter((n) => !n.hasAttribute("disabled"));
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const releaseScroll = acquireOverlayScroll();
    document.querySelector<HTMLElement>(".modal-close")?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      releaseScroll();
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className={`modal-backdrop ${sheet ? "sheet-backdrop" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""} ${sheet ? "share-sheet" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function preferredRole(): Role {
  if (window.location.pathname === "/client/explorer/login") return "explorer";
  if (window.location.pathname === "/client/hunter/login") return "hunter";
  if (window.location.pathname === "/client/login") {
    const requested = new URLSearchParams(window.location.search).get("role");
    if (requested === "hunter" || requested === "explorer") return requested;
    return "hunter";
  }
  const saved = window.history.state?.mallQuestRole;
  if (saved === "hunter" || saved === "explorer") return saved;
  try {
    return sessionStorage.getItem("mall-quest-role") === "explorer"
      ? "explorer"
      : "hunter";
  } catch {
    return "hunter";
  }
}
function normalizeEditionLocation() {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const target = editionRoutePath(current);
  if (target !== current) window.history.replaceState({ ...window.history.state }, "", target);
  return routeView(window.location.pathname, preferredRole());
}
export default function TreasureApp() {
  const [game, setGame] = useState<GameState | null>(null),
    [page, setPage] = useState<Page>(() => editionNavigation("entry").page),
    [role, setRole] = useState<Role>("hunter"),
    [floor, setFloor] = useState("F1"),
    [, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Task | null>(null),
    [reward, setReward] = useState<Coupon | null>(null),
    [help, setHelp] = useState(false),
    [openClues, setOpenClues] = useState([0, 1]),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [storeActivityBusy, setStoreActivityBusy] = useState(false),
    [registrationPending, setRegistrationPending] = useState(false),
    [error, setError] = useState(""),
    [syncNotice, setSyncNotice] = useState(""),
    [toast, setToast] = useState(""),
    [currentTime, setCurrentTime] = useState(0),
    [walletFilter, setWalletFilter] = useState("all"),
    [placementFilter, setPlacementFilter] = useState("all"),
    [staffData, setStaffData] = useState<StaffState | null>(null),
    [reviewHistory, setReviewHistory] = useState<{
      title: string;
      items: ReviewRecord[];
    } | null>(null),
    [posterBusy, setPosterBusy] = useState(false),
    [inviteLink, setInviteLink] = useState<string | null>(null),
    [shareOpen, setShareOpen] = useState(false),
    [staffTab, setStaffTab] = useState(() => editionNavigation("entry").login ? "login" : "overview"),
    [deleteItem, setDeleteItem] = useState<{ kind: "task" | "feedback"; id: string; title: string } | null>(null),
    [redeemCode, setRedeemCode] = useState(""),
    [scanOpen, setScanOpen] = useState(false),
    [couponLookup, setCouponLookup] = useState<CouponLookup | null>(null),
    [couponLookupBusy, setCouponLookupBusy] = useState(false),
    [couponLookupError, setCouponLookupError] = useState(""),
    [couponLookupAttempt, setCouponLookupAttempt] = useState(0),
    [coinEntryToken, setCoinEntryToken] = useState<string | undefined>(),
    [coinEntryError, setCoinEntryError] = useState(""),
    [coinConfirmation, setCoinConfirmation] = useState<CoinConfirmation | null>(null),
    [coinCheckInBusy, setCoinCheckInBusy] = useState(false),
    [workbench, setWorkbench] = useState<WorkbenchData | null>(null),
    [workRange, setWorkRange] = useState<7 | 30 | 90>(7),
    [workSearch, setWorkSearch] = useState(""),
    [feedbackValue, setFeedbackValue] = useState(3),
    [feedbackComment, setFeedbackComment] = useState("");
  const creator = useCreatorDraft(game?.player.id, page === "create" && !!game?.player.authenticated);
  const { storeId, title, clues } = creator.value;
  const setStoreId = (storeId: string) => creator.update(draft => ({ ...draft, storeId }));
  const setTitle = (title: string) => creator.update(draft => ({ ...draft, title }));
  const setClues = (clues: string[]) => creator.update(draft => ({ ...draft, clues }));
  const [creatorSubmitting, setCreatorSubmitting] = useState(false);
  const creatorSubmissionBusy = useRef(false);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const pendingOperationRef = useRef<PendingOperation | null>(null);
  const [checkingOperation, setCheckingOperation] = useState(false);
  const checkingOperationRef = useRef(false);
  const recoveredSubmissions = useRef(new Set<string>());
  const submissionRecoveryGeneration = useRef(0);
  const [screenTransition, setScreenTransition] = useState("screen-default");
  const [taskOrigin, setTaskOrigin] = useState<CardOrigin>({x:0,y:0,scale:.72});
  const [rewardOrigin, setRewardOrigin] = useState<CardOrigin>({x:0,y:0,scale:.72});
  const isWorkspace = page === "merchant" || page === "staff";
  const hasStaff = !!game?.staff;
  const { preferences, setPreferences, ready: preferencesReady } = useExperiencePreferences();
  const switchTheme = useThemeSwitch(preferences, setPreferences);
  const toggleTheme = useCallback(() => switchTheme(), [switchTheme]);
  const workspaceNavRef = useRef<HTMLElement>(null);
  const workspaceNavSelection = useRef<{ node: HTMLElement; key: string } | null>(null);
  useEffect(() => {
    if (!isWorkspace) return;
    const nav = workspaceNavRef.current;
    if (!nav) return;
    const key = `${page}:${staffTab}`;
    const animateSelection = workspaceNavSelection.current?.node === nav && workspaceNavSelection.current.key !== key;
    workspaceNavSelection.current = { node: nav, key };
    const alignCurrent = (animate = false) => {
      const current = nav.querySelector<HTMLElement>("[aria-current='page']");
      if (!current || nav.scrollWidth <= nav.clientWidth) return;
      const navRect = nav.getBoundingClientRect(), currentRect = current.getBoundingClientRect();
      const left = nav.scrollLeft + currentRect.left - navRect.left - (nav.clientWidth - currentRect.width) / 2;
      const reduced = preferences.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      nav.scrollTo({ left: Math.max(0, Math.min(nav.scrollWidth - nav.clientWidth, left)), behavior: animate && !reduced ? "smooth" : "instant" });
    };
    alignCurrent(animateSelection);
    const resize = () => alignCurrent();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [isWorkspace, page, staffTab, hasStaff, staffData?.pending.length, preferences.reduceMotion]);
  const celebration = useCelebration(preferences);
  const workRequestSeq = useRef(0);
  const workbenchReadError = useRef<string | null>(null);
  const staffRequestSeq = useRef(0);
  const gameRequestSeq = useRef(0);
  const latestGame = useRef<GameState | null>(null);
  const detailRef = useRef<Task | null>(null);
  const actionBusy = useRef(false);
  const registrationNavigation = useRef<{ url: string; state: unknown } | null>(null);
  useEffect(() => {
    if (PROJECT_EDITION === "full") return;
    // The head registry observes native Back before the framework router can
    // mount a foreign 404 page and remove this app's ordinary popstate listener.
    // Registration recovery keeps priority; forward only the normalized event.
    return interceptHistory({
      matches: () => {
        const path = window.location.pathname + window.location.search + window.location.hash;
        return !registrationNavigation.current && editionRoutePath(path) !== path;
      },
      onPop: () => {
        normalizeEditionLocation();
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      },
    });
  }, []);
  useEffect(() => {
    if (!registrationPending) { registrationNavigation.current = null; return; }
    registrationNavigation.current = { url: window.location.href, state: window.history.state };
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const protectHistory = () => {
      const pending = registrationNavigation.current;
      if (!pending) return;
      window.history.pushState(pending.state, "", pending.url);
      setError("注册结果还待核对，请先核对申请状态，再离开页面。");
    };
    const releaseHistory = interceptHistory({ matches: () => !!registrationNavigation.current, onPop: protectHistory });
    window.addEventListener("beforeunload", protect);
    return () => {
      window.removeEventListener("beforeunload", protect);
      releaseHistory();
    };
  }, [registrationPending]);
  const couponLookupSeq = useRef(0);
  const coinCheckInSeq = useRef(0);
  const [coinPosition, setCoinPosition] = useState<{ taskId: string; location: GeoLocation } | null>(null);
  const coinCheckInPending = useRef(false);
  const previewRole = game?.staff?.role;
  const previewStore = game?.staff?.storeId;
  useEffect(() => {
    const code = redeemCode.trim().toUpperCase();
    const seq = ++couponLookupSeq.current;
    const invalidate = () => { couponLookupSeq.current++; };
    let cancelled = false;
    const validScope = page === "merchant" && staffTab === "redeem" && previewRole === "merchant" && previewStore;
    queueMicrotask(() => {
      if (cancelled) return;
      setCouponLookup(null); setCouponLookupError(""); setCouponLookupBusy(!!validScope && !!code);
    });
    const timer = validScope && code ? window.setTimeout(async () => {
      try {
        const result = await request<CouponPreview>("couponPreview", { code });
        const current = latestGame.current?.staff;
        if (cancelled || seq !== couponLookupSeq.current) return;
        const credential = result.coupon;
        const codeMatches = result.coupon?.code.toUpperCase() === code;
        if (current?.role !== "merchant" || current.storeId !== previewStore || !credential || credential.storeId !== previewStore || !codeMatches) throw new Error("门店身份或券码已变化，请重新扫码。");
        setCouponLookup({ ...result, code, storeId: previewStore! });
      } catch (e) {
        if (!cancelled && seq === couponLookupSeq.current) setCouponLookupError((e as Error).message);
      } finally {
        if (!cancelled && seq === couponLookupSeq.current) setCouponLookupBusy(false);
      }
    }, 400) : undefined;
    return () => { cancelled = true; window.clearTimeout(timer); invalidate(); };
  }, [redeemCode, page, staffTab, previewRole, previewStore, couponLookupAttempt]);
  const coinConfirmationKey = `${game?.player.id || ""}\0${detail?.id || ""}\0${coinEntryToken || ""}`;
  useEffect(() => {
    coinCheckInSeq.current++;
    const invalidate = () => { coinCheckInSeq.current++; };
    coinCheckInPending.current = false;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setCoinConfirmation(null); setCoinCheckInBusy(false); setCoinPosition(null); } });
    return () => { cancelled = true; invalidate(); };
  }, [coinConfirmationKey]);
  const detailId = detail?.id;
  const previewHasExpiry = page === "merchant" && staffTab === "redeem" && !!couponLookup?.coupon?.validEnd;
  useEffect(() => {
    if (!(detailId && coinEntryToken) && !previewHasExpiry) return;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [detailId, coinEntryToken, previewHasExpiry]);
  const refreshWorkbench = useCallback(async (range = workRange, searchText = workSearch) => {
    const seq = ++workRequestSeq.current;
    const next = await request<WorkbenchData>("workbenchState", { range, search: searchText });
    if (seq === workRequestSeq.current) {
      const current = latestGame.current?.staff;
      if (!current || next.scope.role !== current.role || next.scope.storeId !== current.storeId) {
        setWorkbench(null);
        throw new Error("工作台身份已在其他标签页变化，请重新进入。");
      }
      setWorkbench(next);
      const previousReadError = workbenchReadError.current;
      workbenchReadError.current = null;
      if (previousReadError) setError(previous => previous === previousReadError ? "" : previous);
    }
    return next;
  }, [workRange, workSearch]);
  const placementRequest = useRef<{ key: string; id: string } | null>(null);
  // Transport intent metadata only: retain uncertain point-adjustment request
  // IDs across user-list navigation, scoped by operator and exact parameters.
  const operationsAdjustmentIntents = useRef(new globalThis.Map<string, { signature: string; requestId: string }>());
  const dismissTransient = useCallback(() => { setHelp(false); setReward(null); setShareOpen(false); setInviteLink(null); setReviewHistory(null); setDeleteItem(null); }, []);
  const closeTransientHistory = useModalHistory(deleteItem ? "delete" : help ? "help" : inviteLink ? "invite" : reviewHistory ? "reviewHistory" : reward ? shareOpen ? "share" : "reward" : "", dismissTransient);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) setCurrentTime(Date.now()); };
    queueMicrotask(tick);
    const timer = window.setInterval(tick, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const refreshWorkspace = useCallback(async () => {
    const seq = ++staffRequestSeq.current;
    const next = await loadStaff();
    if (seq === staffRequestSeq.current) setStaffData(next);
    return next;
  }, []);
  const notify = useCallback((message: string) => {
    if (preferences.notify === false) return;
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }, [preferences.notify]);
  const refresh = useCallback(async () => {
    normalizeEditionLocation();
    const seq = ++gameRequestSeq.current;
    let next: GameState;
    try { next = await loadGame(editionScope() === "workspace" || /^\/(merchant|staff|ops)(\/|$)/.test(window.location.pathname) ? "workspace" : "player"); }
    catch (e) { if (seq !== gameRequestSeq.current && latestGame.current) return latestGame.current; throw e; }
    if (seq !== gameRequestSeq.current) return latestGame.current || next;
    if (latestGame.current && latestGame.current.player.id !== next.player.id) {
      placementRequest.current = null;
      pendingOperationRef.current = null; setPendingOperation(null);
    }
    latestGame.current = next;
    setGame(next);
    setError("");
    setSyncNotice("");
    setSelected((id) => next.tasks.some(t => t.id === id) ? id : next.tasks[0]?.id || null);
    setReward(current => current && (!current.demo || next.recordingCouponAllowed) ? next.coupons.find(c => c.id === current.id) || null : null);
    const currentDetail = detailRef.current;
    const supportsClient = editionScope() !== "workspace";
    const linkedId = supportsClient ? routeView(window.location.pathname, preferredRole()).taskId || new URLSearchParams(window.location.search).get("quest") : null;
    if (supportsClient && (linkedId || /^\/client\/(coin|task|nfc)\//.test(window.location.pathname))) {
      const entry = coinEntryFromUrl();
      setCoinEntryToken(entry.token); setCoinEntryError(entry.error);
      const updated = next.tasks.find(t => t.id === linkedId) || null;
      setPage("map"); setRole("hunter"); setDetail(updated); detailRef.current = updated;
      if (updated) {
        setSelected(updated.id); setFloor(updated.floor);
        if (currentDetail?.id !== updated.id) { setOpenClues([0, 1]); setAnswer(""); }
        const params = new URLSearchParams(window.location.search);
        params.delete("quest");
        const query = params.toString();
        if (window.location.search) window.history.replaceState({ ...window.history.state, mallQuestRole: "hunter" }, "", `/client/${window.location.pathname.startsWith("/client/nfc/") ? "nfc" : "coin"}/${encodeURIComponent(updated.id)}${query ? `?${query}` : ""}`);
      } else {
        window.history.replaceState({ ...window.history.state, mallQuestRole: "hunter" }, "", pagePath("map"));
        setError("这条任务不存在、尚未发布或已下架，请选择其他宝藏。");
      }
    } else if (currentDetail) {
      setDetail(null); detailRef.current = null;
    }
    return next;
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!reward) queueMicrotask(() => { if (!cancelled) setShareOpen(false); });
    return () => { cancelled = true; };
  }, [reward]);
  useEffect(() => {
    let cancelled = false;
    const invalidate = () => { workRequestSeq.current++; };
    queueMicrotask(() => {
      if (cancelled) return;
      const expected = page === "staff" ? "admin" : "merchant";
      // Keep the current view mounted for a same-scope search/range refresh.
      // Clear immediately only when the authorized workspace identity changes.
      setWorkbench(previous => isWorkspace && game?.staff?.role === expected && previous?.scope.role === expected && previous.scope.storeId === game.staff.storeId ? previous : null);
      if (isWorkspace && game?.staff?.role === expected) refreshWorkbench().catch(e => {
        if (!cancelled) { workbenchReadError.current = e.message; setError(e.message); }
      });
    });
    return () => { cancelled = true; invalidate(); };
  }, [page, isWorkspace, game?.staff?.role, game?.staff?.storeId, refreshWorkbench]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const view = normalizeEditionLocation();
      const historyState = { ...window.history.state };
      delete historyState.mallQuestModal;
      delete historyState.mallQuestModalKind;
      window.history.replaceState(
      { ...historyState, mallQuestRole: view.role, mallQuestDepth: Number.isSafeInteger(window.history.state?.mallQuestDepth) ? Math.max(0, window.history.state.mallQuestDepth) : 0 },
      "",
    );
    setPage(view.page);
    setRole(view.role);
    setStaffTab(view.tab);
      refresh().catch((e) => { if (!cancelled) setError(e.message); });
    });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    const restore = () => {
      const pendingRegistration = registrationNavigation.current;
      if (pendingRegistration) {
        if (window.location.href !== pendingRegistration.url)
          window.history.pushState(pendingRegistration.state, "", pendingRegistration.url);
        setError("注册结果还待核对，请先核对申请状态，再离开页面。");
        return;
      }
      setScreenTransition("screen-default");
      const view = normalizeEditionLocation();
      setPage(view.page);
      setRole(view.role);
      setStaffTab(view.tab);
      setError("");
      setReward(null);
      setShareOpen(false);
      setInviteLink(null);
      setScanOpen(false);
      const task = game?.tasks.find((t) => t.id === view.taskId) || null;
      const entry = coinEntryFromUrl();
      setCoinEntryToken(entry.token); setCoinEntryError(entry.error);
      setDetail(task);
      detailRef.current = task;
      setOpenClues([0, 1]);
      setAnswer("");
      if (game && !task && /^\/client\/(coin|task|nfc)\//.test(window.location.pathname)) {
        window.history.replaceState({ ...window.history.state, mallQuestRole: "hunter" }, "", pagePath("map"));
        setError("这条任务不存在、尚未发布或已下架，请选择其他宝藏。");
      }
      if (task) {
        setFloor(task.floor);
        setSelected(task.id);
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [game]);
  useEffect(() => {
    let cancelled = false;
    const invalidate = () => { staffRequestSeq.current++; };
    queueMicrotask(() => {
      if (cancelled) return;
      setStaffData(null);
      setReviewHistory(null);
      if (isWorkspace && hasStaff) refreshWorkspace().catch(e => { if (!cancelled) setError(e.message); });
    });
    return () => { cancelled = true; invalidate(); };
  }, [page, isWorkspace, hasStaff, game?.staff?.role, game?.staff?.storeId, refreshWorkspace]);
  const closeDetail = useCallback(() => {
      if (/^\/client\/(coin|task|nfc)\//.test(window.location.pathname) && window.history.state?.mallQuestPreviousPath === pagePath("map") && window.history.state?.mallQuestDepth > 0) { window.history.back(); return; }
      setDetail(null);
      detailRef.current = null;
      if (/^\/client\/(coin|task|nfc)\//.test(window.location.pathname))
        if (window.history.state?.mallQuestPreviousPath === pagePath("map") && window.history.state?.mallQuestDepth > 0) window.history.back();
        else window.history.replaceState(
          { ...window.history.state, mallQuestRole: "hunter" },
          "",
          pagePath("map"),
        );
    }, []),
    closeReward = useCallback(() => closeTransientHistory(), [closeTransientHistory]),
    closeShare = useCallback(() => setShareOpen(false), []),
    closeHelp = useCallback(() => closeTransientHistory(), [closeTransientHistory]),
    closeInvite = useCallback(() => closeTransientHistory(), [closeTransientHistory]),
    closeHistory = useCallback(() => closeTransientHistory(), [closeTransientHistory]);
  async function act(action: string, payload: Record<string, unknown>, propagateError = false, retryConfirmed = false) {
    if (actionBusy.current) return null;
    const actionGame = latestGame.current;
    if (pendingOperationRef.current && !retryConfirmed && !["staffLogin", "staffLogout", "playerLogin", "playerLogout"].includes(action)) {
      const message = "上一次操作的结果仍待核对，请先点击“核对结果”。";
      setError(message); if (propagateError) throw new Error(message); return null;
    }
    actionBusy.current = true;
    setBusy(true);
    setError("");
    gameRequestSeq.current++;
    staffRequestSeq.current++;
    if (["staffLogin", "staffLogout", "accountLogin", "emailLogin", "recordingLogin", "playerLogout"].includes(action)) {
      staffRequestSeq.current++;
      setStaffData(null);
      setReviewHistory(null);
      workRequestSeq.current++;
      setWorkbench(null);
    }
    try {
      let body = payload;
      if (action === "place") {
        const key = JSON.stringify(payload);
        if (placementRequest.current?.key !== key) placementRequest.current = { key, id: browserRequestId() };
        body = { ...payload, requestId: placementRequest.current.id };
      }
      // Explicit sign-in intentionally replaces the browser's current account.
      // A stale page from another tab must not block credential verification;
      // recording login keeps its server localhost/flag/identity gates. Business
      // mutations retain their actor snapshot, and every sign-in still checks
      // the resulting account/role against the refreshed server session below.
      const explicitSignIn = ["accountLogin", "staffLogin", "recordingLogin"].includes(action);
      const result = await request<ActionResult>(action, body, "player", explicitSignIn ? {} : { expectedPlayerId: actionGame?.player.id });
      if (pendingOperationRef.current?.action === action) {
        pendingOperationRef.current = null; setPendingOperation(null);
      }
      if (action === "place") placementRequest.current = null;
      let message = result.message || "已保存";
      const signingIn = ["staffLogin", "accountLogin", "emailLogin", "recordingLogin"].includes(action);
      try {
        const next = await refresh();
        const workspaceLogin = payload.role === "admin" || payload.role === "merchant";
        if (signingIn && (!next.player.accountId || next.player.accountId !== result.accountId || next.player.username !== result.username || next.player.accountRole !== payload.role || (!workspaceLogin && !next.player.accountAuthenticated) || (workspaceLogin && (next.staff?.role !== payload.role || (payload.role === "merchant" && next.staff?.storeId !== result.storeId))))) {
          message = "登录身份已在其他标签页改变，请重新登录。";
          setSyncNotice(message); notify(message); return null;
        }
        if (isWorkspace && next.staff) { await refreshWorkspace(); await refreshWorkbench(); }
      } catch {
        if (signingIn) throw new GameApiError("登录请求已完成，但暂时无法核对身份。请刷新页面确认登录状态。", { kind: "network", method: "POST", requestSent: true, resultUncertain: true });
        setSyncNotice("操作已保存，暂时无法刷新记录。请点右上角刷新重试。");
      }
      notify(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      if (isUncertainResult(e) && ["place", "claim", "redeem"].includes(action) && actionGame) {
        const current = actionGame;
        const operation: PendingOperation = { action: action as PendingOperation["action"], payload: JSON.parse(JSON.stringify(payload)),
          playerId: current.player.id, storeId: action === "claim" ? current.tasks.find(task => task.id === payload.taskId)?.storeId : current.staff?.storeId || undefined,
          requestId: action === "place" ? placementRequest.current?.id : undefined, checked: false };
        pendingOperationRef.current = operation; setPendingOperation(operation);
        setSyncNotice("请求结果尚未确认。先核对最新记录，再决定是否重试同一次操作。");
      }
      if (propagateError) throw e;
      return null;
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }
  async function workAction(action: string, payload: Record<string, unknown>) {
    if (["opsUserDetail", "accountApplications", "accountApplication"].includes(action)) return request<unknown>(action, payload);
    const result = await act(action, payload, true);
    if (!result) throw new Error("操作未完成，请查看页面提示并重试");
    return result;
  }
  async function merchantProfileAction(action: string, payload: Record<string, unknown>, playerId: string, accountId: string | undefined, storeId: string) {
    if (!["merchantProfileSave", "workbenchState"].includes(action)) throw new GameApiError("门店资料操作不正确", { kind: "invalid-request", method: "POST" });
    const sameActor = () => {
      const current = latestGame.current;
      return current?.player.id === playerId && current.player.accountId === accountId
        && current.staff?.role === "merchant" && current.staff.storeId === storeId;
    };
    if (!sameActor()) throw new GameApiError("商家身份已变化，请回到原门店编辑或核对资料", { kind: "invalid-request", method: "POST" });
    const reading = action === "workbenchState";
    // Keep the editor's actor snapshot across its asynchronous draft flush.
    // An old editor must never dispatch a formal write for a newly logged-in store.
    const readSequence = reading ? ++workRequestSeq.current : null;
    const result = reading ? await request<WorkbenchData>(action, { ...payload, range: workRange, search: workSearch }, "workspace", { expectedPlayerId: playerId }) : await workAction(action, payload);
    if (!sameActor()) throw new GameApiError("商家身份已变化，请回到原门店核对保存结果", { kind: "invalid-request", method: "POST", requestSent: true, resultUncertain: !reading });
    if (reading) {
      const next = result as WorkbenchData, current = latestGame.current!;
      if (readSequence !== workRequestSeq.current || !next || next.scope?.role !== "merchant" || next.scope.storeId !== storeId || next.store?.id !== storeId)
        throw new GameApiError("门店资料查询已变化，请重新核对原保存", { kind: "invalid-response", method: "POST", requestSent: true });
      setWorkbench(next);
      // A successful original-save check must also update the visible summary,
      // even when the first post-save refresh failed.
      const updatedGame = { ...current, stores: current.stores.map(store => store.id === storeId ? next.store! : store) };
      gameRequestSeq.current++;
      latestGame.current = updatedGame;
      setGame(updatedGame);
    }
    return result;
  }
  async function accountAction(action: string, payload: Record<string, unknown>) {
    if (action === "accountApplicationStatus") return request<ActionResult>(action, payload);
    if (!["accountRegister", "accountLogin", "staffLogin", "recordingLogin", "emailCodeSend", "emailLogin", "accountEmailBind"].includes(action)) throw new Error("账号操作不正确");
    return act(action, payload, true, true);
  }
  async function nfcAction(action: string, payload: Record<string, unknown>) {
    const reads = ["nfcClaimStatus", "nfcDrafts", "nfcDraftOperationStatus"];
    if (![...reads, "nfcClaim", "nfcDraftRevalidate", "nfcDraftDelete"].includes(action)) throw new Error("领取操作不正确");
    const player = latestGame.current?.player;
    if (!player?.accountAuthenticated) throw new GameApiError("请登录玩家账号后再领取", { kind: "invalid-request", method: "POST" });
    const reading = reads.includes(action);
    if (!reading && (actionBusy.current || pendingOperationRef.current)) throw new GameApiError("请先完成或核对当前操作", { kind: "invalid-request", method: "POST" });
    const result = reading ? await request<unknown>(action, payload, "player", { expectedPlayerId: player.id }) : await act(action, payload, true);
    if (latestGame.current?.player.id !== player.id || latestGame.current?.player.accountId !== player.accountId)
      throw new GameApiError("账号已变化，请回到原账号核对领取结果", { kind: "invalid-request", method: "POST", requestSent: true, resultUncertain: !reading });
    if (!result) throw new GameApiError("领取结果未确认，请查询原请求", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: !reading });
    return result;
  }
  async function merchantClaimAction(action: string, payload: Record<string, unknown>) {
    const reads = ["merchantPendingClaims", "merchantPendingQueue", "merchantIssueClaimStatus"];
    if (![...reads, "merchantIssueClaim"].includes(action)) throw new Error("金币发券操作不正确");
    const current = latestGame.current;
    if (current?.staff?.role !== "merchant" || !current.staff.storeId) throw new GameApiError("请登录本店商家账号", { kind: "invalid-request", method: "POST" });
    const reading = reads.includes(action);
    if (!reading && (actionBusy.current || pendingOperationRef.current)) throw new GameApiError("请先完成或核对当前操作", { kind: "invalid-request", method: "POST" });
    const result = reading ? await request<unknown>(action, payload, "player", { expectedPlayerId: current.player.id }) : await act(action, payload, true);
    const next = latestGame.current;
    if (next?.player.id !== current.player.id || next.player.accountId !== current.player.accountId || next.staff?.role !== "merchant" || next.staff.storeId !== current.staff.storeId)
      throw new GameApiError("商家身份已变化，请回到原门店核对发券结果", { kind: "invalid-request", method: "POST", requestSent: true, resultUncertain: !reading });
    if (!result) throw new GameApiError("发券结果未确认，请查询原请求", { kind: "invalid-response", method: "POST", requestSent: true, resultUncertain: !reading });
    return result;
  }
  async function recordingCouponAction(action: string, payload: Record<string, unknown>) {
    if (!["recordingCouponGrant", "recordingCouponStatus"].includes(action)) throw new Error("展示券操作不正确");
    const current = latestGame.current;
    if (!current?.recordingCouponAllowed || !current.player.accountAuthenticated) throw new Error("当前账号未启用展示券，请刷新并使用玩家账号");
    const result = await request<unknown>(action, payload, "player", { expectedPlayerId: current.player.id });
    const next = latestGame.current;
    if (next?.player.id !== current.player.id || next.player.accountId !== current.player.accountId || !next.recordingCouponAllowed) throw new Error("账号或录制模式已变化，请回到原账号核对卡包");
    return result;
  }
  const scannedCode = useCallback((code: string) => { setRedeemCode(code.trim().toUpperCase()); setCouponLookupAttempt(value => value + 1); setError(""); setScanOpen(false); }, []);
  const switchWorkTab = (tab: string, openScanner = false) => {
    if (actionBusy.current || storeActivityBusy) return;
    const commit = () => {
      setStaffTab(tab); setError(""); setScanOpen(openScanner);
      if (openScanner) setRedeemCode("");
      const path = page === "staff"
        ? `/staff/${tab === "overview" ? "stats" : tab === "system" ? "settings" : tab}`
        : `/merchant/${tab === "overview" ? "dashboard" : tab === "redeem" ? "verify" : tab === "info" ? "profile" : tab === "devices" ? "coins" : tab}`;
      if (window.location.pathname !== path) pushGamePath(path, role);
      window.scrollTo({ top: 0 });
    };
    commit();
  };
  const openTask = (task: Task, origin?: HTMLElement) => {
    setCoinEntryToken(undefined); setCoinEntryError(""); setCoinConfirmation(null);
    setTaskOrigin(cardOrigin(origin));
    pushGamePath(`/client/coin/${encodeURIComponent(task.id)}`, "hunter");
    setDetail(task);
    detailRef.current = task;
    setOpenClues([0, 1]);
    setAnswer("");
    setError("");
  };
  const openReward = (coupon: Coupon, origin?: HTMLElement) => {
    setRewardOrigin(cardOrigin(origin));
    setDetail(null); detailRef.current = null;
    if (/^\/client\/(coin|task|nfc)\//.test(window.location.pathname))
      window.history.replaceState({ ...window.history.state, mallQuestRole: "hunter" }, "", pagePath("map"));
    setReward(coupon); setShareOpen(false); setFeedbackComment(""); setFeedbackValue(3);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制");
      return true;
    } catch {
      notify("无法自动复制，可长按选择文字");
      return false;
    }
  };
  const ownNavigation = (next: Page, login = false) => {
    const target = editionNavigation(next, login);
    if (next === "entry" && editionScope() === "workspace" && latestGame.current?.staff?.role === (target.page === "staff" ? "admin" : "merchant"))
      return { ...target, login: false };
    return target;
  };
  const commitNavigation = (next: Page, preferredRole?: Role, login = false) => {
    const target = ownNavigation(next, login); next = target.page; login = target.login;
    const nextRole =
      preferredRole ||
      (["create", "placements"].includes(next)
        ? "explorer"
        : ["map", "wallet", "footprint"].includes(next)
          ? "hunter"
          : role);
    setRole(nextRole);
    try {
      sessionStorage.setItem("mall-quest-role", nextRole);
    } catch {}
    const path = login && (next === "merchant" || next === "staff") ? `/${next === "staff" ? "staff" : "merchant"}/login` : next === "login" && nextRole === "explorer" ? "/client/explorer/login" : pagePath(next);
    if (window.location.pathname !== path || window.location.search)
      pushGamePath(path, nextRole);
    else
      window.history.replaceState(
        { ...window.history.state, mallQuestRole: nextRole },
        "",
        path,
      );
    setPage(next);
    setDetail(null);
    setReward(null);
    setShareOpen(false);
    setInviteLink(null);
    setScanOpen(false);
    setDeleteItem(null);
    if (next === "merchant" || next === "staff") {
      setStaffTab(login ? "login" : "overview");
    }
    setReviewHistory(null);
    setError("");
    window.scrollTo({ top: 0 });
  };
  const navigate = (next: Page, preferredRole?: Role, login = false) => {
    if (registrationPending) { setError("注册结果还待核对，请先核对申请状态，再离开页面。"); return; }
    if (isWorkspace && (actionBusy.current || storeActivityBusy)) return;
    const target = ownNavigation(next, login); next = target.page; login = target.login;
    const clientPages = ["map", "wallet", "profile", "placements", "create", "footprint", "achievements", "help", "settings", "geofence"];
    const children = ["footprint", "achievements", "help", "settings", "geofence"];
    const animated = (clientPages.includes(page) && clientPages.includes(next) && next !== page || isWorkspace && ["merchant", "staff"].includes(next) && (next !== page || staffTab !== "overview" || login)) && !preferences.reduceMotion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transition = children.includes(next) && !children.includes(page) ? "screen-into-child" : !children.includes(next) && children.includes(page) ? "screen-out-of-child" : "screen-default";
    setScreenTransition(animated ? transition : "screen-default");
    commitNavigation(next, preferredRole, login);
  };
  async function finishPublication() {
    const playerId = latestGame.current?.player.id;
    const key = playerId && creator.value.submissionId ? `${playerId}:${creator.value.submissionId}` : null;
    // Clearing emits intermediate snapshots with the submitted UUID still present.
    // Mark it handled before those snapshots can trigger draft recovery.
    submissionRecoveryGeneration.current++;
    if (key) recoveredSubmissions.current.add(key);
    try { await creator.clear(); }
    catch {
      if (key) recoveredSubmissions.current.delete(key);
      setSyncNotice("投稿已提交，草稿清理暂未确认。再次进入创作页可核对并清理；请勿重复创建这次投稿。");
    }
    if (routeView(window.location.pathname).page === "create") navigate("placements");
  }
  function clearPendingOperation() { pendingOperationRef.current = null; setPendingOperation(null); }
  async function finishPendingOperation(operation: PendingOperation, result: ActionResult) {
    clearPendingOperation(); setError(""); setSyncNotice("");
    if (operation.action === "place") await finishPublication();
    else if (operation.action === "claim" && result.coupon) openReward(result.coupon);
    else if (operation.action === "redeem") {
      setRedeemCode(""); setCouponLookup(null);
      try { await refreshWorkspace(); await refreshWorkbench(); }
      catch { setSyncNotice("核销状态已确认，流水暂时无法刷新。请稍后刷新查看。"); }
    }
    notify(result.message || "已核对最新记录");
  }
  async function verifyPendingOperation() {
    const operation = pendingOperationRef.current;
    if (!operation || checkingOperationRef.current || actionBusy.current) return;
    checkingOperationRef.current = true; setCheckingOperation(true); setError("");
    try {
      const next = await refresh();
      if (pendingOperationRef.current !== operation) return;
      if (next.player.id !== operation.playerId || operation.action === "redeem" && (next.staff?.role !== "merchant" || next.staff.storeId !== operation.storeId)) {
        clearPendingOperation(); throw new Error("账号或门店身份已变化，请回到原账号查看这次操作结果。");
      }
      if (operation.action === "place" && next.placements.some(task => task.id === operation.requestId)) {
        await finishPendingOperation(operation, { message: "已找到这次投稿，无需再次提交" }); return;
      }
      if (operation.action === "claim") {
        const coupon = next.coupons.find(coupon => coupon.storeId === operation.storeId);
        if (coupon) { await finishPendingOperation(operation, { coupon, newlyIssued: false, message: "奖励已到账，已为你打开卡包" }); return; }
      }
      if (operation.action === "redeem") {
        const result = await request<CouponPreview>("couponPreview", { code: operation.payload.code });
        if (pendingOperationRef.current !== operation) return;
        if (result.coupon?.redeemedAt) { await finishPendingOperation(operation, { message: "这次奖励已确认，无需再次提交" }); return; }
        if (!result.canRedeem) throw new Error(result.message);
      }
      const checked = { ...operation, checked: true };
      pendingOperationRef.current = checked; setPendingOperation(checked);
      setSyncNotice("最新记录尚未确认这次操作，可重试同一次请求；不会生成新的投稿标识。");
    } catch (e) { setError((e as Error).message); }
    finally { checkingOperationRef.current = false; setCheckingOperation(false); }
  }
  async function retryPendingOperation() {
    const operation = pendingOperationRef.current;
    if (!operation?.checked || checkingOperationRef.current || actionBusy.current) return;
    if (latestGame.current?.player.id !== operation.playerId) { setError("账号已变化，请先核对原账号的操作结果。"); return; }
    if (operation.action === "place" && operation.requestId) placementRequest.current = { key: JSON.stringify(operation.payload), id: operation.requestId };
    let payload = operation.payload;
    if (operation.action === "claim") {
      checkingOperationRef.current = true; setCheckingOperation(true);
      try {
        const location = await readBrowserLocation();
        if (pendingOperationRef.current !== operation || latestGame.current?.player.id !== operation.playerId) return;
        payload = { ...payload, location };
        setCoinPosition({ taskId: String(payload.taskId), location });
      } catch (e) { setError((e as Error).message); return; }
      finally { checkingOperationRef.current = false; setCheckingOperation(false); }
    }
    const result = await act(operation.action, payload, false, true);
    if (result) await finishPendingOperation(operation, result);
    else if (pendingOperationRef.current) {
      const next = { ...pendingOperationRef.current, checked: false };
      pendingOperationRef.current = next; setPendingOperation(next);
    }
  }
  const restoredSubmission = creator.value.submissionId;
  const draftPlayerId = game?.player.id;
  const draftPause = creator.pause;
  useEffect(() => {
    if (page !== "create" || !creator.loaded || !restoredSubmission || !draftPlayerId || creatorSubmissionBusy.current || pendingOperationRef.current) return;
    const key = `${draftPlayerId}:${restoredSubmission}`;
    if (recoveredSubmissions.current.has(key)) return;
    recoveredSubmissions.current.add(key);
    const draft = creator.value;
    const generation = submissionRecoveryGeneration.current;
    queueMicrotask(() => {
      if (generation !== submissionRecoveryGeneration.current) return;
      if (latestGame.current?.player.id !== draftPlayerId || routeView(window.location.pathname).page !== "create" || pendingOperationRef.current) {
        recoveredSubmissions.current.delete(key); return;
      }
      draftPause();
      const payload = { storeId: draft.storeId, title: draft.title, clues: draft.clues, ...draft.options };
      placementRequest.current = { key: JSON.stringify(payload), id: restoredSubmission };
      const operation: PendingOperation = { action: "place", payload, playerId: draftPlayerId, requestId: restoredSubmission, checked: false };
      pendingOperationRef.current = operation; setPendingOperation(operation);
    });
  }, [page, creator.loaded, creator.value, draftPlayerId, draftPause, restoredSubmission]);
  function pendingNotice() {
    if (!pendingOperation) return null;
    const label = pendingOperation.action === "place" ? "投稿" : pendingOperation.action === "claim" ? "领奖" : "核销";
    return <aside className="pending-operation" role="status" aria-live="polite"><strong>{label}结果待确认</strong>
      <p>{pendingOperation.checked ? "最新记录尚未确认这次操作，可以重试同一次请求。" : "先核对服务器中的最新记录，避免重复操作。你的输入仍保留。"}</p>
      <div><button type="button" className="ui-button ui-button-secondary" disabled={busy || checkingOperation} onClick={() => void verifyPendingOperation()}>{checkingOperation ? "正在核对…" : "核对结果"}</button>
      {pendingOperation.checked && <button type="button" className="ui-button ui-button-primary" disabled={busy || checkingOperation} onClick={() => void retryPendingOperation()}>重试同一次{label}</button>}</div></aside>;
  }
  const navItems = isWorkspace
    ? [
        {
          id: "overview", label: "数据概览", icon: LayoutDashboard,
        },
        ...(page === "staff" ? [
          { id: "users", label: "用户管理", icon: UserRound },
          { id: "review", label: "内容审核", icon: ShieldCheck },
          { id: "merchants", label: "商家管理", icon: StoreIcon },
          { id: "accounts", label: "入驻与账号审核", icon: UserRound },
          { id: "system", label: "系统设置", icon: Settings2 },
          { id: "geofence", label: "电子围栏", icon: MapPin },
          { id: "activities", label: "活动审核", icon: Megaphone },
        ] : [
          { id: "coupons", label: "奖励与库存", icon: Ticket },
          { id: "devices", label: "金币管理", icon: Coins },
          { id: "redeem", label: "优惠券核销", icon: CheckCircle2 },
          { id: "info", label: "商家信息", icon: StoreIcon },
          { id: "geofence", label: "电子围栏", icon: MapPin },
          { id: "activities", label: "门店活动", icon: Megaphone },
        ]),
      ]
    : role === "hunter"
      ? [
          { id: "map", label: "寻宝地图", icon: Map },
          { id: "wallet", label: "我的卡包", icon: Ticket },
          { id: "profile", label: "我的", icon: UserRound },
        ]
      : [
          { id: "placements", label: "我的投放", icon: NotebookPen },
          { id: "create", label: "投放", icon: PenLine },
          { id: "profile", label: "我的", icon: UserRound },
        ];
  const heading: Record<Page, string> = {
    entry: "选择探索身份",
    login: "登录探索账号",
    map: "寻宝地图",
    wallet: "我的卡包",
    create: "投放",
    placements: "我的投放",
    profile: "我的",
    footprint: "我的足迹",
    achievements: "成就中心",
    help: "帮助中心",
    settings: "体验设置",
    geofence: "附近门店",
    merchant: "商家工作台",
    staff: "运营审核台",
  };
  const claimedCount = game?.coupons.filter(c => !c.demo).length || 0;
  const visitedStoreCount = new Set(game?.coupons.filter(c => !c.demo).map(c => c.storeId) || []).size;
  const couponStatus = (coupon: Coupon) => coupon.rewardType === "points" ? "points" : coupon.redeemedAt ? "used" : coupon.status === "expired" || (!!coupon.validEnd && coupon.validEnd <= currentTime) ? "expired" : "unused";
  const placementStatus = (task: Task) => task.status === "published" && task.expiresAt && task.expiresAt < currentTime ? "expired" : task.status === "published" && (task.claimedCount || 0) > 0 ? "found" : task.status;
  const activeMerchantStore = game?.stores.find(s => s.id === game.staff?.storeId);
  const merchantAuthorized = page === "merchant" && game?.staff?.role === "merchant" && staffData?.scope.role === "merchant" && staffData.scope.storeId === game.staff.storeId;
  const workbenchAuthorized = !!workbench && workbench.scope.role === game?.staff?.role && workbench.scope.storeId === game?.staff?.storeId;
  const matchingLookup = couponLookup?.code === redeemCode.trim().toUpperCase() && couponLookup?.storeId === game?.staff?.storeId ? couponLookup : null;
  const redeemPreview = matchingLookup?.coupon;
  const redeemUpcoming = !!redeemPreview && (redeemPreview.status === "upcoming" || (!!redeemPreview.validStart && redeemPreview.validStart > currentTime));
  const cannotRedeem = couponLookupBusy || !matchingLookup?.canRedeem || !merchantAuthorized || !redeemPreview || redeemPreview.storeId !== game?.staff?.storeId || couponStatus(redeemPreview) !== "unused" || redeemUpcoming;
  const coinConfirmed = coinConfirmation?.key === coinConfirmationKey && !coinEntryError;
  const coinEntryExpired = !!coinConfirmation?.expiresAt && coinConfirmation.expiresAt <= currentTime;
  const fixedBack = page === "create" ? { to: pagePath("placements"), label: "返回我的投放" }
    : ["footprint", "achievements", "help", "settings", "geofence"].includes(page) ? { to: pagePath("profile"), label: "返回我的" }
    : page === "merchant" && staffTab !== "overview" ? { to: pagePath("merchant"), label: "返回数据概览" }
    : page === "staff" && staffTab !== "overview" ? { to: pagePath("staff"), label: "返回数据概览" }
    : ["wallet", "profile"].includes(page) ? { to: pagePath(role === "explorer" ? "placements" : "map"), label: "返回探索首页" }
    : { to: editionEntryPath(), label: PROJECT_EDITION === "full" || PROJECT_EDITION === "client" ? "切换入口" : "返回本端首页" };
  const primaryClientPage = !isWorkspace && navItems.some(item => item.id === page);
  const showBack = !primaryClientPage;
  if (page === "entry")
    return (
      <ReferenceEntry
        showWorkspaceEntries={PROJECT_EDITION === "full"}
        theme={preferences.theme}
        onEnter={(next) => {
          if (next === "map" || next === "placements") {
            navigate("login", next === "placements" ? "explorer" : "hunter");
          } else navigate(next, undefined, true);
        }}
        ready={!!game}
        error={error}
        onRetry={() =>
          refresh().catch((e) => setError(e.message))
        }
      />
    );
  const requiresClientLogin = !isWorkspace && page !== "login" && !!game && !game.player.authenticated;
  if (page === "login" || requiresClientLogin || (isWorkspace && (staffTab === "login" || (game && game.staff?.role !== (page === "staff" ? "admin" : "merchant"))))) {
    const workspace = isWorkspace, admin = page === "staff";
    return <RoleLoginScreen showWorkspaceEntryBack={PROJECT_EDITION === "full"} theme={preferences.theme} onThemeToggle={toggleTheme} reduceMotion={preferences.reduceMotion} title={workspace ? admin ? "运营端登录" : "商家端登录" : role === "explorer" ? "探索者登录" : "寻宝者登录"} subtitle={workspace ? "让每一次投放、审核与核销都有记录。" : "用同一个账号，发现宝藏，也分享你的发现。"} kind={workspace ? admin ? "admin" : "merchant" : role} navigationBlocked={registrationPending} onBlockedBack={() => setError("注册结果还待核对，请先核对申请状态，再离开页面。")} onBack={() => navigate("entry")} statusNotice={<NetworkStatus onRefresh={() => refresh()} busy={busy} />}> 
      {(error || syncNotice) && <div className="error-banner" role="alert"><span>{error || syncNotice}</span><button className="icon-button" aria-label="关闭登录提示" onClick={() => { setError(""); setSyncNotice(""); }}><X size={16} /></button></div>}
      {!game ? <Empty variant={error ? "error" : "loading"} title="正在准备登录" action={error ? <button className="outline-button" onClick={() => refresh().catch(e => setError(e.message))}>重新连接</button> : undefined} /> : workspace ? <WorkspaceLogin key={page} admin={admin} stores={game.stores} recordingShortcutAllowed={game.recordingShortcutAllowed} busy={busy} onAction={accountAction} onDone={() => navigate(page)} onRegistrationPendingChange={setRegistrationPending} /> : <PlayerLogin key={role} role={role} recordingShortcutAllowed={game.recordingShortcutAllowed} busy={busy} onAction={accountAction} onDone={() => { if (!requiresClientLogin) navigate(role === "explorer" ? "placements" : "map", role); }} onGuest={() => navigate("login", role)} onBack={() => navigate("entry")} onRegistrationPendingChange={setRegistrationPending} />}
    </RoleLoginScreen>;
  }
  return (
    <div
      className={`app-shell ${isWorkspace ? "workspace-shell reference-workspace" : "client-shell reference-client"} ${["footprint","achievements","help","settings","geofence"].includes(page) ? "child-screen" : ""} ${isWorkspace ? "without-mobile-nav" : ""}`}
      data-client-theme={preferences.theme}
      data-reduce-motion={preferences.reduceMotion || undefined}
    >
      <aside className="sidebar">
        <button className="brand" disabled={isWorkspace && storeActivityBusy} onClick={() => navigate("entry")} aria-label="返回首页" type="button">
          <BrandLogo />
          <span>
            逛道宝<small className="brand-english">wander about</small>
          </span>
        </button>
        <div className="mall-switch">
          <div className="mall-icon">
            <StoreIcon size={18} />
          </div>
          <span>
            星光里购物中心<small>演示商场</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <p className="nav-caption">{isWorkspace ? page === "staff" ? "运营工作空间" : "商家工作空间" : "你的探索空间"}</p>
        <WorkspaceNavOverflow navigationRef={workspaceNavRef} reduceMotion={preferences.reduceMotion} enabled={isWorkspace}>
        <nav aria-label="主导航" ref={workspaceNavRef}>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              disabled={isWorkspace && (busy || storeActivityBusy)}
              aria-current={(isWorkspace ? staffTab === id : page === id) ? "page" : undefined}
              className={
                (isWorkspace ? staffTab === id : page === id) ||
                (id === "profile" &&
                  ["footprint", "achievements", "help", "settings", "geofence"].includes(page))
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => isWorkspace ? switchWorkTab(id) : navigate(id as Page)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "wallet" && claimedCount > 0 && <i>{claimedCount}</i>}
              {isWorkspace && id === "review" && !!staffData?.pending.length && <i aria-label={`${staffData.pending.length}条待审核`}>{staffData.pending.length}</i>}
            </button>
          ))}
        </nav>
        </WorkspaceNavOverflow>
        {!isWorkspace && <div className="sidebar-role">
          <span className="mini-label">当前身份</span>
          <div className="role-toggle">
            <button
              className={role === "hunter" ? "active" : ""}
              onClick={() => navigate("map", "hunter")}
            >
              寻宝者
            </button>
            <button
              className={role === "explorer" ? "active" : ""}
              onClick={() => {
                navigate("placements", "explorer");
              }}
            >
              探索者
            </button>
          </div>
        </div>}
        <div className="sidebar-footer">
          {PROJECT_EDITION === "full" && page !== "merchant" && (
            <button onClick={() => navigate("merchant", undefined, true)}>
              <LayoutDashboard size={18} />
              商家演示
            </button>
          )}
          {PROJECT_EDITION === "full" && page !== "staff" && (
            <button onClick={() => navigate("staff", undefined, true)}>
              <ShieldCheck size={18} />
              运营审核
            </button>
          )}
          {!isWorkspace && <button onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            试玩说明
          </button>}
          {!isWorkspace && <button onClick={() => navigate("entry")}>
            <ArrowLeft size={18} />
            切换入口
          </button>}
          {merchantAuthorized && activeMerchantStore ? <div className="sidebar-merchant-info" aria-label="当前商家">
            <span className="avatar"><StoreIcon size={20} /></span>
            <span><strong>{activeMerchantStore.name}</strong><small>{activeMerchantStore.floor} · {activeMerchantStore.category}</small></span>
          </div> : <div className="sidebar-user">
            <span className="avatar">探</span>
            <span>
              {isWorkspace ? page === "staff" ? "运营管理员" : "商家身份" : game?.player.nickname || "正在准备探索"}
              <small>
                {isWorkspace ? "活动工作空间" : `Lv.${game?.player.level || 1} · ${role === "hunter" ? "寻宝者" : "探索者"}`}
              </small>
            </span>
          </div>}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar quest-theme-workspace-header">
          <div className="breadcrumb">
            {isWorkspace ? page === "staff" ? "运营工作空间" : "商家工作空间" : "探索空间"} <span>/</span> <strong>{heading[page]}</strong>
          </div>
          <button className="mobile-brand" disabled={isWorkspace && storeActivityBusy} onClick={() => navigate("entry")} aria-label="返回首页" type="button">
            <BrandLogo />
            <span>逛道宝<small className="brand-english">wander about</small></span>
          </button>
          <div className="topbar-actions">
            <span className="demo-label">DEMO · 演示权益</span>
            {isWorkspace && <ThemeToggle theme={preferences.theme} onToggle={toggleTheme} />}
            <button
              className="icon-button"
              aria-label="刷新活动数据"
              disabled={isWorkspace && (busy || storeActivityBusy)}
              onClick={() =>
                refresh()
                  .then(async (next) => { if (isWorkspace && next.staff) await Promise.all([refreshWorkspace(), refreshWorkbench()]); notify("已刷新"); })
                  .catch((e) => setError(e.message))
              }
            >
              <RefreshCw size={17} />
            </button>
            <button type="button" className="top-help" aria-label="打开试玩说明" aria-haspopup="dialog" onClick={() => setHelp(true)}>
              <HelpCircle size={17} />
              <span>试玩说明</span>
            </button>
            <span className="top-avatar">{isWorkspace ? page === "staff" ? "运" : "店" : "探"}</span>
          </div>
        </header>
        <main className={isWorkspace ? "content workspace-content" : `content screen-view ${screenTransition}`} key={isWorkspace ? "workspace" : `${page}:${role}`}>
          {!isWorkspace && (page !== "map" || !game) && <header className="reference-page-bar quest-theme-page-header">
            <ClientWordmark onHome={() => navigate("entry")} />
            <div className="quest-theme-header-actions">
              {page !== "settings" && <ThemeToggle theme={preferences.theme} onToggle={toggleTheme} />}
              <button type="button" className="icon-button" aria-label="刷新活动数据" onClick={() => refresh().then(() => notify("已刷新")).catch(e => setError(e.message))}><RefreshCw size={18}/></button>
              {page !== "help" && page !== "profile" && <button type="button" className="icon-button" aria-label="打开玩法帮助" onClick={() => navigate("help")}><HelpCircle size={18}/></button>}
            </div>
          </header>}
          {pendingNotice()}
          <div className={`page-heading${!isWorkspace && (["map", "wallet"].includes(page) || page === "achievements" && !!game) ? " reference-heading-hidden" : ""}`}>
            <div className="heading-main">
              {showBack && <BackButton {...fixedBack} showLabel={isWorkspace && staffTab === "overview"} navigationKey={`${page}:${staffTab}:${role}:${detail?.id || ""}`} onNavigate={(path) => navigate(routeView(path, role).page)} />}
              <div className="heading-copy">
              <div className="eyebrow">
                {isWorkspace
                  ? page === "staff"
                    ? "OPERATIONS STUDIO"
                    : "MERCHANT STUDIO"
                  : "A LITTLE DETOUR, A NEW DISCOVERY"}
              </div>
              <h1>
                {heading[page]}
                {page === "map" && (
                  <span className="heading-star" aria-hidden="true">
                    ✦
                  </span>
                )}
              </h1>
              <p>
                {page === "map"
                  ? "沿着线索走一走，发现那些被你错过的小店。"
                  : page === "create"
                    ? "给下一位路过的人，留一点发现的乐趣。"
                    : page === "wallet"
                      ? "每一张奖励，都记录着一次小小的发现。"
                      : isWorkspace
                        ? page === "staff"
                          ? "审核每一条线索，让发现有迹可循。"
                          : "查看门店奖励，让每次核销有迹可循。"
                        : page === "placements"
                          ? "看看你的线索，带来了多少次新的发现。"
                          : page === "footprint"
                            ? "每一次发现，都有一个值得记下的时刻。"
                            : page === "achievements"
                              ? "从第一份惊喜，到更多值得期待的发现。"
                              : page === "help"
                                ? "线索、奖励和创作，有疑问都可以来这里。"
                                : page === "settings"
                                  ? "选择让你更舒服的探索方式。"
                                  : page === "geofence"
                                    ? "查看真实门店范围，进入后确认金币与领奖。"
                              : "把闲逛变成探索，把发现变成故事。"}
              </p>
              </div>
            </div>
            {page === "map" && (
              <button
                className="outline-button desktop-only"
                onClick={() => {
                  setRole("explorer");
                  navigate("create");
                }}
              >
                <Plus size={17} />
                我也要埋宝藏
              </button>
            )}
            {page === "placements" && !(game && game.placements.length === 0 && placementFilter === "all") && (
              <button
                className="gold-button"
                onClick={() => navigate("create")}
              >
                <Plus size={17} />
                新建宝藏
              </button>
            )}
            {page === "merchant" && staffTab === "overview" && merchantAuthorized && <button className="gold-button" disabled={busy} onClick={() => switchWorkTab("redeem", true)}><ScanLine size={19} /> 扫码核销</button>}
          </div>
          {(error || syncNotice) && (
            <div className="error-banner" role="alert">
              <Flag size={17} />
              <span>{error || syncNotice}</span>
              <button onClick={() => { setError(""); setSyncNotice(""); }} aria-label="关闭错误提示">
                <X size={16} />
              </button>
            </div>
          )}
          {!game ? (
            <Empty variant={error ? "error" : "loading"} title={error ? "活动暂时连接不上" : "正在展开你的寻宝地图…"} body={error ? "保留当前输入，重新连接后继续。" : "正在准备任务与奖励记录。"} action={error ? <button
                className="outline-button"
                onClick={() =>
                  refresh().catch((e) => setError(e.message))
                }
              >
                重新连接
              </button> : undefined} />
          ) : (
            <>
              {page === "map" && <ReferenceHome theme={preferences.theme} onThemeToggle={toggleTheme} stores={game.stores} tasks={game.tasks} floor={floor} points={game.player.points || 0} claimedCount={claimedCount} displayName={game.player.nickname} role={role} onHome={() => navigate("entry")} onFloor={setFloor} onTask={(task, origin) => { setSelected(task.id); openTask(task, origin); }} onProfile={() => navigate("profile")} onRefresh={() => refresh().then(() => notify("已刷新")).catch(e => setError(e.message))} onWallet={() => navigate("wallet")} onNotifications={() => navigate("help")} onGeofence={() => navigate("geofence")} />}
              {page === "wallet" && <><PlayerClaimDrafts game={game} onAction={nfcAction} onOpenReward={coupon => { setWalletFilter("all"); openReward(coupon); }} onNewReward={coupon => celebration.celebrate(coupon.id)} onRefresh={async () => { await refresh(); }} /><ReferenceWallet coupons={game.coupons} now={currentTime} filter={walletFilter} onFilter={setWalletFilter} onOpen={openReward} onExplore={() => navigate("map")} /><RecordingCouponControl game={game} onAction={recordingCouponAction} onOpenReward={coupon => { setWalletFilter("all"); openReward(coupon); }} onNewReward={coupon => celebration.celebrate(coupon.id)} onRefresh={async () => { await refresh(); }} /></>}
              {page === "create" && (
                <CreatorWizard
                  stores={game.stores}
                  settings={game.settings}
                  dailyQuota={game.dailyQuota}
                  couponTemplates={game.couponTemplates}
                  options={creator.value.options}
                  onOptionsChange={options => creator.update(draft => ({ ...draft, options }))}
                  step={creator.value.step}
                  onStepChange={step => creator.update(draft => ({ ...draft, step }))}
                  draftStatus={creator.status}
                  draftMessage={creator.message}
                  onDraftRetry={() => creator.flush().then(() => creator.resume()).catch(e => setError(e.message))}
                  onDraftReload={() => creator.reload().then(() => creator.resume()).catch(e => setError(e.message))}
                  storeId={storeId}
                  title={title}
                  clues={clues}
                  busy={busy || creatorSubmitting || !!pendingOperation}
                  onStore={setStoreId}
                  onTitle={setTitle}
                  onClues={setClues}
                  onExample={() => {
                    const example = examples[storeId] || { title: "在这里，发现一个小惊喜", clues: ["从店铺招牌开始寻找。", "留意店铺所在楼层。", "找到一处独特的布置。", "观察你喜欢的一件物品。", "看清现场的观察问题。"] };
                    setClues(example.clues);
                    setTitle(example.title);
                  }}
                  onSubmit={async (options) => {
                    if (creatorSubmissionBusy.current || pendingOperationRef.current) return false;
                    creatorSubmissionBusy.current = true; setCreatorSubmitting(true);
                    try {
                      creator.update(draft => ({ ...draft, options }));
                      const draft = await creator.prepareSubmission();
                      const payload = { storeId: draft.storeId, title: draft.title, clues: draft.clues, ...draft.options };
                      placementRequest.current = { key: JSON.stringify(payload), id: draft.submissionId! };
                      const result = await act("place", payload);
                      if (result) { await finishPublication(); return true; }
                      if (!pendingOperationRef.current) await creator.cancelSubmission();
                      return false;
                    } catch (e) {
                      setError((e as Error).message);
                      if (!pendingOperationRef.current) creator.resume();
                      return false;
                    } finally { creatorSubmissionBusy.current = false; setCreatorSubmitting(false); }
                  }}
                />
              )}
              {page === "placements" && (
                <>
                  <ExplorerProgress game={game} />
                  <div className="stat-grid three">
                    {[
                      {
                        label: "我的作品",
                        value: game.placements.length,
                        icon: NotebookPen,
                      },
                      {
                        label: "成功领奖人数",
                        value: game.placements.reduce(
                          (a, t) => a + (t.claimedCount || 0),
                          0,
                        ),
                        icon: Compass,
                      },
                      {
                        label: "贡献积分",
                        value: game.contribution,
                        icon: Sparkles,
                      },
                    ].map((s) => (
                      <div className="stat-card" key={s.label}>
                        <s.icon />
                        <span>{s.label}</span>
                        <strong>{s.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div
                    className="tabs placement-filters"
                    aria-label="投放状态筛选"
                  >
                    {[
                      ["all", "全部"],
                      ["pending", "待审核"],
                      ["published", "寻宝中"],
                      ["found", "有人发现"],
                      ["expired", "已过期"],
                      ["rejected", "待修改"],
                      ["offline", "已下架"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={placementFilter === value}
                        className={placementFilter === value ? "active" : ""}
                        onClick={() => setPlacementFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="placements-list">
                    {game.placements
                      .filter(
                        (t) =>
                          placementFilter === "all" ||
                          placementStatus(t) === placementFilter,
                      )
                      .map((t) => (
                        <article className="surface placement-row" key={t.id}>
                          <div>
                            <span
                              className={`pill ${t.status === "published" ? "green" : t.status === "pending" ? "gold" : ""}`}
                            >
                              {statusLabels[placementStatus(t)] || t.status}
                            </span>
                            <h2>{t.title}</h2>
                            <p>
                              {t.storeName} · {t.floor} · {t.clues.length}条线索
                            </p>
                            {t.reviewNote && (
                              <p className="review-note">
                                审核意见：{t.reviewNote}
                              </p>
                            )}
                          </div>
                          <div className="placement-count">
                            <strong>{t.claimedCount || 0}</strong>
                            <span>成功领奖</span>
                          </div>
                          <button
                            className="outline-button"
                            onClick={async () => {
                              const originalStore = game.stores.find(
                                (s) => s.id === t.storeId && s.status !== "inactive",
                              );
                              if (!originalStore) {
                                notify("原门店当前不可用，请新建宝藏并选择门店。");
                                return;
                              }
                              if (pendingOperationRef.current) { setError("请先核对上一次操作，再重新投稿。"); return; }
                              try {
                                await creator.load();
                                const draft = emptyCreatorDraft(originalStore.id);
                                creator.update({ ...draft, title: t.title, clues: t.clues.slice(0, 5), options: {
                                  ...draft.options, difficulty: t.difficulty ?? 3,
                                  expiresAt: t.expiresAt && t.expiresAt > Date.now() ? t.expiresAt : null,
                                  rewardType: t.rewardType ?? "points", rewardValue: t.rewardValue ?? 50,
                                  rewardCouponId: t.rewardCouponId ?? null,
                                  photoURLs: Array.from({ length: 5 }, (_, index) => t.photoURLs?.[index] || ""),
                                } });
                                navigate("create");
                              } catch (e) { setError((e as Error).message); }
                            }}
                          >
                            以此重新投稿
                          </button>
                          <button className="text-button danger-button" disabled={busy} aria-label={`删除宝藏 ${t.title}`} onClick={() => setDeleteItem({ kind: "task", id: t.id, title: t.title })}><Trash2 size={16} /> 删除</button>
                        </article>
                      ))}
                  </div>
                  {!game.placements.some(t => placementFilter === "all" || placementStatus(t) === placementFilter) &&
                    <PlacementEmpty filter={placementFilter} hasPlacements={game.placements.length > 0} onCreate={() => navigate("create")} onShowAll={() => setPlacementFilter("all")} />}
                </>
              )}
              {page === "placements" && game.feedback.length > 0 && (
                <section
                  className="surface activity-log"
                  style={{ marginTop: 24 }}
                >
                  <h2>寻宝者的留言</h2>
                  {game.feedback.map((f, i) => (
                    <div className="log-row" key={i}>
                      <span className="log-icon">
                        <MessageCircle size={18} />
                      </span>
                      <div>
                        <strong>
                          {f.taskTitle} ·{" "}
                          {["", "不太清楚", "有点难", "刚刚好"][f.clarity]}
                        </strong>
                        <small>{f.comment || "留下了一次线索清晰度反馈"}</small>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              {page === "footprint" && (
                <FootprintPage game={game} onExplore={() => navigate("map")} />
              )}
              {page === "achievements" && <><ReferenceLevelCenter game={game} now={currentTime} onBack={() => navigate("profile")} /><AchievementPage game={game} compact /></>}
              {page === "help" && <HelpCenter onDemo={() => setHelp(true)} />}
              {page === "settings" && <ExperienceSettings preferences={preferences} onChange={next => { if (next.theme !== preferences.theme) switchTheme(next.theme); else setPreferences(next); }} ready={preferencesReady} />}
              {page === "geofence" && <GeofencePanel stores={game.stores} treasures={game.tasks} onOpenTask={openTask} onRefreshTasks={() => { refresh().catch(e => setError(e.message)); }} />}
              {page === "profile" && <><ReferenceProfile game={game} role={role} badges={getAchievements(game).filter(item => item.unlocked).length} visitedStoreCount={visitedStoreCount} onNavigate={navigate} onHelp={() => navigate("help")} onSettings={() => navigate("settings")} onLogin={() => navigate("login", role)} onLogout={async () => { if (!busy && await act("playerLogout", {})) navigate("entry"); }} onSwitchRole={(next) => navigate("profile", next)} onInvite={() => setInviteLink(`${window.location.origin}/client/map`)} onContribution={() => navigate("placements", "explorer")} busy={busy} />
              <WeeklyRanking game={game} />
              {!!game.ownFeedback?.length && <section className="surface my-feedback"><h2>我的留言</h2>{game.ownFeedback.map(item => <article key={item.id}><div><strong>{item.taskTitle}</strong><p>{item.comment || `线索清晰度 ${item.clarity} / 5`}</p></div><button className="text-button danger-button" disabled={busy} aria-label={`删除留言 ${item.taskTitle}`} onClick={() => setDeleteItem({ kind: "feedback", id: item.id, title: item.taskTitle })}><Trash2 size={16} /> 删除</button></article>)}</section>}
              </>}
              {isWorkspace && (
                <>
                  {game.staff &&
                  staffData &&
                  staffData.scope.role === game.staff.role &&
                  staffData.scope.storeId === game.staff.storeId &&
                  game.staff.role ===
                    (page === "staff" ? "admin" : "merchant") ? (
                    <>
                      <div className="staff-current">
                        <span className="pill green">
                          <CheckCircle2 size={13} />
                          {game.staff.role === "admin"
                            ? "运营审核身份"
                            : game.stores.find(
                                (s) => s.id === game.staff?.storeId,
                              )?.name + " · 商家身份"}
                        </span>
                        <span>统计来自本次活动记录</span>
                        <button className="text-button workspace-logout" disabled={busy || storeActivityBusy} onClick={async () => { if (await act("staffLogout", {})) navigate(page, undefined, true); }}><LogOut size={15} /> 退出工作台</button>
                      </div>
                      <div className="workspace-view wb-view-enter" key={`${page}:${staffTab}`} data-workspace-view={staffTab}>
                      {staffTab === "info" && page === "merchant" && activeMerchantStore && <MerchantInfo store={activeMerchantStore} data={staffData} devices={workbenchAuthorized && workbench ? workbench.devices : undefined} busy={busy}>{(onEditingChange, registerCloseGuard, onBack) => workbenchAuthorized && workbench ? <MerchantProfileEditor data={workbench} onAction={(action, payload) => merchantProfileAction(action, payload, game.player.id, game.player.accountId, activeMerchantStore.id)} busy={busy} operatorId={game.player.id} onEditingChange={onEditingChange} registerCloseGuard={registerCloseGuard} onBack={onBack} /> : null}</MerchantInfo>}
                      {workbenchAuthorized && workbench && staffTab === "devices" && <DeviceTaskManager data={workbench} onAction={workAction} busy={busy} />}
                      {workbenchAuthorized && workbench && staffTab === "coupons" && <CouponTemplateManager data={workbench} onAction={workAction} busy={busy} />}
                      {workbenchAuthorized && workbench && staffTab === "users" && <OperationsUsers data={workbench} onAction={workAction} busy={busy} operatorId={game.player.id} pendingAdjustments={operationsAdjustmentIntents} onSearch={async text => { setWorkSearch(text); await refreshWorkbench(workRange, text); }} />}
                      {workbenchAuthorized && workbench && staffTab === "merchants" && <OperationsMerchants data={workbench} onAction={workAction} busy={busy} />}
                      {workbenchAuthorized && workbench && staffTab === "accounts" && page === "staff" && <AccountApplicationManager onAction={workAction} busy={busy} onBusyChange={setStoreActivityBusy} />}
                      {workbenchAuthorized && workbench && staffTab === "system" && <OperationsSettings data={workbench} onAction={workAction} busy={busy} />}
                      {workbenchAuthorized && workbench && staffTab === "geofence" && <GeofencePanel stores={workbench.stores} storeId={page === "merchant" ? game.staff?.storeId || undefined : undefined} manage onActivities={page === "merchant" ? () => switchWorkTab("activities") : undefined} />}
                      {workbenchAuthorized && workbench && staffTab === "activities" && <StoreActivityManager key={`${workbench.scope.role}:${workbench.scope.storeId || "all"}`} scope={workbench.scope} stores={workbench.stores} reviewRequired={workbench.settings.ugcReview} onConfigureFence={() => switchWorkTab("geofence")} onBusyChange={setStoreActivityBusy} />}
                      {!workbenchAuthorized && ["devices", "users", "merchants", "system", "accounts"].includes(staffTab) && <Empty title="正在加载管理数据" body="如果连接失败，请点击右上角刷新重试。" />}
                      {staffTab === "overview" && (
                        <>
                          {workbenchAuthorized && workbench && <WorkbenchDashboard data={workbench} busy={busy} onReload={async range => { setWorkRange(range); await refreshWorkbench(range); }} onNavigate={switchWorkTab} />}
                          {!workbenchAuthorized && <Empty title="正在加载数据概览" body="连接失败时请点击右上角刷新重试。" />}
                          {page === "merchant" && <section className="surface activity-log merchant-recent-records" aria-label="最近领奖记录">
                            <div className="section-heading">
                              <div>
                                <h2>最近领奖记录</h2>
                                <p className="muted">本店当前活动最近8条优惠券与积分奖励，不受上方统计时间筛选影响。积分无需核销。</p>
                              </div>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  refreshWorkspace()
                                    .catch((e) => setError(e.message))
                                }
                              >
                                刷新领奖记录
                              </button>
                            </div>
                            {staffData.coupons.some(c => !c.demo) ? (
                              staffData.coupons.filter(c => !c.demo).slice(0, 8).map((c) => (
                                <div className="log-row" key={c.id}>
                                  <span className="log-icon">
                                    <Ticket size={19} />
                                  </span>
                                  <div>
                                    <strong>
                                      {c.storeName} · {c.reward}
                                    </strong>
                                    <small>
                                      发放时间：{new Date(c.issuedAt).toLocaleString(
                                        "zh-CN",
                                      )}{" "}
                                      {c.rewardType !== "points" && c.code ? <> · 券码：{c.code}</> : null}
                                    </small>
                                  </div>
                                  <span
                                    className={`pill ${c.redeemedAt ? "green" : "gold"}`}
                                  >
                                    {c.rewardType === "points" ? "积分已到账" : c.redeemedAt ? "已核销" : "未核销"}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="muted">
                                本店还没有奖励领取记录。玩家成功领取本店奖励后，会显示在这里；待领申请不计入。
                              </p>
                            )}
                          </section>}
                        </>
                      )}
                      {staffTab === "coupons" && (
                        <div className="inventory-grid">
                          {game.stores
                            .filter(
                              (s) =>
                                game.staff?.role === "admin" ||
                                s.id === game.staff?.storeId,
                            )
                            .map((s) => {
                              const count = staffData.coupons.filter(
                                (c) => c.storeId === s.id,
                              ).filter(c => !c.demo).length;
                              return (
                                <section
                                  className="surface inventory-card"
                                  key={s.id}
                                >
                                  <Art index={s.artwork} imageURL={s.imageURL} alt={s.name} />
                                  <div>
                                    <span className="pill">平台活动奖励</span>
                                    <h2>{s.name}</h2>
                                    <h3>{s.reward}</h3>
                                    <p>{s.conditions}</p>
                                    <button type="button" className="outline-button inventory-image-edit" disabled={busy} onClick={() => switchWorkTab("info")}><PenLine size={16} />修改门店图片</button>
                                    <div className="inventory-progress">
                                      <span>
                                        已发放 {count} / {s.stockTotal}
                                      </span>
                                      <strong>
                                        剩余 {s.stockTotal - count}
                                      </strong>
                                    </div>
                                    <progress
                                      value={count}
                                      max={s.stockTotal}
                                    />
                                    <small>核销不会恢复已发额度。</small>
                                  </div>
                                </section>
                              );
                            })}
                        </div>
                      )}
                      {staffTab === "review" && page === "staff" && (
                        <TaskReviewPanel
                          tasks={staffData.tasks}
                          pending={staffData.pending}
                          busy={busy}
                          onAction={act}
                          onDelete={task => setDeleteItem({ kind: "task", id: task.id, title: task.title })}
                          onHistory={async (task) => {
                            setError("");
                            setBusy(true);
                            try {
                              const seq = staffRequestSeq.current;
                              const { reviews: items } = await request<{ reviews: ReviewRecord[] }>(
                                "reviewHistory",
                                { taskId: task.id },
                              );
                              if (seq === staffRequestSeq.current)
                                setReviewHistory({ title: task.title, items });
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      )}
                      {staffTab === "redeem" && page === "merchant" && <MerchantClaimIssue game={game} onAction={merchantClaimAction} />}
                      {staffTab === "redeem" && (
                        <div className="redeem-layout">
                          <div className="redeem-entry">
                          <form
                            className="surface redeem-form"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (busy || cannotRedeem || !matchingLookup) return;
                              const r = await act("redeem", {
                                code: matchingLookup.code,
                              });
                              if (r) { setRedeemCode(""); setCouponLookup(null); }
                              else setCouponLookupAttempt(value => value + 1);
                            }}
                          >
                            <div className="redeem-icon">
                              <Ticket size={38} />
                            </div>
                            <h2>验证一份发现奖励</h2>
                            <p>扫描玩家卡包的个人券二维码，核对奖励与使用条件后确认核销。也可手动输入券码。</p>
                            <button className="outline-button full merchant-scan-button" type="button" disabled={busy || scanOpen} onClick={() => { setError(""); setScanOpen(true); }}><ScanLine size={20} /> {scanOpen ? "扫码已打开" : "扫码核销优惠券"}</button>
                            <label className="field-label">
                              优惠券核销码
                              <input
                                aria-label="优惠券核销码"
                                required
                                maxLength={80}
                                placeholder="GTB-XXXXXXXXXXXX"
                                value={redeemCode}
                                onChange={(e) =>
                                  setRedeemCode(e.target.value.toUpperCase())
                                }
                              />
                            </label>
                            {redeemPreview && <div className="notice redeem-coupon-preview" aria-live="polite"><div>{redeemPreview.demo && <span className="pill">功能展示券 · 不可实际消费</span>}<strong>{redeemPreview.reward}</strong><p>{redeemPreview.storeName}</p><p>{redeemPreview.conditions}</p>{redeemPreview.validStart && <small>生效时间 {new Date(redeemPreview.validStart).toLocaleString("zh-CN")}</small>}{redeemPreview.validEnd && <small>有效期至 {new Date(redeemPreview.validEnd).toLocaleString("zh-CN")}</small>}<p>{couponStatus(redeemPreview) === "points" ? "积分已入账，无需核销" : couponStatus(redeemPreview) === "used" ? "这张券已经使用" : couponStatus(redeemPreview) === "expired" ? "这张券已经过期" : redeemUpcoming ? "这张券尚未生效" : "请与用户确认奖励与使用条件"}</p></div></div>}
                            {couponLookupBusy && <p className="muted" role="status" aria-live="polite">正在查询这张券…</p>}
                            {!!matchingLookup && !couponLookupBusy && <button type="button" className="text-button" disabled={busy} onClick={() => setCouponLookupAttempt(value => value + 1)}>重新查询状态</button>}
                            {!!redeemCode.trim() && !couponLookupBusy && couponLookupError && <div className="inline-error" role="status"><p>{couponLookupError}</p><button className="text-button" type="button" onClick={() => setCouponLookupAttempt(value => value + 1)}>重新查询</button></div>}
                            <button
                              className="gold-button full"
                              disabled={busy || cannotRedeem}
                            >
                              {busy ? "核销中…" : couponLookupBusy ? "正在查询…" : "确认核销"}
                            </button>
                            <small>
                              <ShieldCheck size={15} />
                              每张券仅能使用一次，只核销所属门店的券。
                            </small>
                          </form>
                          {scanOpen && <CouponScanner onCode={scannedCode} onClose={() => setScanOpen(false)} />}
                          </div>
                          <section className="surface activity-log">
                            <h2>核销流水</h2>
                            {staffData.coupons
                              .filter((c) => c.redeemedAt)
                              .map((c) => (
                                <div className="log-row" key={c.id}>
                                  <span className="log-icon">
                                    <Check size={19} />
                                  </span>
                                  <div>
                                    <strong>{c.reward}</strong>
                                    <small>
                                      {c.code}
                                      <br />
                                      {new Date(c.redeemedAt!).toLocaleString(
                                        "zh-CN",
                                      )}
                                    </small>
                                  </div>
                                  <span className="pill green">{c.demo ? "展示核销" : "成功"}</span>
                                </div>
                              ))}
                            {!staffData.coupons.some((c) => c.redeemedAt) && (
                              <p className="muted">
                                完成核销后，这里会出现流水。
                              </p>
                            )}
                          </section>
                        </div>
                      )}
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={ShieldCheck}
                      title={
                        page === "staff"
                          ? "进入运营审核工作台"
                          : "进入门店工作台"
                      }
                      body={
                        game.staff?.role === (page === "staff" ? "admin" : "merchant")
                          ? "正在获取当前身份的数据；若加载失败，可点击刷新重试。"
                          : game.staff
                          ? "当前工作台会话属于另一种身份，请重新进入；切换页面不会获得权限。"
                          : page === "staff"
                            ? "获得授权后，审核线索、查看意见与历史。"
                            : "选择门店后，查看奖励并核销自己门店的券。"
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
        <NetworkStatus onRefresh={() => pendingOperationRef.current ? verifyPendingOperation() : refresh()} busy={busy || checkingOperation} />
        <footer className="page-footer">
          <span>逛道宝 · 让每次路过，多一次发现</span>
          <span>模拟门店与权益 · 非实时定位</span>
        </footer>
      </div>
      {primaryClientPage && (
        <nav className="mobile-nav glass-tabbar" aria-label="移动端导航">
          <div className={`liquid-indicator position-${Math.max(0, navItems.findIndex(item => item.id === page || item.id === "profile" && ["footprint", "achievements", "help", "settings", "geofence"].includes(page)))}`} aria-hidden="true" />
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={
                page === id ||
                (id === "profile" &&
                  ["footprint", "achievements", "help", "settings", "geofence"].includes(page))
                  ? "active"
                  : ""
              }
              key={id}
              onClick={() => navigate(id as Page)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {detail && (
        <ReferenceCardModal title="沿着线索，找到惊喜" kind="treasure" origin={taskOrigin} reduceMotion={preferences.reduceMotion} onClose={closeDetail}>
          {game?.stores.find(store => store.id === detail.storeId)?.imageURL ? <StoreImage imageURL={game.stores.find(store => store.id === detail.storeId)?.imageURL} alt={detail.storeName || "门店图片"} className="treasure-detail-photo" /> : <div className={`treasure-detail-art ${["amber", "blue", "green"][Math.max(0, game?.stores.findIndex(store => store.id === detail.storeId) || 0) % 3]}`} aria-hidden="true"><span className="detail-orbit orbit-one"/><span className="detail-orbit orbit-two"/><Compass size={48}/></div>}
          <div className="treasure-detail-copy">
          <div className="detail-summary">
            <span className="pill gold">
              {detail.floor} · {detail.area}
            </span>
            <h3>{detail.title}</h3>
            <div className="detail-reward">
              <Gift size={19} />
              <strong>{detail.reward}</strong>
            </div>
            <p>{detail.conditions}</p>
            <div className="task-meta"><span>难度 {"★".repeat(detail.difficulty || 1)}{"☆".repeat(5 - (detail.difficulty || 1))}</span>{detail.expiresAt && <span>有效期至 {new Date(detail.expiresAt).toLocaleString("zh-CN")}</span>}<span>可用积分：{game?.player.points || 0}</span></div>
          </div>
          <div className="clue-heading">
            <h3>你的五条线索</h3>
            <span>前两条免费 · 解锁记录永久保存</span>
          </div>
          <div className="clue-list">
            {detail.clues.map((c, i) => (
              <button
                key={i}
                className={`clue-item ${openClues.includes(i) ? "open" : ""} ${detail.unlockedClues?.[i] === false ? "locked-clue" : ""}`}
                disabled={busy}
                onClick={async () => {
                  if (detail.unlockedClues?.[i] === false) {
                    const result = await act("unlockClue", { taskId: detail.id, index: i });
                    if (!result) return;
                  }
                  setOpenClues(
                    openClues.includes(i)
                      ? openClues.filter((n) => n !== i)
                      : [...openClues, i],
                  );
                }}
                aria-expanded={openClues.includes(i)}
              >
                <span className="clue-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <b>线索 {i + 1}</b>
                  {detail.unlockedClues?.[i] === false ? <small>解锁需要 {detail.clueCosts?.[i] || 0} 积分 · 点击解锁</small> : openClues.includes(i) ? (
                    <p>{c}{detail.photoURLs?.[i] && <img className="clue-photo" src={detail.photoURLs[i]} alt={`线索 ${i + 1} 的实景照片`} />}</p>
                  ) : (
                    <small>点击展开下一点提示</small>
                  )}
                </span>
                <ChevronDown size={17} />
              </button>
            ))}
          </div>
          {pendingOperation?.action === "claim" && pendingNotice()}
          {!detail.claimed && <GeofencePanel key={detail.id} stores={game?.stores || []} storeId={detail.storeId} compact locationOverride={coinPosition?.taskId === detail.id ? coinPosition.location : null} />}
          {!detail.claimed && detail.requiresNfcClaim && coinEntryError && <p className="inline-error" role="alert">{coinEntryError}</p>}
          {detail.requiresNfcClaim && !coinEntryError && game && <NfcCouponFlow game={game} task={detail} tagEntry={typeof window !== "undefined" && window.location.pathname.startsWith("/client/nfc/")} entryToken={coinEntryToken} onAction={nfcAction} onOpenReward={openReward} onNewReward={coupon => celebration.celebrate(coupon.id)} onRefresh={async () => { await refresh(); }} />}
          {!detail.claimed && !detail.requiresNfcClaim && <section className="coin-checkin notice" aria-live="polite">
            <div><strong><ShieldCheck size={18} /> {coinConfirmed && !coinEntryExpired ? "金币已确认" : "第一步 · 确认这枚金币"}</strong>
            <p>{coinConfirmed && !coinEntryExpired ? "继续回答观察问题，领取你的个人奖励券。" : "跟着线索到达门店，定位确认范围后，回答观察问题领奖。"}</p>
            {coinConfirmation?.expiresAt && <small>{coinEntryExpired ? "入口已到期，请重新扫描金币屏幕上的二维码。" : `动态入口剩余 ${Math.max(0, Math.ceil((coinConfirmation.expiresAt - currentTime) / 1000))} 秒`}</small>}
            {coinEntryError && <p className="inline-error" role="alert">{coinEntryError}</p>}
            <button type="button" className="outline-button full" disabled={busy || coinCheckInBusy || !!coinEntryError || coinEntryExpired || coinConfirmed} onClick={async () => {
              if (coinCheckInPending.current || actionBusy.current) return;
              coinCheckInPending.current = true; setCoinCheckInBusy(true); setError("");
              const seq = ++coinCheckInSeq.current;
              const key = coinConfirmationKey;
              const taskId = detail.id;
              try {
                const location = await readBrowserLocation();
                if (seq !== coinCheckInSeq.current || detailRef.current?.id !== taskId) return;
                setCoinPosition({ taskId, location });
                const result = await request<{ taskId: string; storeId: string; storeName: string; method: "link" | "dynamic"; expiresAt?: number }>("coinCheckIn", { taskId, location, ...(coinEntryToken !== undefined ? { entryToken: coinEntryToken } : {}) });
                if (seq !== coinCheckInSeq.current || detailRef.current?.id !== taskId) return;
                if (result.taskId !== taskId || result.storeId !== detail.storeId) throw new Error("金币任务已变化，请重新打开入口。");
                setCoinConfirmation({ key, expiresAt: result.expiresAt }); setCurrentTime(Date.now());
              } catch (e) {
                if (seq === coinCheckInSeq.current) setError((e as Error).message);
              } finally {
                if (seq === coinCheckInSeq.current) { coinCheckInPending.current = false; setCoinCheckInBusy(false); }
              }
            }}><CheckCircle2 size={18} />{coinCheckInBusy ? "正在确认…" : coinConfirmed ? "已确认金币" : "确认金币"}</button>
            <small>这是网页寻宝任务；硬件金币碰 NFC 建立待领记录，交给商家确认后发券。</small></div>
          </section>}
          {detail.claimed ? <button className="gold-button full" disabled={busy} onClick={() => {
            const existing = game?.coupons.find(c => c.storeId === detail.storeId);
            if (existing) openReward(existing);
            else setError("奖励记录暂未同步，请刷新后查看。");
          }}><Ticket size={17} /> 查看已有奖励</button> : !detail.requiresNfcClaim && <form
            className="verify-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!coinConfirmed || coinEntryExpired || coinCheckInBusy) return;
              if (coinCheckInPending.current || actionBusy.current || pendingOperationRef.current) return;
              coinCheckInPending.current = true; setCoinCheckInBusy(true); setError("");
              const seq = ++coinCheckInSeq.current, taskId = detail.id;
              celebration.prime();
              const existingRewards = new Set(game?.coupons.map(c => c.id));
              try {
                const location = await readBrowserLocation();
                if (seq !== coinCheckInSeq.current || detailRef.current?.id !== taskId) return;
                setCoinPosition({ taskId, location });
                const r = await act("claim", { taskId, answer, location,
                  ...(coinEntryToken !== undefined ? { entryToken: coinEntryToken } : {}) });
                if (r?.coupon) {
                  if (r.newlyIssued !== false && !existingRewards.has(r.coupon.id)) celebration.celebrate(r.coupon.id);
                  openReward(r.coupon);
                }
              } catch (e) { if (seq === coinCheckInSeq.current) setError((e as Error).message); }
              finally {
                if (seq === coinCheckInSeq.current) { coinCheckInPending.current = false; setCoinCheckInBusy(false); }
              }
            }}
          >
            <div className="clue-heading">
              <h3>
                <MapPin size={17} />
                我找到这里了
              </h3>
              <span>现场观察，无需消费</span>
            </div>
            <label className="field-label">
              {detail.question}
              <input
                required
                maxLength={80}
                placeholder="输入你观察到的答案"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </label>
            <small className="verify-hint">
              确认金币并答对观察问题即可领奖，再向商家出示卡包中的个人券二维码。同一门店每位玩家限领一次。
            </small>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="gold-button full"
              disabled={busy || !!pendingOperation || coinCheckInBusy || detail.own || !coinConfirmed || coinEntryExpired}
              type="submit"
            >
              {detail.own
                ? "这是你的作品，请邀请朋友寻找"
                : busy
                  ? "验证中…"
                  : coinEntryExpired ? "入口已到期，请重新扫码" : !coinConfirmed ? "请先确认金币" : "领取模拟奖励"}
              <Sparkles size={17} />
            </button>
          </form>}
          </div>
        </ReferenceCardModal>
      )}
      {reward && (!reward.demo || game?.recordingCouponAllowed) && !shareOpen && (
        <ReferenceCardModal title={reward.demo ? "功能展示券" : "发现卡"} kind="coupon" origin={rewardOrigin} reduceMotion={preferences.reduceMotion} onClose={closeReward}>
          <div className="modal-shine" aria-hidden="true"/>
          <div className="reference-reward-content">
            <p className="qr-label">{reward.demo ? "功能展示券 · 商家扫码核销" : reward.rewardType === "points" ? "本次探索积分" : "到店出示核销"}</p>
            {reward.rewardType !== "points" && reward.code && couponStatus(reward) === "unused" && (!reward.validStart || reward.validStart <= currentTime) && <CouponQr code={reward.code} />}
            {reward.rewardType === "points" && <div className="reference-point-symbol"><Coins size={64}/></div>}
            {reward.imageURL && <StoreImage imageURL={reward.imageURL} artwork={reward.artwork} alt={reward.storeName} className="reward-store-image" />}
            <p className="modal-merchant">{reward.storeName}</p><h3>{reward.reward}</h3>
            <p className="modal-meta">{reward.conditions}</p>
            {reward.validEnd && <p className="modal-meta">有效期至 {new Date(reward.validEnd).toLocaleDateString("zh-CN")}</p>}
            {reward.rewardType !== "points" && reward.code && <div className="coupon-code"><code className="modal-code">{reward.code}</code><button className="icon-button" onClick={() => copy(reward.code)} aria-label="复制奖励码"><Copy size={16}/></button></div>}
            <p className="modal-tip">{reward.rewardType === "points" ? "积分已入账，无需核销" : reward.validStart && reward.validStart > currentTime ? "尚未生效，请在有效期内使用" : couponStatus(reward) === "used" ? "这份奖励已经使用" : couponStatus(reward) === "expired" ? "这份奖励已经过期" : "请将二维码出示给商家扫码核销"}</p>
          </div>
          <div className="share-actions">
            {!reward.demo && <button
              className="outline-button"
              disabled={posterBusy}
              onClick={async () => {
                setPosterBusy(true);
                setError("");
                try {
                  const { downloadDiscoveryPoster } = await import("@/lib/discovery-poster");
                  await downloadDiscoveryPoster(reward);
                  notify("发现卡图片已生成");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPosterBusy(false);
                }
              }}
            >
              <Download size={16} />
              {posterBusy ? "正在生成…" : "保存发现卡"}
            </button>}
            {!reward.demo && <button
              className="outline-button"
              onClick={() => setShareOpen(true)}
            >
              <Share2 size={16} />
              分享这次发现
            </button>}
            <button
              className="gold-button"
              onClick={() => {
                setReward(null);
                setRole("hunter");
                navigate("wallet");
              }}
            >
              <Ticket size={17} />
              打开卡包
            </button>
          </div>
          {!reward.demo && <div className="feedback-panel">
            <h3>线索好找吗？</h3>
            <div className="feedback-options">
              {[
                [3, "刚刚好"],
                [2, "有点难"],
                [1, "不太清楚"],
              ].map(([v, label]) => (
                <button
                  className={feedbackValue === v ? "selected" : ""}
                  key={v}
                  onClick={() => setFeedbackValue(Number(v))}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              aria-label="给创作者的反馈"
              rows={3}
              placeholder="留一句话（可选）"
              maxLength={120}
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
            />
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                act("feedback", {
                  taskId: reward.taskId,
                  clarity: feedbackValue,
                  comment: feedbackComment,
                })
              }
            >
              <MessageCircle size={15} />
              送出反馈
            </button>
          </div>}
          {error && <p className="inline-error">{error}</p>}
        </ReferenceCardModal>
      )}
      {reward && !reward.demo && shareOpen && <Modal title="分享这次发现" onClose={closeShare} sheet><DiscoverySharePanel coupon={reward} origin={window.location.origin} onCopy={copy} notify={notify} onGenerated={() => workAction("recordShare", { taskId: reward.taskId })} /></Modal>}
      {inviteLink && page === "profile" && <Modal title="邀请好友一起探索" onClose={closeInvite}><InvitationContent link={inviteLink} onCopy={copy} /></Modal>}
      {reviewHistory && page === "staff" && game?.staff?.role === "admin" && (
        <Modal title="审核历史" onClose={closeHistory}>
          <h3>{reviewHistory.title}</h3>
          <p className="muted review-history-note">
            历史从本次功能上线后开始记录。
          </p>
          {reviewHistory.items.length ? (
            <div className="review-history-list">
              {reviewHistory.items.map((item) => (
                <div className="log-row" key={item.id}>
                  <span className="log-icon">
                    <History size={18} />
                  </span>
                  <div>
                    <strong>
                      {{
                        published: "通过并发布",
                        rejected: "退回修改",
                        offline: "下架任务",
                        featured: "标记优质",
                        unfeatured: "取消优质",
                      }[item.action as "published"] || item.action}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        dateStyle: "short",
                        timeStyle: "medium",
                      }).format(item.createdAt)}{" "}
                      · {item.reviewer}
                    </small>
                    <p>{item.note || "未填写备注"}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="list-empty">这条任务暂时没有新审核记录。</p>
          )}
        </Modal>
      )}
      {deleteItem && <Modal title={deleteItem.kind === "task" ? "删除宝藏" : "删除留言"} onClose={() => { if (!busy) closeTransientHistory(); }}><p>确定删除“{deleteItem.title}”吗？</p><p className="muted">{deleteItem.kind === "task" ? "删除后不再展示或发放新奖励。已经领取的奖励、核销和积分记录会保留。" : "删除后这条留言不再展示，可以重新提交新的反馈。"}</p><div className="modal-actions"><button className="outline-button" disabled={busy} onClick={closeTransientHistory}>取消</button><button className="gold-button" disabled={busy} onClick={async () => { const item = deleteItem; if (await act(item.kind === "task" ? "taskDelete" : "feedbackDelete", item.kind === "task" ? { taskId: item.id } : { feedbackId: item.id })) closeTransientHistory(); }}>{busy ? "正在删除…" : "确认删除"}</button></div></Modal>}
      {help && (
        <Modal title="一场15分钟的小探索" onClose={closeHelp} wide className="demo-point-modal">
          <div className="help-intro">
            <Compass size={30} />
            <p>
              选宝藏 → 读线索 → 找到金币 → 碰 NFC 并通过到店范围校验 →
              交回金币，由商家扫码并确认发券。普通网页任务保留观察题；你可以只玩一站。
            </p>
          </div>
          <h3>碰一碰进入任务</h3>
          <p className="muted">
            手机开启 NFC 后贴近金币标签，打开领取入口并允许定位，范围校验通过后保存待领记录。商家扫描金币设备码、选中你的领取编号并确认收到金币后，正式券进入卡包；以后消费时再出示个人券二维码核销。
          </p>
          <div className="demo-points">
            {[
              {
                id: "tea",
                name: "茶间集",
                area: "F1 中庭东侧",
                answer: "茉莉",
                art: 0,
              },
              {
                id: "book",
                name: "未完书房",
                area: "F2 连廊西侧",
                answer: "月亮",
                art: 1,
              },
              {
                id: "craft",
                name: "造物小屋",
                area: "F1 南侧生活区",
                answer: "星星",
                art: 2,
              },
            ].map((s) => (
              <div className="demo-point" key={s.id}>
                <Art index={s.art} />
                <h4>{s.name}</h4>
                <span>{s.area}</span>
                <small>{game?.tasks.find(task => task.storeId === s.id)?.requiresNfcClaim ? "NFC 领取，无需答题" : `观察答案：${s.answer}`}</small>
                <small>{game?.tasks.find(task => task.storeId === s.id)?.requiresNfcClaim ? "碰 NFC → 到店校验 → 商家确认发券" : "打开网页任务 → 到店校验 → 答题领奖"}</small>
              </div>
            ))}
          </div>
          <div className="help-rules">
            <h3>一起把发现变成故事</h3>
            <p>
              探索者可创作五条线索，运营审核后再发布。作者不能领自己任务的奖励；同一玩家在同一门店只领一次。
            </p>
            <p>
              商家和运营使用各自已通过的账号。后台开启本机录制模式时，卡包可添加功能展示券；商家仍只能核销自己门店的券。
            </p>
            {!isWorkspace && <button
              className="gold-button"
              onClick={() => {
                setHelp(false);
                navigate("map");
              }}
            >
              回到地图，开始探索
            </button>}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
