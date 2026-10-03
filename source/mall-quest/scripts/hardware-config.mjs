import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const allowed = /^(--(activate|deactivate|demo-mode|rotate)|--(device|store|server)=.*)$/;
if (args.some((a) => !allowed.test(a))) throw new Error("Use --activate, --deactivate, --demo-mode, --rotate, --device=id, --store=id, --server=URL.");
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const deviceId = option("device", "coin-tea-01"), storeId = option("store", "tea");
if (![deviceId, storeId].every((s) => /^[A-Za-z0-9_-]{3,64}$/.test(s))) throw new Error("Invalid device/store ID.");
const modes = args.filter((a) => ["--activate", "--deactivate", "--demo-mode"].includes(a));
if (modes.length > 1) throw new Error("Choose one mode switch.");
mkdirSync(".sites-runtime", { recursive: true });
const runDatabase = (tail) => spawnSync(process.execPath, ["--import", new URL("./sites-env.mjs", import.meta.url).href, "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "site-creator-d1", "--local", "--persist-to", ".wrangler/state", "--config", ".sites-runtime/local-wrangler.json", ...tail], { stdio: "pipe", encoding: "utf8", env: { ...process.env, CI: "true" } });
const current = runDatabase(["--command", `SELECT store_id FROM hardware_devices WHERE id='${deviceId}'`, "--json"]);
if (current.error || current.status !== 0) throw new Error("Cannot read local device registry. Run npm run db:local first.");
let paired;
try { paired = JSON.parse(current.stdout)[0]?.results?.[0]; }
catch { throw new Error("Cannot read local device registry response."); }
if (paired && paired.store_id !== storeId) throw new Error("Device registry pairs this ID with another store; use a new device ID.");
const configPath = path.join(root, ".sites-runtime", `hardware-${deviceId}.json`);
const old = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
if (old && old.storeId !== storeId) throw new Error("Device is already paired with another store; use a new device ID.");
const token = old && !args.includes("--rotate") ? old.token : randomBytes(32).toString("base64url");
if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Local device credential is invalid.");
const serverUrl = option("server", old?.serverUrl ?? "");
if (serverUrl) {
  const url = new URL(serverUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== "/")) throw new Error("Use a base HTTP(S) origin without credentials or a path.");
  if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname)) throw new Error("The device needs your computer's LAN address, not localhost.");
}
const sqlString = (s) => "'" + s.replaceAll("'", "''") + "'";
const hash = createHash("sha256").update(token).digest("hex");
const enabled = args.includes("--activate") ? 1 : args.includes("--deactivate") || args.includes("--demo-mode") ? 0 : null;
const statements = [
  `INSERT INTO hardware_devices(id,store_id,token_hash,enabled,created_at) VALUES(${sqlString(deviceId)},${sqlString(storeId)},${sqlString(hash)},${enabled ?? 0},${Date.now()}) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash${enabled === null ? "" : ",enabled=excluded.enabled"};`];
if (args.includes("--activate")) statements.push(`UPDATE stores SET point_mode='hardware' WHERE id=${sqlString(storeId)};`);
if (args.includes("--demo-mode")) {
  statements.push(`UPDATE hardware_devices SET enabled=0 WHERE store_id=${sqlString(storeId)};`);
  statements.push(`UPDATE stores SET point_mode='static' WHERE id=${sqlString(storeId)};`);
}
const sqlPath = path.join(root, ".sites-runtime", "hardware-configuration.sql");
writeFileSync(sqlPath, statements.join("\n"));
const result = runDatabase(["--file", sqlPath]);
if (result.error || result.status !== 0) {
  console.error("Local database configuration failed. Run npm run db:local first; no device configuration was saved.");
  process.exit(1);
}
writeFileSync(configPath, JSON.stringify({ deviceId, storeId, serverUrl, token }, null, 2) + "\n", { mode: 0o600 });
console.log(`Local device configuration saved: ${configPath}`);
console.log("The file contains the device credential. Keep it private; do not publish or include it in source archives.");
console.log(args.includes("--activate") ? "Hardware mode active: fixed store codes are disabled." : args.includes("--demo-mode") ? "Static demo mode active; all devices for this store disabled." : args.includes("--deactivate") ? "Device disabled; hardware-only store mode preserved." : "Device registered; existing mode/activation preserved.");
