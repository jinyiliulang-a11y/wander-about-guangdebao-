"use client";
import { Component, Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { Empty } from "./common/Empty";

class DeferredBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <Empty variant="error" title="页面资源暂时未能加载" body="连接网络后重新加载页面；已保存的账号草稿会恢复。" action={<button type="button" className="outline-button" onClick={() => window.location.reload()}>重新加载页面</button>} />;
    return this.props.children;
  }
}
export function deferred<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  const View = lazy(loader);
  // React's LazyExoticComponent conditional props lose generic P in JSX.
  const TypedView = View as ComponentType<P>;
  return function DeferredView(props: P) {
    return <DeferredBoundary><Suspense fallback={<Empty variant="loading" title="正在准备页面…" />}><TypedView {...props} /></Suspense></DeferredBoundary>;
  };
}
