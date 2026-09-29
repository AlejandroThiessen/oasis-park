// Publish the built app to Cloudflare Workers, with its own D1 database in the cloud.
// One-time setup: `npx wrangler login`. Then: `npm run build && npm run deploy:cloudflare`.
// The local server keeps its own database: dist/server/wrangler.json is never changed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import "./sites-env.mjs";

const DB = "oasis-park";
const SCHEMA = "drizzle/0000_legal_liz_osborn.sql";
const LOCAL_CONFIG = "dist/server/wrangler.json";
const CLOUD_CONFIG = "dist/server/wrangler.cloudflare.json";
const dryRun = process.argv.includes("--dry-run");

const wrangler = (args, capture = false) =>
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
  });
const findDb = () => JSON.parse(wrangler(["d1", "list", "--json"], true)).find((d) => d.name === DB);

let id = "00000000-0000-4000-8000-000000000000";
if (!dryRun) {
  let db = findDb();
  if (!db) {
    // First deploy: create the database near the park (western North America) and give it the schema.
    wrangler(["d1", "create", DB, "--location", "wnam"]);
    db = findDb();
    wrangler(["d1", "execute", DB, "--remote", "--yes", "--file", SCHEMA]);
  }
  id = db?.uuid;
  if (!id) throw new Error(`Could not find the "${DB}" D1 database in this Cloudflare account.`);
}

// Same build, pointed at the cloud database and served only at https://oasis-park.<account>.workers.dev.
// The copy sits next to the original so its relative paths still hold.
const config = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8"));
config.d1_databases = config.d1_databases.map((d) => (d.binding === "DB" ? { ...d, database_name: DB, database_id: id } : d));
config.workers_dev = true;
config.preview_urls = false;
writeFileSync(CLOUD_CONFIG, JSON.stringify(config, null, 2));
wrangler(["deploy", "--config", CLOUD_CONFIG, ...(dryRun ? ["--dry-run"] : [])]);
