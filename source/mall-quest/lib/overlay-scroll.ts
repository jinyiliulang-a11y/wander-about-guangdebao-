// Nested overlays can unmount in either order. Restore styles only after their last owner leaves.
let owners = 0;
let originalOverflow = "";
let originalGutter = "";
let manualHistoryOwners = 0;
let originalRestoration: ScrollRestoration = "auto";
export function preserveOverlayHistoryScroll() {
  // scrollRestoration belongs to each history entry; Back can restore an old 'auto' value.
  if (manualHistoryOwners > 0) window.history.scrollRestoration = "manual";
}
export function acquireOverlayScroll({ preserveHistoryScroll = false }: { preserveHistoryScroll?: boolean } = {}) {
  if (owners++ === 0) {
    originalOverflow = document.body.style.overflow;
    originalGutter = document.documentElement.style.scrollbarGutter;
    // Keep an existing desktop scrollbar's space when body overflow is hidden.
    if (window.innerWidth > document.documentElement.clientWidth && CSS.supports("scrollbar-gutter", "stable") &&
      !getComputedStyle(document.documentElement).scrollbarGutter.includes("stable")) {
      document.documentElement.style.scrollbarGutter = "stable";
    }
  }
  document.body.style.overflow = "hidden";
  if (preserveHistoryScroll && manualHistoryOwners++ === 0) {
    originalRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (preserveHistoryScroll) {
      if (--manualHistoryOwners === 0) window.history.scrollRestoration = originalRestoration;
      else preserveOverlayHistoryScroll();
    }
    if (--owners === 0) {
      document.body.style.overflow = originalOverflow;
      document.documentElement.style.scrollbarGutter = originalGutter;
    }
  };
}
