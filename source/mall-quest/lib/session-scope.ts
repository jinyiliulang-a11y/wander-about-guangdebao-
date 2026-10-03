import { APP_BASE_PATH, HARDWARE_DEMO_INSTANCE } from "./application-scope";

/** A separately built demo service never reads or clears the public site's sessions. */
export function sessionCookieName(name: string): string {
  return HARDWARE_DEMO_INSTANCE && (name === "mall_player" || name === "mall_staff")
    ? `hardware_demo_${name}` : name;
}
export const sessionCookiePath = () => APP_BASE_PATH || "/";
export const sessionCookieSecure = (req: Request) =>
  HARDWARE_DEMO_INSTANCE || new URL(req.url).protocol === "https:";
