// Scope LAN binding to this invocation; do not change machine or firewall settings.
process.env.MALL_LAN = "true";
process.argv = [process.execPath, new URL("./run-framework.mjs", import.meta.url).pathname, "dev"];
await import("./run-framework.mjs");
