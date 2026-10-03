import type { GameState, StaffState } from "./game-types";
import { appPath } from "./application-scope";

export type GameApiErrorKind = "offline" | "timeout" | "network" | "http" | "invalid-response" | "invalid-request";
export type ApiRequestOptions = { timeoutMs?: number; retries?: 0 | 1; readOnly?: boolean };
export type GameRequestOptions = { expectedPlayerId?: string };
export type GameNetworkEventDetail = { state: "reachable" | "unavailable" | "offline"; at: number; kind?: GameApiErrorKind };
export const GAME_API_NETWORK_EVENT = "mall-quest:network-status";
let latestNetworkEvent: GameNetworkEventDetail | null = null;
export const getGameNetworkStatus = (): GameNetworkEventDetail | null => latestNetworkEvent ? { ...latestNetworkEvent } : null;
const DEFAULT_TIMEOUT_MS = 15_000;
const READ_ONLY_ACTIONS = new Set(["staffState", "workbenchState", "merchantProfileDraftGet", "opsUserDetail", "reviewHistory", "couponPreview", "nfcClaimStatus", "nfcDrafts", "nfcDraftOperationStatus", "merchantPendingClaims", "merchantPendingQueue", "merchantIssueClaimStatus", "recordingCouponStatus", "merchantDeviceCapabilities", "merchantDeviceOperationStatus", "geofenceState", "storeActivities", "storeActivityState", "accountApplicationStatus", "accountApplications", "accountApplication"]);

export class GameApiError extends Error {
  readonly kind: GameApiErrorKind;
  readonly status: number | null;
  readonly resultUncertain: boolean;
  readonly requestSent: boolean;
  readonly method: string;
  readonly retryable: boolean;
  constructor(message: string, detail: {
    kind: GameApiErrorKind; method: string; status?: number | null;
    resultUncertain?: boolean; requestSent?: boolean; retryable?: boolean;
  }) {
    super(message);
    this.name = "GameApiError";
    this.kind = detail.kind;
    this.method = detail.method;
    this.status = detail.status ?? null;
    this.resultUncertain = detail.resultUncertain ?? false;
    this.requestSent = detail.requestSent ?? false;
    this.retryable = detail.retryable ?? false;
  }
}
export const isGameApiError = (error: unknown): error is GameApiError => error instanceof GameApiError;
export const isUncertainResult = (error: unknown): boolean => isGameApiError(error) && error.resultUncertain;

function offline() { return typeof navigator !== "undefined" && navigator.onLine === false; }
function networkEvent(state: GameNetworkEventDetail["state"], kind?: GameApiErrorKind) {
  latestNetworkEvent = { state, at: Date.now(), ...(kind ? { kind } : {}) };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<GameNetworkEventDetail>(GAME_API_NETWORK_EVENT, {
    detail: latestNetworkEvent,
  }));
}
function httpMessage(status: number) {
  if (status === 401 || status === 403) return "登录状态或访问权限已变化，请重新进入后再试";
  if (status === 429) return "请求较频繁，请稍等片刻后再试";
  if (status >= 500) return "服务器暂时无法处理请求，请稍后刷新确认状态";
  return "这次请求未能完成，请刷新后再试";
}

async function attempt<T>(path: string, init: RequestInit, options: ApiRequestOptions): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const mutating = !["GET", "HEAD"].includes(method) && !(method === "POST" && options.readOnly === true);
  if (offline()) {
    networkEvent("offline", "offline");
    throw new GameApiError("当前设备已离线，请连接网络后刷新；本次请求尚未发送", { kind: "offline", method });
  }
  if (init.signal?.aborted) throw new GameApiError("请求已取消，本次请求尚未发送", { kind: "network", method });
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? Math.min(options.timeoutMs!, 60_000) : DEFAULT_TIMEOUT_MS;
  let sent = false, timedOut = false, cancelled = false;
  let rejectCancellation: (error: GameApiError) => void = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const uncertainMessage = "请求结果暂未确认，操作可能已保存；请先刷新核对状态，再决定是否重试";
  const timeoutError = () => new GameApiError(mutating && sent ? uncertainMessage : "等待服务器响应超时，请稍后刷新重试", {
    kind: "timeout", method, requestSent: sent, resultUncertain: mutating && sent, retryable: true,
  });
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const onAbort = () => {
    cancelled = true;
    controller.abort();
    rejectCancellation(new GameApiError(mutating && sent ? uncertainMessage : "请求已取消", {
      kind: "network", method, requestSent: sent, resultUncertain: mutating && sent,
    }));
  };
  init.signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { timedOut = true; controller.abort(); reject(timeoutError()); }, timeoutMs);
  });
  const operation = async () => {
    sent = true;
    const response = await fetch(path, { ...init, signal: controller.signal });
    let result: unknown;
    try { result = await response.json(); }
    catch {
      if (timedOut || cancelled) throw timeoutError();
      const uncertain = mutating && (response.ok || response.status >= 500);
      throw new GameApiError(uncertain ? uncertainMessage : response.ok
        ? "服务器返回了无法识别的内容，请稍后刷新重试" : httpMessage(response.status), {
        kind: response.ok ? "invalid-response" : "http", method, status: response.status,
        requestSent: true, resultUncertain: uncertain, retryable: response.ok || response.status >= 500 || response.status === 429,
      });
    }
    if (timedOut || cancelled) throw timeoutError();
    const envelope = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
    if (!response.ok) {
      const error = envelope?.error;
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message.trim().slice(0, 300) : "";
      if (response.status < 500 && message) networkEvent("reachable");
      throw new GameApiError(mutating && response.status >= 500 ? uncertainMessage : message || httpMessage(response.status), {
        kind: "http", method, status: response.status, requestSent: true,
        resultUncertain: mutating && response.status >= 500, retryable: response.status >= 500 || response.status === 429,
      });
    }
    if (!envelope || !Object.hasOwn(envelope, "data")) throw new GameApiError(mutating ? uncertainMessage
      : "服务器响应不完整，请刷新后再试", {
      kind: "invalid-response", method, status: response.status, requestSent: true,
      resultUncertain: mutating, retryable: true,
    });
    networkEvent("reachable");
    return envelope.data as T;
  };
  try { return await Promise.race([operation(), deadline, cancellation]); }
  catch (error) {
    const result = isGameApiError(error) ? error : timedOut ? timeoutError() : new GameApiError(mutating && sent
      ? uncertainMessage : offline() ? "网络已断开，请连接网络后刷新" : "暂时连接不上服务器，请检查网络后刷新重试", {
      kind: offline() ? "offline" : "network", method, requestSent: sent,
      resultUncertain: mutating && sent, retryable: !offline() && !cancelled,
    });
    if (!cancelled && (result.kind !== "http" || (result.status ?? 0) >= 500))
      networkEvent(offline() ? "offline" : "unavailable", result.kind);
    throw result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** Default requests never retry. Only explicitly read-only GET callers may opt
 * into one retry; POST/PUT/DELETE mutations always keep one transport attempt. */
export async function apiRequest<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  if (!path.trim()) throw new GameApiError("请求地址无效，本次请求尚未发送", { kind: "invalid-request", method });
  let scopedPath: string;
  try { scopedPath = appPath(path); }
  catch { throw new GameApiError("请求地址无效，本次请求尚未发送", { kind: "invalid-request", method }); }
  const canRetry = method === "GET" && options.readOnly === true && options.retries === 1;
  try { return await attempt<T>(scopedPath, init, options); }
  catch (error) {
    if (!canRetry || !isGameApiError(error) || !error.retryable || error.kind === "invalid-response" || init.signal?.aborted) throw error;
    await new Promise(resolve => setTimeout(resolve, 350));
    return attempt<T>(scopedPath, init, options);
  }
}

export async function request<T>(action?: string, payload: Record<string, unknown> = {}, context: "player" | "workspace" = "player", options: GameRequestOptions = {}): Promise<T> {
  let init: RequestInit;
  let readOnly = false;
  try {
    if (options.expectedPlayerId !== undefined && (typeof options.expectedPlayerId !== "string" || !/^[\x21-\x7e]{1,100}$/.test(options.expectedPlayerId)))
      throw new Error("Invalid expected identity");
    const identityHeader: Record<string, string> = options.expectedPlayerId === undefined ? {} : { "X-Mall-Quest-Player": options.expectedPlayerId };
    if (action) {
      const submission = { action, ...payload };
      init = { method: "POST", headers: { "Content-Type": "application/json", ...identityHeader }, body: JSON.stringify(submission) };
      readOnly = typeof submission.action === "string" && READ_ONLY_ACTIONS.has(submission.action);
    } else init = { cache: "no-store", headers: { "X-Mall-Quest-Context": context, ...identityHeader } };
  } catch {
    throw new GameApiError("提交内容格式不正确，本次请求尚未发送", { kind: "invalid-request", method: action ? "POST" : "GET" });
  }
  return apiRequest<T>("/api/game", init, { readOnly });
}
export const loadGame = (context: "player" | "workspace" = "player") => request<GameState>(undefined, {}, context);
export const loadStaff = () => request<StaffState>("staffState");
