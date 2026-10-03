import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
let cases = 0;
const pass = label => { cases++; console.log(`PASS ${cases}: ${label}`); };

function fixture(base, edition = "full") {
  const cache = new Map(), requests = [];
  const browser = { location: { pathname: (base || "") + "/client/map", origin: "https://your-server.example.com" },
    history: { state: null, pushes: [], pushState(state, title, url) { this.state = state; this.pushes.push({ state, url }); browser.location.pathname = new URL(url, browser.location.origin).pathname; } },
    dispatchEvent() {} };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    assert.ok(["application-scope", "project-edition", "game-navigation", "game-api"].includes(relative));
    let source = readFileSync(path.join(root, `lib/${relative}.ts`), "utf8");
    if (relative === "application-scope") {
      assert.match(source, /^export const APP_BASE_PATH: string = "";$/m);
      assert.match(source, /^export const HARDWARE_DEMO_INSTANCE: boolean = false;$/m);
      source = source.replace('APP_BASE_PATH: string = ""', `APP_BASE_PATH: string = ${JSON.stringify(base)}`)
        .replace("HARDWARE_DEMO_INSTANCE: boolean = false", `HARDWARE_DEMO_INSTANCE: boolean = ${base !== ""}`);
    }
    if (relative === "project-edition") source = source.replace('PROJECT_EDITION: ProjectEdition = "full"', `PROJECT_EDITION: ProjectEdition = ${JSON.stringify(edition)}`);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; cache.set(relative, module.exports);
    vm.runInThisContext(`(function(exports,require,module,window,navigator,fetch,CustomEvent){${compiled}\n})`, { filename: relative })(
      module.exports, specifier => { assert.ok(specifier.startsWith("./")); return load(specifier.slice(2)); }, module,
      browser, { onLine: true }, async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "Content-Type": "application/json" } }); },
      class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    );
    return module.exports;
  }
  const scope = load("application-scope"), config = load("project-edition"), navigation = load("game-navigation"), api = load("game-api");
  const nfcSource = readFileSync(path.join(root, "components/nfc-coupon-flow.tsx"), "utf8");
  const helpers = nfcSource.slice(nfcSource.indexOf("type NdefRecord"), nfcSource.indexOf("export function NfcCouponFlow"));
  assert.ok(helpers.includes("function matchingNfcRecord"));
  const compiledNfc = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const matchTag = new Function("isAppPath", "stripAppPath", "window", "TextDecoder", compiledNfc + "\nreturn matchingNfcRecord;")(scope.isAppPath, scope.stripAppPath, browser, TextDecoder);
  return { scope, config, navigation, api, browser, requests, matchTag };
}
function record(url) { const bytes = new TextEncoder().encode(url); return { message: { records: [{ recordType: "url", data: new DataView(bytes.buffer) }] } }; }

for (const base of ["", "/demo"]) {
  const f = fixture(base), { scope, config, navigation, api, browser, requests } = f;
  const label = base || "production";
  assert.equal(scope.APP_BASE_PATH, base); assert.equal(scope.HARDWARE_DEMO_INSTANCE, !!base);
  for (const route of ["/", "/client/map", "/merchant/login", "/staff/stats", "/api/game", "/client/nfc/quest%2Ftea?device=coin-tea-01#reward"]) {
    assert.equal(scope.appPath(route), base + route);
    assert.equal(scope.appPath(scope.appPath(route)), base + route);
    assert.equal(scope.stripAppPath(base + route), route);
  }
  assert.equal(scope.stripAppPath("/demonstration/client/map"), "/demonstration/client/map");
  assert.equal(scope.stripAppPath("/demo2/client/map"), "/demo2/client/map");
  pass(`${label}: exact path prefix, API and query/hash roundtrip without double prefix`);

  for (const [route, page, tab, taskId] of [
    ["/", "entry", "overview", null], ["/client/explorer/login", "login", "overview", null],
    ["/client/nfc/quest%2Ftea", "map", "overview", "quest/tea"], ["/client/task/quest-tea", "map", "overview", "quest-tea"],
    ["/merchant/verify", "merchant", "redeem", null], ["/staff/accounts", "staff", "accounts", null], ["/ops/dashboard", "staff", "overview", null],
  ]) { const view = navigation.routeView(base + route); assert.equal(view.page, page); assert.equal(view.tab, tab); assert.equal(view.taskId, taskId); }
  assert.equal(navigation.routeView(base + "/client/explorer/login").role, "explorer");
  assert.equal(navigation.routeView(base + "/client/coin/%broken").taskId, null);
  assert.equal(navigation.pagePath("map"), base + "/client/map");
  assert.equal(config.editionEntryPath(), base + "/");
  pass(`${label}: player/workspace/deep-link routes and aliases select the correct view`);

  navigation.pushGamePath("/client/wallet", "hunter");
  assert.equal(browser.history.state.mallQuestPreviousPath, base + "/client/map");
  assert.equal(browser.history.pushes[0].url, base + "/client/wallet");
  navigation.pushGamePath(base + "/client/profile", "explorer");
  assert.equal(browser.history.state.mallQuestDepth, 2); assert.equal(browser.history.state.mallQuestRole, "explorer");
  assert.equal(browser.history.pushes[1].url, base + "/client/profile");
  pass(`${label}: actual history navigation retains instance, depth and previous path`);

  await api.apiRequest("/api/game?scope=workspace", { cache: "no-store", headers: { "X-Test": "kept" } });
  await api.request("accountApplicationStatus", { role: "merchant" });
  await api.apiRequest(base + "/api/game");
  assert.deepEqual(requests.map(item => item.url), [base + "/api/game?scope=workspace", base + "/api/game", base + "/api/game"]);
  assert.equal(requests[0].init.headers["X-Test"], "kept"); assert.equal(requests[1].init.method, "POST");
  assert.equal(JSON.parse(requests[1].init.body).action, "accountApplicationStatus");
  pass(`${label}: real API transport scopes GET/POST exactly once and preserves payload/headers`);

  const task = { id: "quest-tea", storeId: "tea" };
  assert.deepEqual(f.matchTag(record(`https://your-server.example.com${base}/client/nfc/quest-tea?device=coin-tea-01`), task), { deviceId: "coin-tea-01" });
  assert.equal(f.matchTag(record(`https://foreign.invalid${base}/client/nfc/quest-tea?device=coin-tea-01`), task), null);
  assert.equal(f.matchTag(record(`https://your-server.example.com${base}/client/nfc/other-task?device=coin-tea-01`), task), null);
  assert.equal(f.matchTag(record(`https://your-server.example.com${base}/client/nfc/quest-tea?device=one&device=two`), task), null);
  if (base) {
    assert.equal(f.matchTag(record("https://your-server.example.com/client/nfc/quest-tea?device=coin-tea-01"), task), null);
    for (const bad of ["https://foreign.invalid/api/game", "//foreign.invalid/api/game", "/\\foreign.invalid/api/game"]) {
      const before = requests.length;
      await assert.rejects(api.apiRequest(bad), error => error.kind === "invalid-request" && !error.requestSent);
      assert.equal(requests.length, before);
    }
  }
  pass(`${label}: actual NFC parser checks origin, task, device ambiguity and instance boundary`);
}
for (const edition of ["client", "merchant", "operations"]) {
  const { config, navigation } = fixture("/demo", edition);
  const own = edition === "client" ? "/demo/" : edition === "merchant" ? "/demo/merchant/login" : "/demo/staff/login";
  assert.equal(config.editionEntryPath(), own);
  const foreign = edition === "client" ? "/demo/staff/login" : "/demo/client/map";
  assert.equal(config.editionRoutePath(foreign), own);
  const ownLink = edition === "client" ? "/demo/client/nfc/quest-tea?device=coin-tea-01" : edition === "merchant" ? "/demo/merchant/profile?view=one" : "/demo/ops/login?view=one";
  assert.equal(config.editionRoutePath(ownLink), ownLink);
  assert.equal(navigation.routeView(ownLink).page, edition === "client" ? "map" : edition === "merchant" ? "merchant" : "staff");
  pass(`demo ${edition}: role-edition boundaries and query-bearing links retain the prefix`);
}
console.log(JSON.stringify({ status: "PASS", cases, scopes: ["production", "/demo"], databaseWrites: 0, networkRequests: 0, browserQA: "NOT_RUN" }));
