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
  // JSON por linha; `severity` é o campo que o Cloud Logging usa para o nível
  const line = (level: string, severity: string, o: unknown, m?: string) => JSON.stringify({ level, severity, msg: m, ...(o as object) });
  const log: Logger = overrides.log ?? {
    info: (o, m) => console.log(line('info', 'INFO', o, m)),
    warn: (o, m) => console.warn(line('warn', 'WARNING', o, m)),
    error: (o, m) => console.error(line('error', 'ERROR', o, m)),
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
