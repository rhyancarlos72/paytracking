import { createPool, migrate } from '@pt/db';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, 10);
const ctx = createCtx(config, pool);

if (process.env.MIGRATE_ON_START === 'true') await migrate(pool);

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
