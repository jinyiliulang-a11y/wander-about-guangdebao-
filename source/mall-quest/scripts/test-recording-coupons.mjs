// Compatibility entry point: current isolated UI-coupon policy plus the
// independent device-linked pending, merchant issue and redemption regression.
// Both suites use disposable SQLite; neither connects to a live service/device.
await import('./test-recording-coupon-self-grant.mjs');
await import('./test-hardware-demo-flow.mjs');
