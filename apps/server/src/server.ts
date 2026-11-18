import { createServer, type Server } from 'node:http';
import { createPool, directDatabaseUrl, migrate, type Pool } from '@pt/db';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';

/**
 * Inicialização sem `await` no topo do módulo: hospedagens que carregam o arquivo de entrada
 * com require() (LiteSpeed/Passenger) não aceitam ESM com top-level await.
 * Se algo falhar ao subir (configuração, banco), o processo NÃO cai: responde 503 com o motivo
 * (sem valores secretos) e tenta de novo a cada 30 s — assim o erro aparece no próprio site.
 */

type Target = { port: number; host: string } | { path: string };

/** PORT numérico = TCP; qualquer outro valor = socket Unix entregue pela hospedagem. */
export function listenTarget(raw: string | undefined): Target {
  const v = (raw ?? '').trim();
  if (v === '') return { port: 8080, host: '0.0.0.0' };
  return /^\d+$/.test(v) ? { port: Number(v), host: '0.0.0.0' } : { path: v };
}

/** Tira credenciais de URLs que apareçam em mensagens de erro. */
const sanitize = (msg: string) => msg.replace(/(\w+:\/\/)[^@\s/]+@/g, '$1***@').slice(0, 1000);

const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) =>
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify({ level, severity: level === 'warn' ? 'WARNING' : level.toUpperCase(), msg, ...extra }));

const RETRY_MS = 30_000;

/** Erro de CONEXÃO com o banco (fora do ar, cota do Neon, DNS, senha) — diferente de erro de configuração ou de SQL. */
export function isDbUnavailable(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const m = String(err.message ?? '');
  return /quota|exceeded|endpoint.*disabled|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|terminated|password authentication|too many|Connection|getaddrinfo|socket/i.test(m)
    || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '28P01', '28000', '53300', '57P01', '57P03', '08001', '08006'].includes(String(err.code ?? ''));
}

async function boot(target: Target): Promise<void> {
  const config = loadConfig();
  let pool: Pool | null = null;
  let degraded: string | null = null;
  const runMigrations = async () => {
    if (process.env.MIGRATE_ON_START !== 'true') return;
    // conexão direta só para a migração; o app segue no pool (pooler do Neon, se houver)
    const direct = createPool(directDatabaseUrl(config.DATABASE_URL, config.DATABASE_URL_UNPOOLED), 1);
    try { await migrate(direct); } finally { await direct.end().catch(() => undefined); }
  };
  try {
    try {
      await runMigrations();
    } catch (e) {
      // Banco fora do ar NÃO derruba o site: página de vendas, painel (tela), pixel.js e utms.js continuam no ar;
      // só o que depende do banco responde erro até ele voltar. Antes, o servidor inteiro ficava em 503.
      if (!isDbUnavailable(e)) throw e;
      degraded = sanitize(e instanceof Error ? e.message : String(e));
      log('error', 'banco indisponível ao iniciar — subindo em modo degradado (páginas e scripts no ar)', { motivo: degraded });
    }
    pool = createPool(config.DATABASE_URL, 10);
    const ctx = createCtx(config, pool);
    const app = await buildApp(ctx);
    await app.listen('path' in target ? { path: target.path } : target);
    let worker: ReturnType<typeof startWorker> | null = null;
    const startJobs = () => { if (process.env.EMBEDDED_WORKER === 'true') worker = startWorker(ctx); };
    if (!degraded) startJobs();
    else {
      // tenta de novo a cada 30 s; quando o banco voltar: migrações + worker (fila da Meta, manutenção)
      const retry = async () => {
        try {
          await runMigrations();
          await pool!.query('SELECT 1');
          log('info', 'banco de volta — migrações conferidas e worker iniciado');
          degraded = null;
          startJobs();
        } catch (e) {
          log('warn', 'banco ainda indisponível', { motivo: sanitize(e instanceof Error ? e.message : String(e)) });
          setTimeout(() => void retry(), RETRY_MS);
        }
      };
      setTimeout(() => void retry(), RETRY_MS);
    }
    log('info', degraded ? 'PayTracking no ar (modo degradado: sem banco)' : 'PayTracking no ar', { listen: 'path' in target ? 'socket' : target.port, admins: config.platformAdmins.size });
    if (config.isProd && config.platformAdmins.size === 0) {
      log('warn', 'PLATFORM_ADMIN_EMAILS vazio: ninguém tem acesso ao painel Admin. Defina o seu e-mail nas variáveis de ambiente.');
    }

    const shutdown = async () => {
      await app.close();
      await (worker as ReturnType<typeof startWorker> | null)?.stop();
      await pool?.end();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (e) {
    await pool?.end().catch(() => undefined);
    throw e;
  }
}

/** Responde 503 com o motivo da falha até a próxima tentativa. */
function serveFailure(target: Target, reason: string): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      ok: false,
      erro: 'O PayTracking não conseguiu iniciar.',
      motivo: reason,
      proximaTentativaEmSegundos: RETRY_MS / 1000,
    });
    const srv: Server = createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(RETRY_MS / 1000), 'cache-control': 'no-store' });
      res.end(body);
    });
    srv.on('error', (e) => { log('error', 'falha ao abrir a porta de diagnóstico', { err: sanitize(String(e)) }); setTimeout(resolve, RETRY_MS); });
    srv.listen('path' in target ? target.path : target.port, () => {
      setTimeout(() => srv.close(() => resolve()), RETRY_MS);
    });
  });
}

async function main() {
  const target = listenTarget(process.env.PORT);
  for (;;) {
    try {
      await boot(target);
      return;
    } catch (e) {
      const reason = sanitize(e instanceof Error ? e.message : String(e));
      log('error', 'falha ao iniciar', { motivo: reason });
      await serveFailure(target, reason);
    }
  }
}

void main();
