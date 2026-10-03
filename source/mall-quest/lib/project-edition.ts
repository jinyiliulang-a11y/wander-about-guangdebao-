import type { Page } from "./game-types";
import { appPath, stripAppPath } from "./application-scope";

export type ProjectEdition = "full" | "client" | "merchant" | "operations";

// Release packaging changes this checked literal in each role edition. No
// query parameter, browser preference or runtime flag selects an edition.
export const PROJECT_EDITION: ProjectEdition = "full";

export function editionEntryPath(edition: ProjectEdition = PROJECT_EDITION): string {
  return appPath(edition === "merchant" ? "/merchant/login" : edition === "operations" ? "/staff/login" : "/");
}

/** Keep deep-link queries intact while returning only same-origin paths. */
export function editionRoutePath(path: string, edition: ProjectEdition = PROJECT_EDITION): string {
  // Preserve all historical combined-app route behavior, including aliases.
  if (edition === "full") return appPath(path);
  const entry = editionEntryPath(edition);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return entry;
  let url: URL;
  try { url = new URL(stripAppPath(path), "https://edition.invalid"); } catch { return entry; }
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname).replace(/\/+$/, "") || "/"; } catch { /* Route parser handles malformed task IDs. */ }
  const allowed = edition === "client" ? pathname === "/" || pathname.startsWith("/client/")
    : edition === "merchant" ? pathname.startsWith("/merchant/") && decoded !== "/merchant/review"
    : pathname.startsWith("/staff/") || pathname.startsWith("/ops/");
  return allowed ? appPath(url.pathname + url.search + url.hash) : entry;
}

/** Navigation is an edition boundary, independent of account authorization. */
export function editionNavigation(page: Page, login = false, edition: ProjectEdition = PROJECT_EDITION): { page: Page; login: boolean } {
  if (edition === "full") return { page, login };
  if (edition === "client") return page === "merchant" || page === "staff" ? { page: "entry", login: false } : { page, login };
  const ownPage = edition === "merchant" ? "merchant" : "staff";
  return page === ownPage ? { page, login } : { page: ownPage, login: true };
}

/** Combined editions still select their scope from the current route. */
export function editionScope(edition: ProjectEdition = PROJECT_EDITION): "player" | "workspace" {
  return edition === "merchant" || edition === "operations" ? "workspace" : "player";
}
