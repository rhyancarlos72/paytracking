import type { Pool } from '@pt/db';
import type { Config } from './config.js';
import { SecretBox } from './lib/crypto.js';
import { createMailer, type Mailer } from './lib/mailer.js';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Dependências injetáveis — testes trocam `fetch`, `mailer` e `now` por dublês. */
export interface Ctx {
  config: Config;
  db: Pool;
  box: SecretBox;
  fetch: typeof fetch;
  mailer: Mailer;
  now: () => Date;
  log: Logger;
}

export function createCtx(config: Config, db: Pool, overrides: Partial<Ctx> = {}): Ctx {
  const log: Logger = overrides.log ?? {
    info: (o, m) => console.log(JSON.stringify({ level: 'info', msg: m, ...(o as object) })),
    warn: (o, m) => console.warn(JSON.stringify({ level: 'warn', msg: m, ...(o as object) })),
    error: (o, m) => console.error(JSON.stringify({ level: 'error', msg: m, ...(o as object) })),
  };
  return {
    config,
    db,
    box: new SecretBox(config.ENCRYPTION_KEY),
    fetch: globalThis.fetch.bind(globalThis),
    mailer: createMailer(config, log),
    now: () => new Date(),
    log,
    ...overrides,
  };
}
