import type { Pool } from '@pt/db';
import { tooMany } from './errors.js';

/**
 * Rate limit de janela fixa persistido no Postgres (funciona com várias instâncias,
 * ao contrário do arquivo em /tmp do legado). Retorna a contagem atual.
 */
export async function hit(db: Pool, bucket: string, limit: number, windowSec: number): Promise<number> {
  const r = await db.query<{ count: number }>(
    `INSERT INTO rate_limits(bucket, count, window_end) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_end < now() THEN 1 ELSE rate_limits.count + 1 END,
       window_end = CASE WHEN rate_limits.window_end < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.window_end END
     RETURNING count`,
    [bucket, windowSec],
  );
  const count = r.rows[0]?.count ?? 0;
  if (count > limit) throw tooMany();
  return count;
}

export async function peek(db: Pool, bucket: string): Promise<number> {
  const r = await db.query<{ count: number }>('SELECT count FROM rate_limits WHERE bucket = $1 AND window_end > now()', [bucket]);
  return r.rows[0]?.count ?? 0;
}

export async function clear(db: Pool, bucket: string): Promise<void> {
  await db.query('DELETE FROM rate_limits WHERE bucket = $1', [bucket]);
}
