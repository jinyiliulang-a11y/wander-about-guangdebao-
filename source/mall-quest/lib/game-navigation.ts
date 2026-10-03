import type { Page, Role } from "./game-types";
import { PROJECT_EDITION, editionRoutePath, type ProjectEdition } from "./project-edition";

export function pushGamePath(path: string, role: Role) {
  const current = window.history.state?.mallQuestDepth;
  const depth = Number.isSafeInteger(current) && current >= 0 ? current : 0;
  window.history.pushState({ mallQuestRole: role, mallQuestDepth: depth + 1, mallQuestPreviousPath: window.location.pathname }, "", path);
}

export function pagePath(page: Page): string {
  return {
    entry: "/",
    login: "/client/login",
    map: "/client/map",
    wallet: "/client/wallet",
    create: "/client/explorer/place",
    placements: "/client/explorer",
    profile: "/client/profile",
    footprint: "/client/footprint",
    achievements: "/client/achievements",
    help: "/client/help",
    settings: "/client/settings",
    geofence: "/client/geofence",
    merchant: "/merchant/dashboard",
    staff: "/staff/stats",
  }[page];
}

export function routeView(path: string, preferredRole: Role = "hunter", edition: ProjectEdition = PROJECT_EDITION) {
  const scoped = editionRoutePath(path, edition);
  const routePath = edition === "full" ? scoped : scoped.split(/[?#]/, 1)[0];
  const original = routePath.replace(/\/$/, "") || "/";
  const clean =
    original.startsWith("/ops/")
      ? original.replace(/^\/ops\//, "/staff/").replace(/\/dashboard$/, "/stats")
      : original === "/client/explorer/create"
      ? "/client/explorer/place"
      : original.replace(/^\/client\/task\//, "/client/coin/");
  const playerLogin = clean === "/client/login" || clean === "/client/hunter/login" || clean === "/client/explorer/login";
  const matched = (
    Object.keys({
      entry: 1,
      login: 1,
      map: 1,
      wallet: 1,
      create: 1,
      placements: 1,
      profile: 1,
      footprint: 1,
      achievements: 1,
      help: 1,
      settings: 1,
      geofence: 1,
      merchant: 1,
      staff: 1,
    }) as Page[]
  ).find((page) => pagePath(page) === clean);
  const page: Page =
    (playerLogin ? "login" : matched) ||
    (/^\/client\/(?:coin|nfc)\//.test(clean)
      ? "map"
      : clean.startsWith("/staff/") || clean === "/merchant/review"
        ? "staff"
        : clean.startsWith("/merchant/")
          ? "merchant"
          : "entry");
  const role: Role = clean === "/client/explorer/login" ? "explorer" : clean === "/client/hunter/login" ? "hunter" : ["placements", "create"].includes(page)
    ? "explorer"
    : ["map", "wallet", "footprint"].includes(page)
      ? "hunter"
      : preferredRole;
  const tab = clean.endsWith("/login") && (clean.startsWith("/merchant/") || clean.startsWith("/staff/")) ? "login" : clean.endsWith("/accounts") && page === "staff" ? "accounts" : clean.endsWith("/activities") && (page === "merchant" || page === "staff") ? "activities" : clean.endsWith("/geofence") && (page === "merchant" || page === "staff") ? "geofence" : clean.endsWith("/coupons")
    ? "coupons"
    : clean.endsWith("/coins")
      ? "devices"
      : clean.endsWith("/users")
        ? "users"
        : clean.endsWith("/merchants")
          ? "merchants"
          : clean.endsWith("/settings") && clean.startsWith("/staff/")
            ? "system"
    : clean.endsWith("/verify")
      ? "redeem"
      : clean.endsWith("/review")
        ? "review"
        : clean.endsWith("/info") || clean === "/merchant/profile"
          ? "info"
          : "overview";
  let taskId: string | null = null;
  const taskRoute = clean.match(/^\/client\/(?:coin|nfc)\/(.+)$/);
  if (taskRoute) {
    try {
      taskId = decodeURIComponent(taskRoute[1]);
    } catch {}
  }
  return { page, role, tab, taskId };
}
