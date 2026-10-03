type HistoryHandler = {
  matches: (event: PopStateEvent) => boolean;
  onPop: (event: PopStateEvent) => void;
};
type HistoryRegistry = { handlers: Map<symbol, HistoryHandler> };

// This function is also serialized into the document head. Keep it self-contained.
function initializeHistoryInterceptor() {
  const key = Symbol.for("mall-quest.history-interceptor.v2332");
  const host = window as unknown as Record<symbol, HistoryRegistry | undefined>;
  if (host[key]) return;
  const registry: HistoryRegistry = { handlers: new Map() };
  host[key] = registry;
  window.addEventListener("popstate", event => {
    for (const handler of [...registry.handlers.values()].reverse()) {
      if (!handler.matches(event)) continue;
      event.stopImmediatePropagation();
      handler.onPop(event);
      return;
    }
  }, true);
}

// popstate targets Window: capture alone cannot precede an earlier Window listener.
// The inline head script registers before the framework's deferred module bootstrap.
export const historyInterceptorBootstrap = `(${initializeHistoryInterceptor.toString()})();`;

export function interceptHistory(handler: HistoryHandler) {
  initializeHistoryInterceptor();
  const host = window as unknown as Record<symbol, HistoryRegistry>;
  const registry = host[Symbol.for("mall-quest.history-interceptor.v2332")];
  const id = Symbol();
  registry.handlers.set(id, handler);
  return () => { registry.handlers.delete(id); };
}
