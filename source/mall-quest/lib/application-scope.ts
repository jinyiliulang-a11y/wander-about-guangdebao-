// Release packaging changes these checked literals only in an isolated build.
// The URL, query parameters and browser preferences never select an instance.
export const APP_BASE_PATH: string = "";
export const HARDWARE_DEMO_INSTANCE: boolean = false;

if (APP_BASE_PATH && !/^(?:\/[A-Za-z0-9_-]+)+$/.test(APP_BASE_PATH)) {
  throw new Error("Application base path must be a root path without a trailing slash");
}

/** Prefix internal navigation/API paths once; an empty scope preserves legacy paths. */
export function appPath(path: string): string {
  if (!APP_BASE_PATH) return path;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Application navigation requires a same-origin root path");
  }
  const url = new URL(path, "https://application.invalid");
  const suffix = url.search + url.hash;
  const pathname = url.pathname;
  return (pathname === APP_BASE_PATH || pathname.startsWith(APP_BASE_PATH + "/")
    ? pathname === APP_BASE_PATH ? APP_BASE_PATH + "/" : pathname
    : APP_BASE_PATH + pathname) + suffix;
}

/** Remove only this instance's exact path prefix, retaining query/hash contents. */
export function stripAppPath(path: string): string {
  if (!APP_BASE_PATH) return path;
  const suffixAt = path.search(/[?#]/);
  const pathname = suffixAt < 0 ? path : path.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? "" : path.slice(suffixAt);
  if (pathname === APP_BASE_PATH) return "/" + suffix;
  return pathname.startsWith(APP_BASE_PATH + "/")
    ? pathname.slice(APP_BASE_PATH.length) + suffix : path;
}

/** A tag from the production application cannot select the isolated instance. */
export function isAppPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  return APP_BASE_PATH ? pathname === APP_BASE_PATH || pathname.startsWith(APP_BASE_PATH + "/")
    : pathname.startsWith("/") && !pathname.startsWith("//");
}
