import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const editions = ["full", "client", "merchant", "operations"];
const pages = ["entry", "login", "map", "wallet", "create", "placements", "profile", "footprint", "achievements", "help", "settings", "geofence", "merchant", "staff"];
const entries = { full: "/", client: "/", merchant: "/merchant/login", operations: "/staff/login" };
let cases = 0;
const pass = label => { cases++; console.log(`PASS ${cases}: ${label}`); };

// Load the real TypeScript modules without browser, D1 or network services.
// Changing the literal models the exact role-edition packaging step.
function fixture(edition) {
  const cache = new Map();
  const history = { state: null, pushes: [], pushState(state, title, pathname) { this.state = state; this.pushes.push({ state, title, pathname }); } };
  const browser = { history, location: { pathname: "/client/map" } };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    assert.ok(["lib/project-edition.ts", "lib/game-navigation.ts", "lib/application-scope.ts"].includes(relative));
    let source = readFileSync(path.join(root, relative), "utf8");
    if (relative === "lib/project-edition.ts") {
      const literal = /^export const PROJECT_EDITION: ProjectEdition = "(full|client|merchant|operations)";$/m;
      assert.match(source, literal, "Release edition must be one static, checked literal");
      source = source.replace(literal, `export const PROJECT_EDITION: ProjectEdition = "${edition}";`);
    }
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loadedModule = { exports: {} };
    cache.set(relative, loadedModule.exports);
    vm.runInThisContext(`(function(exports,require,module,URL,window){${compiled}\n})`, { filename: relative })(
      loadedModule.exports,
      specifier => { assert.ok(["./project-edition", "./application-scope"].includes(specifier)); return load(`lib/${specifier.slice(2)}.ts`); },
      loadedModule, URL, browser,
    );
    return loadedModule.exports;
  }
  return { config: load("lib/project-edition.ts"), navigation: load("lib/game-navigation.ts"), browser };
}

const full = fixture("full");
const legacy = [
  ["/", "hunter", { page: "entry", role: "hunter", tab: "overview", taskId: null }],
  ["/client/login", "explorer", { page: "login", role: "explorer", tab: "overview", taskId: null }],
  ["/client/hunter/login", "explorer", { page: "login", role: "hunter", tab: "overview", taskId: null }],
  ["/client/explorer/login", "hunter", { page: "login", role: "explorer", tab: "overview", taskId: null }],
  ["/client/explorer/create", "hunter", { page: "create", role: "explorer", tab: "overview", taskId: null }],
  ["/client/task/quest-tea", "explorer", { page: "map", role: "hunter", tab: "overview", taskId: "quest-tea" }],
  ["/client/nfc/quest%2Ftea", "explorer", { page: "map", role: "hunter", tab: "overview", taskId: "quest/tea" }],
  ["/client/coin/%broken", "hunter", { page: "map", role: "hunter", tab: "overview", taskId: null }],
  ["/merchant/login", "explorer", { page: "merchant", role: "explorer", tab: "login", taskId: null }],
  ["/merchant/profile", "hunter", { page: "merchant", role: "hunter", tab: "info", taskId: null }],
  ["/merchant/review", "hunter", { page: "staff", role: "hunter", tab: "review", taskId: null }],
  ["/ops/dashboard", "explorer", { page: "staff", role: "explorer", tab: "overview", taskId: null }],
  ["/ops/login", "hunter", { page: "staff", role: "hunter", tab: "login", taskId: null }],
  ["/staff/accounts", "hunter", { page: "staff", role: "hunter", tab: "accounts", taskId: null }],
  ["/unknown", "explorer", { page: "entry", role: "explorer", tab: "overview", taskId: null }],
  ["/client/map?unexpected=legacy", "explorer", { page: "entry", role: "explorer", tab: "overview", taskId: null }],
];
for (const [route, preferredRole, expected] of legacy) {
  assert.deepEqual(full.navigation.routeView(route, preferredRole), expected);
  assert.equal(full.config.editionRoutePath(route), route);
  pass(`Combined app preserves historical route: ${route}`);
}

for (const edition of editions) {
  const { config, navigation } = fixture(edition);
  assert.equal(config.PROJECT_EDITION, edition);
  assert.equal(config.editionEntryPath(), entries[edition]);
  assert.equal(config.editionScope(), ["merchant", "operations"].includes(edition) ? "workspace" : "player");
  for (const selected of editions) assert.equal(config.editionEntryPath(selected), entries[selected]);
  pass(`${edition} literal selects its own default entry and API scope`);
  for (const page of pages) {
    for (const login of [false, true]) {
      const ownPage = edition === "merchant" ? "merchant" : "staff";
      const expected = edition === "full" ? { page, login }
        : edition === "client" ? ["merchant", "staff"].includes(page) ? { page: "entry", login: false } : { page, login }
        : page === ownPage ? { page, login } : { page: ownPage, login: true };
      assert.deepEqual(config.editionNavigation(page, login), expected);
      assert.deepEqual(full.config.editionNavigation(page, login, edition), expected);
    }
  }
  pass(`${edition} all page navigation and forced-login requests remain inside its edition`);
  if (edition !== "full") {
    for (const unsafe of ["https://other.invalid/client/map", "//other.invalid/client/map", "client/map", "/\\other.invalid/merchant/login"]) {
      assert.equal(config.editionRoutePath(unsafe), entries[edition]);
    }
    pass(`${edition} rejects external, protocol-relative and backslash navigation`);
  }
  const foreignRoutes = edition === "client" ? ["/merchant/login", "/merchant/review", "/staff/stats", "/ops/login"]
    : edition === "merchant" ? ["/", "/client/map", "/client/nfc/quest-tea?entry=preserve", "/staff/login", "/ops/login", "/merchant/review", "/merchant/review/", "/merchant/%72eview", "/merchant/%72eview%2F"]
    : edition === "operations" ? ["/", "/client/map", "/merchant/login", "/merchant/review"] : [];
  for (const route of foreignRoutes) {
    assert.equal(config.editionRoutePath(route), entries[edition]);
    const expected = edition === "client" ? { page: "entry", tab: "overview" }
      : { page: edition === "merchant" ? "merchant" : "staff", tab: "login" };
    const view = navigation.routeView(route);
    assert.equal(view.page, expected.page);
    assert.equal(view.tab, expected.tab);
    assert.equal(view.taskId, null);
    assert.deepEqual(full.navigation.routeView(route, "hunter", edition), view);
  }
  if (foreignRoutes.length) pass(`${edition} initial and browser-history foreign routes resolve to its own entry`);
}

const client = fixture("client");
for (const prefix of ["coin", "nfc", "task"]) {
  const link = `/client/${prefix}/quest%2Ftea?entry=token-value#reward`;
  assert.equal(client.config.editionRoutePath(link), link);
  assert.deepEqual(client.navigation.routeView(link), { page: "map", role: "hunter", tab: "overview", taskId: "quest/tea" });
}
assert.equal(client.navigation.routeView("/client/explorer/login").role, "explorer");
assert.equal(client.navigation.routeView("/client/explorer/create").page, "create");
assert.equal(client.navigation.routeView("/client/geofence").page, "geofence");
pass("Client retains shared hunter/explorer accounts, legacy creation aliases and token-bearing coin/NFC/task links");

const merchant = fixture("merchant");
for (const [route, tab] of [["/merchant/dashboard", "overview"], ["/merchant/coupons", "coupons"], ["/merchant/coins", "devices"], ["/merchant/verify", "redeem"], ["/merchant/profile", "info"], ["/merchant/geofence", "geofence"], ["/merchant/activities", "activities"]]) {
  assert.equal(merchant.config.editionRoutePath(route), route);
  const view = merchant.navigation.routeView(route);
  assert.equal(view.page, "merchant");
  assert.equal(view.tab, tab);
}
assert.equal(merchant.config.editionRoutePath("/merchant/../staff/accounts"), entries.merchant);
assert.equal(merchant.config.editionRoutePath("/merchant/%2e%2e/staff/accounts"), entries.merchant);
pass("Merchant preserves store actions while preventing traversal and the legacy staff-review alias");

const operations = fixture("operations");
for (const [route, tab] of [["/staff/stats", "overview"], ["/ops/dashboard", "overview"], ["/staff/login", "login"], ["/ops/login", "login"], ["/staff/accounts", "accounts"], ["/staff/users", "users"], ["/staff/review", "review"], ["/staff/merchants", "merchants"], ["/staff/settings", "system"], ["/staff/geofence", "geofence"], ["/staff/activities", "activities"]]) {
  assert.equal(operations.config.editionRoutePath(route), route);
  const view = operations.navigation.routeView(route);
  assert.equal(view.page, "staff");
  assert.equal(view.tab, tab);
}
assert.equal(operations.config.editionRoutePath("/staff/../client/map"), entries.operations);
pass("Operations retains its real admin sections and /ops aliases without opening client or merchant pages");

full.navigation.pushGamePath("/client/wallet", "hunter");
assert.equal(full.browser.history.state.mallQuestDepth, 1);
assert.equal(full.browser.history.state.mallQuestPreviousPath, "/client/map");
full.navigation.pushGamePath("/client/profile", "explorer");
assert.equal(full.browser.history.state.mallQuestDepth, 2);
assert.equal(full.browser.history.state.mallQuestRole, "explorer");
pass("Edition parsing leaves browser-history depth and preferred player role unchanged");

console.log(JSON.stringify({ status: "PASS", cases, editions, databaseWrites: 0, realEmailsSent: 0, networkRequests: 0 }));
