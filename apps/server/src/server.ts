import { createPool, directDatabaseUrl, migrate } from '@pt/db';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, 10);
const ctx = createCtx(config, pool);

if (process.env.MIGRATE_ON_START === 'true') {
  // conexão direta só para a migração; o app segue no pool (pooler do Neon, se houver)
  const direct = createPool(directDatabaseUrl(config.DATABASE_URL, config.DATABASE_URL_UNPOOLED), 1);
  try { await migrate(direct); } finally { await direct.end(); }
}

const app = await buildApp(ctx);
const worker = process.env.EMBEDDED_WORKER === 'true' ? startWorker(ctx) : null;

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const shutdown = async () => {
  await app.close();
  await worker?.stop();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
