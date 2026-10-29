import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// ../../packages/db/src/index.ts
import pg from "pg";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
pg.types.setTypeParser(20, (v) => BigInt(v));
function createPool(connectionString, max = 10) {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 3e4, connectionTimeoutMillis: 1e4 });
}
function directDatabaseUrl(pooledUrl, unpooledUrl) {
  if (unpooledUrl) return unpooledUrl;
  try {
    const u = new URL(pooledUrl);
    if (/^ep-[^.]+-pooler\./.test(u.hostname)) u.hostname = u.hostname.replace(/-pooler\./, ".");
    return u.toString();
  } catch {
    return pooledUrl;
  }
}
var here = path.dirname(fileURLToPath(import.meta.url));
var MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || [path.join(here, "migrations"), path.resolve(here, "../migrations")].find((d) => existsSync(d)) || path.resolve(here, "../migrations");
async function migrate(pool2, dir = MIGRATIONS_DIR, log = console.log) {
  const client = await pool2.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
        log(`migra\xE7\xE3o aplicada: ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migra\xE7\xE3o ${f}: ${e.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => void 0);
    client.release();
  }
  return applied;
}

// src/scripts/migrate.ts
var url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL n\xE3o definido");
  process.exit(1);
}
var pool = createPool(directDatabaseUrl(url, process.env.DATABASE_URL_UNPOOLED || void 0), 1);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `${applied.length} migra\xE7\xE3o(\xF5es) aplicada(s)` : "banco j\xE1 est\xE1 atualizado");
} finally {
  await pool.end();
}
//# sourceMappingURL=migrate.js.map
