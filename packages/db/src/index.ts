import pg from 'pg';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

// BIGINT (int8) volta como string por padrão; convertemos para BigInt para dinheiro exato.
pg.types.setTypeParser(20, (v) => BigInt(v));
// NUMERIC permanece string (taxas de câmbio exatas).

export function createPool(connectionString: string, max = 10): pg.Pool {
  // 10 s: o Neon suspende a compute ociosa e a primeira conexão espera ela acordar
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

/**
 * URL direta (sem pooler) para migrações: `pg_advisory_lock` é de sessão e não funciona
 * atrás do PgBouncer em modo transação. Usa DATABASE_URL_UNPOOLED (gerada pelo `neon env pull`);
 * sem ela, tira o sufixo `-pooler` do host do Neon (ep-xxx-pooler.região → ep-xxx.região).
 * Fora do Neon, devolve a própria URL.
 */
export function directDatabaseUrl(pooledUrl: string, unpooledUrl?: string): string {
  if (unpooledUrl) return unpooledUrl;
  try {
    const u = new URL(pooledUrl);
    if (/^ep-[^.]+-pooler\./.test(u.hostname)) u.hostname = u.hostname.replace(/-pooler\./, '.');
    return u.toString();
  } catch {
    return pooledUrl;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
// fonte (packages/db/src → ../migrations) ou bundle do servidor (apps/server/dist → ./migrations, copiada no build)
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  || [path.join(here, 'migrations'), path.resolve(here, '../migrations')].find((d) => existsSync(d))
  || path.resolve(here, '../migrations');

/** Aplica migrações SQL versionadas em ordem, cada uma em transação, com trava consultiva. */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR, log: (m: string) => void = console.log): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
        log(`migração aplicada: ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    client.release();
  }
  return applied;
}

/** Executa `fn` em transação. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
