import { createPool } from '@pt/db';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { startWorker } from './worker.js';

// Worker avulso (processo separado). Fica em arquivo próprio: no bundle, uma checagem de
// "sou o módulo principal?" dentro de worker.ts valeria também para o server.js.
const config = loadConfig();
const pool = createPool(config.DATABASE_URL, 5);
const ctx = createCtx(config, pool);
// processo separado não recebe o sinal de evento novo: verifica a fila a cada 5 s
const w = startWorker(ctx, { idleMaxMs: 5000 });
const shutdown = async () => { await w.stop(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
ctx.log.info({}, 'worker iniciado');
