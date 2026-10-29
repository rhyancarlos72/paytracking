import { z } from 'zod';

/** variável presente mas vazia (comum em .env) vale como ausente → usa o padrão */
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t);
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  /** Conexão direta (sem pooler), usada nas migrações. O `neon env pull` preenche. */
  DATABASE_URL_UNPOOLED: z.string().optional(),
  /** Origem pública do painel (CORS, cookies, links de e-mail). */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Origem pública da API (URLs de webhook, pixel.js, OAuth). */
  PUBLIC_API_URL: z.string().url().default('http://localhost:8080'),
  /** 32 bytes em base64 — criptografia de segredos no banco (AES-256-GCM). */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY deve ter 32 bytes em base64'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * Proxies confiáveis à frente do servidor. Use o NÚMERO de saltos em produção (Cloud Run = 1):
   * só o IP acrescentado pelo proxy vale. "true" confia na cadeia inteira de X-Forwarded-For,
   * cujo início é escrito pelo próprio cliente (falsificável) — aceitável apenas em testes.
   */
  TRUST_PROXY: z.string().default('false').transform((v, c) => {
    if (v === 'true') return true as const;
    if (v === 'false' || v === '') return false as const;
    if (/^\d{1,2}$/.test(v)) return Number(v);
    c.addIssue({ code: 'custom', message: 'use false, true ou o número de proxies (ex.: 1)' });
    return z.NEVER;
  }),
  PLATFORM_ADMIN_EMAILS: z.string().default(''),

  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_LOGIN_CONFIG_ID: z.string().default(''),
  META_GRAPH_VERSION: opt(z.string().regex(/^v\d+\.\d+$/).default('v25.0')),
  META_TEST_EVENT_CODE: z.string().default(''),
  /** Base da Graph API — só altere em homologação/testes (mock). */
  META_GRAPH_BASE_URL: opt(z.string().url().default('https://graph.facebook.com')),

  WOOVI_APP_ID: z.string().default(''),
  WOOVI_WEBHOOK_SECRET: z.string().default(''),
  WOOVI_API_BASE: opt(z.string().url().default('https://api.openpix.com.br')),
  PLAN_PRICE_MINOR: z.coerce.number().int().positive().default(4700),
  PLAN_TRIAL_DAYS: z.coerce.number().int().positive().default(7),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:suporte@paytracking.com.br'),

  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('PayTracking <no-reply@paytracking.com.br>'),

  WEBHOOK_BODY_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  TRACKING_RETENTION_DAYS: z.coerce.number().int().min(7).default(180),
  /**
   * "paused" = modo sombra da migração: tudo é recebido, gravado e enfileirado, mas nada sai
   * para a Meta (o sistema antigo continua enviando). Ver docs/PLANO-MIGRACAO.md.
   */
  CAPI_DISPATCH: opt(z.enum(['enabled', 'paused']).default('enabled')),
  CAPI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(30).default(10),
  /** Diretório do build do painel para servir junto da API (deploy em um container). */
  WEB_DIST_DIR: z.string().default(''),
  PIXEL_DIST_DIR: z.string().default(''),
});

export type Config = z.infer<typeof schema> & { platformAdmins: Set<string>; isProd: boolean };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // painéis de hospedagem costumam gravar campos não preenchidos como "": tratamos como ausentes
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida — ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.APP_URL.startsWith('https://') || !c.PUBLIC_API_URL.startsWith('https://')) {
      throw new Error('Em produção APP_URL e PUBLIC_API_URL devem usar https://');
    }
    if (c.TRUST_PROXY === true) {
      throw new Error('Em produção use TRUST_PROXY=<número de proxies> (Cloud Run: 1); "true" permite falsificar o IP do cliente');
    }
  }
  // aceita "https://site.com/": sem a barra final os links montados não saem com "//"
  c.APP_URL = c.APP_URL.replace(/\/+$/, '');
  c.PUBLIC_API_URL = c.PUBLIC_API_URL.replace(/\/+$/, '');
  return {
    ...c,
    platformAdmins: new Set(c.PLATFORM_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    isProd: c.NODE_ENV === 'production',
  };
}
