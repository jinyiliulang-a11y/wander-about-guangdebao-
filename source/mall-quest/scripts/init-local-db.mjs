import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
mkdirSync(".sites-runtime", { recursive: true });
const config = {
  name: "mall-quest-local",
  compatibility_date: "2026-05-15",
  d1_databases: [
    {
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
      migrations_dir: path.join(root, "drizzle"),
    },
  ],
};
writeFileSync(".sites-runtime/local-wrangler.json", JSON.stringify(config));
// Wrangler records applied migrations, so this command is safe to repeat.
const result = spawnSync(
  process.execPath,
  [
    "--import",
    new URL("./sites-env.mjs", import.meta.url).href,
    "./node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    "site-creator-d1",
    "--local",
    "--persist-to",
    ".wrangler/state",
    "--config",
    ".sites-runtime/local-wrangler.json",
  ],
  { stdio: "inherit", env: { ...process.env, CI: "true" } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
