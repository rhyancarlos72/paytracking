import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// ../../packages/db/src/index.ts
import pg from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
pg.types.setTypeParser(20, (v) => BigInt(v));
function createPool(connectionString, max = 10) {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 3e4, connectionTimeoutMillis: 1e4 });
}
var here = path.dirname(fileURLToPath(import.meta.url));
var MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || [path.join(here, "migrations"), path.resolve(here, "../migrations")].find((d) => existsSync(d)) || path.resolve(here, "../migrations");

// src/config.ts
import { z } from "zod";
var opt = (t) => z.preprocess((v) => v === "" ? void 0 : v, t);
var bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
var schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  /** Conexão direta (sem pooler), usada nas migrações. O `neon env pull` preenche. */
  DATABASE_URL_UNPOOLED: z.string().optional(),
  /** Origem pública do painel (CORS, cookies, links de e-mail). */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Origem pública da API (URLs de webhook, pixel.js, OAuth). */
  PUBLIC_API_URL: z.string().url().default("http://localhost:8080"),
  /** 32 bytes em base64 — criptografia de segredos no banco (AES-256-GCM). */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY deve ter 32 bytes em base64"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /**
   * Proxies confiáveis à frente do servidor. Use o NÚMERO de saltos em produção (Cloud Run = 1):
   * só o IP acrescentado pelo proxy vale. "true" confia na cadeia inteira de X-Forwarded-For,
   * cujo início é escrito pelo próprio cliente (falsificável) — aceitável apenas em testes.
   */
  TRUST_PROXY: z.string().default("false").transform((v, c) => {
    if (v === "true") return true;
    if (v === "false" || v === "") return false;
    if (/^\d{1,2}$/.test(v)) return Number(v);
    c.addIssue({ code: "custom", message: "use false, true ou o n\xFAmero de proxies (ex.: 1)" });
    return z.NEVER;
  }),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_LOGIN_CONFIG_ID: z.string().default(""),
  META_GRAPH_VERSION: opt(z.string().regex(/^v\d+\.\d+$/).default("v25.0")),
  META_TEST_EVENT_CODE: z.string().default(""),
  /** Base da Graph API — só altere em homologação/testes (mock). */
  META_GRAPH_BASE_URL: opt(z.string().url().default("https://graph.facebook.com")),
  WOOVI_APP_ID: z.string().default(""),
  WOOVI_WEBHOOK_SECRET: z.string().default(""),
  WOOVI_API_BASE: opt(z.string().url().default("https://api.openpix.com.br")),
  PLAN_PRICE_MINOR: z.coerce.number().int().positive().default(4700),
  PLAN_TRIAL_DAYS: z.coerce.number().int().positive().default(7),
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:suporte@paytracking.com.br"),
  RESEND_API_KEY: z.string().default(""),
  MAIL_FROM: z.string().default("PayTracking <no-reply@paytracking.com.br>"),
  WEBHOOK_BODY_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  TRACKING_RETENTION_DAYS: z.coerce.number().int().min(7).default(180),
  /**
   * "paused" = modo sombra da migração: tudo é recebido, gravado e enfileirado, mas nada sai
   * para a Meta (o sistema antigo continua enviando). Ver docs/PLANO-MIGRACAO.md.
   */
  CAPI_DISPATCH: opt(z.enum(["enabled", "paused"]).default("enabled")),
  CAPI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(30).default(10),
  /** Diretório do build do painel para servir junto da API (deploy em um container). */
  WEB_DIST_DIR: z.string().default(""),
  PIXEL_DIST_DIR: z.string().default("")
});
function loadConfig(env = process.env) {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configura\xE7\xE3o inv\xE1lida \u2014 ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    if (!c.APP_URL.startsWith("https://") || !c.PUBLIC_API_URL.startsWith("https://")) {
      throw new Error("Em produ\xE7\xE3o APP_URL e PUBLIC_API_URL devem usar https://");
    }
    if (c.TRUST_PROXY === true) {
      throw new Error('Em produ\xE7\xE3o use TRUST_PROXY=<n\xFAmero de proxies> (Cloud Run: 1); "true" permite falsificar o IP do cliente');
    }
  }
  c.APP_URL = c.APP_URL.replace(/\/+$/, "");
  c.PUBLIC_API_URL = c.PUBLIC_API_URL.replace(/\/+$/, "");
  return {
    ...c,
    platformAdmins: new Set(c.PLATFORM_ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
    isProd: c.NODE_ENV === "production"
  };
}

// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
var SecretBox = class {
  key;
  constructor(keyBase64) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32) throw new Error("Chave de criptografia deve ter 32 bytes");
  }
  encrypt(plain) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  }
  decrypt(box) {
    const [v, iv, tag, ct] = box.split(".");
    if (v !== "v1" || !iv || !tag || ct === void 0) throw new Error("Segredo cifrado em formato inv\xE1lido");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  }
  encryptNullable(v) {
    return v ? this.encrypt(v) : null;
  }
  decryptNullable(v) {
    return v ? this.decrypt(v) : null;
  }
};

// src/lib/mailer.ts
function createMailer(config2, log) {
  if (config2.RESEND_API_KEY) {
    return {
      async send(mail) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config2.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: config2.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text })
        });
        if (!r.ok) throw new Error(`Falha ao enviar e-mail (HTTP ${r.status})`);
      }
    };
  }
  return {
    async send(mail) {
      if (config2.isProd) {
        log.error({ to: "[redacted]", subject: mail.subject }, "RESEND_API_KEY ausente: e-mail N\xC3O enviado");
        return;
      }
      log.info({ to: mail.to, subject: mail.subject, text: mail.text }, "e-mail (modo desenvolvimento)");
    }
  };
}

// src/context.ts
function createCtx(config2, db, overrides = {}) {
  const line = (level, severity, o, m) => JSON.stringify({ level, severity, msg: m, ...o });
  const log = overrides.log ?? {
    info: (o, m) => console.log(line("info", "INFO", o, m)),
    warn: (o, m) => console.warn(line("warn", "WARNING", o, m)),
    error: (o, m) => console.error(line("error", "ERROR", o, m))
  };
  return {
    config: config2,
    db,
    box: new SecretBox(config2.ENCRYPTION_KEY),
    fetch: globalThis.fetch.bind(globalThis),
    mailer: createMailer(config2, log),
    now: () => /* @__PURE__ */ new Date(),
    log,
    ...overrides
  };
}

// ../../packages/domain/src/events.ts
var MAP = {};
var add = (name, keys) => keys.forEach((k) => MAP[k] = name);
add("Purchase", [
  "purchase",
  "purshase",
  "comprou",
  "compra",
  "approved",
  "aprovado",
  "paid",
  "pago",
  "sale.approved",
  "sale_approved",
  "sale_paid",
  "payment.approved",
  "payment_approved",
  "payment.paid",
  "payment_paid",
  "pix_paid",
  "pix.paid",
  "order_paid",
  "order.paid",
  "order_approved",
  "order.approved",
  "checkout.purchase",
  "checkout_purchase"
]);
add("InitiateCheckout", [
  "sale.pending",
  "sale_pending",
  "checkout",
  "initiatecheckout",
  "initiate_checkout",
  "checkout_started",
  "checkout.started",
  "pix_generated",
  "pix.generated",
  "pix_gerado",
  "pix.gerado",
  "pix.created",
  "pix_created",
  "pix.pending",
  "pix_pending",
  "pending",
  "pendente",
  "waiting_payment",
  "aguardando_pagamento",
  "aguardando_pagamento_pix"
]);
add("Lead", ["lead", "generatelead", "generate_lead", "cadastro", "signup", "sign_up"]);
add("Refund", ["sale.refunded", "sale_refunded", "refund", "refunded", "reembolso", "estornado"]);
add("PageView", ["page_view", "pageview", "page.view", "page_viewed"]);
add("AddToCart", ["add_to_cart", "addtocart", "cart", "adicionar_carrinho"]);
add("ViewContent", ["view_content", "viewcontent", "content_view", "produto_visualizado"]);
add("AddPaymentInfo", ["add_payment_info", "addpaymentinfo"]);

// ../../packages/domain/src/payment-status.ts
var GENERIC = {};
var put = (s, tokens) => tokens.forEach((t) => GENERIC[t] = s);
put("approved", [
  "paid",
  "pago",
  "approved",
  "aprovado",
  "aprovada",
  "complete",
  "completed",
  "captured",
  "settled",
  "confirmed",
  "confirmado",
  "succeeded",
  "success",
  "successful",
  "concluido",
  "liquidado",
  "liquidated",
  "authorized_and_captured",
  "payment_approved",
  "payment_paid",
  "payment_completed",
  "sale_approved",
  "sale_paid",
  "order_paid",
  "order_approved",
  "order_completed",
  "purchase_approved",
  "purchase_paid",
  "pix_paid",
  "charge_completed"
]);
put("pending", [
  "pending",
  "pendente",
  "waiting",
  "waiting_payment",
  "aguardando",
  "aguardando_pagamento",
  "created",
  "generated",
  "pix_generated",
  "pix_created",
  "pix_gerado",
  "pix_pending",
  "open",
  "em_aberto",
  "aberto",
  "processing",
  "em_processamento",
  "analise",
  "em_analise",
  "in_analysis",
  "waiting_payment_confirmation",
  "billet_printed",
  "printed_billet",
  "boleto_gerado",
  "sale_pending",
  "payment_pending",
  "started"
]);
put("refunded", ["refunded", "reembolsado", "reembolso", "estornado", "refund", "sale_refunded", "payment_refunded", "order_refunded"]);
put("chargeback", ["chargeback", "chargedback", "charged_back", "dispute", "disputed", "contestado"]);
put("canceled", ["canceled", "cancelled", "cancelado", "cancelada", "expired", "expirado", "voided", "void", "sale_canceled"]);
put("failed", ["refused", "recusado", "recusada", "declined", "failed", "falhou", "denied", "rejected", "unpaid", "not_paid", "disapproved"]);

// ../../packages/domain/src/capi.ts
var RATE_LIMIT_CODES = /* @__PURE__ */ new Set([4, 17, 32, 613, 80004, 80001]);
var RETRYABLE_CODES = /* @__PURE__ */ new Set([1, 2]);
var PERMANENT_CODES = /* @__PURE__ */ new Set([10, 100, 102, 190, 200, 270, 294, 803, 2500]);
function classifyCapiResponse(httpStatus, body) {
  const b = body && typeof body === "object" ? body : {};
  const err = b.error;
  const fbtraceId = b.fbtrace_id ?? err?.fbtrace_id;
  if (httpStatus >= 200 && httpStatus < 300 && !err) {
    const received = Number(b.events_received ?? 0);
    if (received >= 1) return { kind: "sent", eventsReceived: received, fbtraceId };
    return { kind: "retryable", message: "Resposta 2xx sem events_received", fbtraceId };
  }
  const code = typeof err?.code === "number" ? err.code : void 0;
  const message = String(err?.error_user_msg ?? err?.message ?? `HTTP ${httpStatus}`).slice(0, 500);
  if (httpStatus === 429 || code !== void 0 && RATE_LIMIT_CODES.has(code)) {
    return { kind: "rate_limited", message, code, fbtraceId };
  }
  if (code !== void 0 && RETRYABLE_CODES.has(code)) return { kind: "retryable", message, code, fbtraceId };
  if (err?.is_transient === true) return { kind: "retryable", message, code, fbtraceId };
  if (httpStatus >= 500 || httpStatus === 0) return { kind: "retryable", message, code, fbtraceId };
  if (code !== void 0 && PERMANENT_CODES.has(code) || httpStatus >= 400 && httpStatus < 500) {
    return { kind: "permanent", message, code, fbtraceId };
  }
  return { kind: "retryable", message, code, fbtraceId };
}
function backoffDelayMs(attempt, opts = {}) {
  const base = opts.baseMs ?? 3e4;
  const cap = opts.capMs ?? 6 * 60 * 60 * 1e3;
  const rnd = opts.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rnd() * (exp / 2));
}

// ../../packages/domain/src/time.ts
function partsInTz(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
function localDate(date, tz) {
  const p = partsInTz(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// src/capi/outbox.ts
async function raiseAlert(c, orgId, a) {
  await c.query(
    `INSERT INTO alerts(org_id, kind, severity, dedup_key, title, detail) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, dedup_key) WHERE resolved_at IS NULL
     DO UPDATE SET occurrences = alerts.occurrences + 1, last_seen_at = now(), detail = EXCLUDED.detail`,
    [orgId, a.kind, a.severity, a.dedupKey, a.title, a.detail ?? null]
  );
}
async function resolveAlert(c, orgId, dedupKey) {
  await c.query("UPDATE alerts SET resolved_at = now() WHERE org_id = $1 AND dedup_key = $2 AND resolved_at IS NULL", [orgId, dedupKey]);
}

// src/capi/dispatcher.ts
async function dispatchBatch(ctx2, limit = 50) {
  const claimed = await ctx2.db.query(
    `UPDATE capi_outbox SET status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM capi_outbox
         WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'sending' AND locked_until < now())
         ORDER BY next_attempt_at, id
         LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, org_id, pixel_id, event_name, event_id, payload, attempts`,
    [limit]
  );
  const stats = { claimed: claimed.rowCount ?? 0, sent: 0, retried: 0, dead: 0 };
  if (!claimed.rowCount) return stats;
  const pixelIds = [...new Set(claimed.rows.map((r) => r.pixel_id))];
  const pr = await ctx2.db.query(
    "SELECT id, meta_pixel_id, capi_token_enc, test_event_code, active, name FROM pixels WHERE id = ANY($1)",
    [pixelIds]
  );
  const pixels = new Map(pr.rows.map((p) => [p.id, p]));
  const queue = [...claimed.rows];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const outcome = await deliver(ctx2, row, pixels.get(row.pixel_id));
      if (outcome === "sent") stats.sent++;
      else if (outcome === "retry") stats.retried++;
      else stats.dead++;
    }
  });
  await Promise.all(workers);
  return stats;
}
async function deliver(ctx2, row, pixel) {
  if (!pixel || !pixel.active || !pixel.capi_token_enc) {
    const reason = !pixel ? "Pixel removido." : !pixel.active ? "Pixel inativo: ative o pixel e reprocesse." : "Pixel sem token da CAPI: edite o pixel e reprocesse.";
    await markDead(ctx2, row, reason, "config", null, void 0);
    if (pixel) {
      await raiseAlert(ctx2.db, row.org_id, {
        kind: "capi_config",
        severity: "critical",
        dedupKey: `capi_config:${row.pixel_id}`,
        title: `Eventos n\xE3o enviados \u2014 pixel "${pixel.name}"`,
        detail: reason
      });
    }
    return "dead";
  }
  const body = {
    data: [row.payload],
    access_token: ctx2.box.decrypt(pixel.capi_token_enc)
  };
  const testCode = pixel.test_event_code || ctx2.config.META_TEST_EVENT_CODE;
  if (testCode) body.test_event_code = testCode;
  const started = Date.now();
  let http = 0;
  let outcome;
  try {
    const res = await ctx2.fetch(`${ctx2.config.META_GRAPH_BASE_URL}/${ctx2.config.META_GRAPH_VERSION}/${pixel.meta_pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15e3)
    });
    http = res.status;
    const json = await res.json().catch(() => null);
    outcome = classifyCapiResponse(http, json);
  } catch (e) {
    outcome = { kind: "retryable", message: `Falha de rede: ${e.message}`.slice(0, 300) };
  }
  const duration = Date.now() - started;
  await ctx2.db.query(
    `INSERT INTO capi_attempts(outbox_id, http_status, duration_ms, outcome, error_code, message, fbtrace_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      row.id,
      http || null,
      duration,
      outcome.kind,
      "code" in outcome ? outcome.code ?? null : null,
      outcome.kind === "sent" ? null : outcome.message,
      outcome.fbtraceId ?? null
    ]
  );
  if (outcome.kind === "sent") {
    await ctx2.db.query(
      `UPDATE capi_outbox SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL, last_error_class = NULL,
              last_http_status = $2, events_received = $3, fbtrace_id = $4 WHERE id = $1`,
      [row.id, http, outcome.eventsReceived, outcome.fbtraceId ?? null]
    );
    await resolveAlert(ctx2.db, row.org_id, `capi_failing:${row.pixel_id}`);
    await resolveAlert(ctx2.db, row.org_id, `capi_config:${row.pixel_id}`);
    return "sent";
  }
  const max = ctx2.config.CAPI_MAX_ATTEMPTS;
  if (outcome.kind === "permanent" || row.attempts >= max) {
    await markDead(ctx2, row, outcome.message, outcome.kind, http, outcome.fbtraceId);
    const tokenProblem = outcome.kind === "permanent" && (outcome.code === 190 || outcome.code === 200 || outcome.code === 10);
    await raiseAlert(ctx2.db, row.org_id, {
      kind: tokenProblem ? "capi_token" : "capi_failing",
      severity: "critical",
      dedupKey: tokenProblem ? `capi_config:${row.pixel_id}` : `capi_failing:${row.pixel_id}`,
      title: tokenProblem ? `Token da CAPI inv\xE1lido ou sem permiss\xE3o \u2014 pixel "${pixel.name}"` : `Falha persistente no envio \xE0 Meta \u2014 pixel "${pixel.name}"`,
      detail: `${row.event_name} ${row.event_id}: ${outcome.message}`
    });
    return "dead";
  }
  let delay = backoffDelayMs(row.attempts);
  if (outcome.kind === "rate_limited") delay = Math.max(delay, 5 * 6e4);
  await ctx2.db.query(
    `UPDATE capi_outbox SET status = 'pending', locked_until = NULL, next_attempt_at = now() + make_interval(secs => $2),
            last_error = $3, last_error_class = $4, last_http_status = $5, fbtrace_id = $6 WHERE id = $1`,
    [row.id, delay / 1e3, outcome.message, outcome.kind, http || null, outcome.fbtraceId ?? null]
  );
  return "retry";
}
async function markDead(ctx2, row, message, cls, http, fbtraceId) {
  await ctx2.db.query(
    `UPDATE capi_outbox SET status = 'dead', locked_until = NULL, last_error = $2, last_error_class = $3, last_http_status = $4,
            fbtrace_id = COALESCE($5, fbtrace_id) WHERE id = $1`,
    [row.id, message.slice(0, 1e3), cls, http, fbtraceId ?? null]
  );
}

// src/fx/service.ts
async function refreshRates(ctx2) {
  let stored = 0;
  const sources = [];
  let date = localDate(ctx2.now(), "UTC");
  try {
    const r = await ctx2.fetch("https://api.frankfurter.dev/v1/latest?base=EUR", { signal: AbortSignal.timeout(1e4) });
    if (r.ok) {
      const j = await r.json();
      date = j.date;
      for (const [quote, rate] of Object.entries(j.rates)) stored += await storeRate(ctx2.db, j.date, "EUR", quote, rate, "ecb-frankfurter");
      stored += await storeRate(ctx2.db, j.date, "EUR", "EUR", 1, "identity");
      sources.push("ecb-frankfurter");
    }
  } catch (e) {
    ctx2.log.warn({ err: String(e) }, "Frankfurter indispon\xEDvel");
  }
  try {
    const r = await ctx2.fetch("https://open.er-api.com/v6/latest/EUR", { signal: AbortSignal.timeout(1e4) });
    if (r.ok) {
      const j = await r.json();
      if (j.result === "success") {
        const d = new Date(j.time_last_update_unix * 1e3).toISOString().slice(0, 10);
        for (const [quote, rate] of Object.entries(j.rates)) {
          stored += await storeRate(ctx2.db, d, "EUR", quote, rate, "open-er-api", false);
        }
        sources.push("open-er-api");
      }
    }
  } catch (e) {
    ctx2.log.warn({ err: String(e) }, "open.er-api indispon\xEDvel");
  }
  return { date, stored, sources };
}
async function storeRate(db, date, base, quote, rate, source, overwrite = true) {
  if (!/^[A-Z]{3}$/.test(quote) || !(rate > 0)) return 0;
  const r = await db.query(
    `INSERT INTO fx_rates(rate_date, base, quote, rate, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (rate_date, base, quote) DO ${overwrite ? "UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = now()" : "NOTHING"}`,
    [date, base, quote, rate.toFixed(8), source]
  );
  return r.rowCount ?? 0;
}

// src/worker.ts
async function maintenance(ctx2) {
  const q = (sql, p = []) => ctx2.db.query(sql, p).then((r) => r.rowCount ?? 0);
  const out = {
    trackingEvents: await q(`DELETE FROM tracking_events WHERE received_at < now() - make_interval(days => $1)`, [ctx2.config.TRACKING_RETENTION_DAYS]),
    webhookBodies: await q(`UPDATE webhook_receipts SET body_enc = NULL WHERE body_enc IS NOT NULL AND received_at < now() - make_interval(days => $1)`, [ctx2.config.WEBHOOK_BODY_RETENTION_DAYS]),
    identities: await q(`DELETE FROM visitor_identities WHERE updated_at < now() - interval '120 days'`),
    sessions: await q(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`),
    tokens: await q(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`),
    rateLimits: await q(`DELETE FROM rate_limits WHERE window_end < now()`),
    oauthStates: await q(`DELETE FROM oauth_states WHERE expires_at < now()`),
    cache: await q(`DELETE FROM meta_insights_cache WHERE fetched_at < now() - interval '2 days'`),
    expiredCharges: await q(`UPDATE billing_charges SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`)
  };
  const exp = await ctx2.db.query(
    `SELECT org_id FROM meta_connections WHERE status = 'active' AND token_expires_at IS NOT NULL AND token_expires_at < now() + interval '7 days'`
  );
  for (const r of exp.rows) {
    await raiseAlert(ctx2.db, r.org_id, {
      kind: "meta_token_expiring",
      severity: "warning",
      dedupKey: "meta_token_expiring",
      title: "A conex\xE3o com o Facebook Ads expira em menos de 7 dias",
      detail: "Reconecte a conta em Integra\xE7\xF5es \u2192 Meta Ads para renovar."
    });
  }
  return out;
}
function startWorker(ctx2, opts = {}) {
  let stopped = false;
  const interval = opts.intervalMs ?? 1e3;
  let lastFx = 0;
  let lastMaint = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        const s = ctx2.config.CAPI_DISPATCH === "paused" ? { claimed: 0, sent: 0, retried: 0, dead: 0 } : await dispatchBatch(ctx2, 50);
        if (s.claimed) ctx2.log.info({ ...s }, "capi dispatch");
        const now = Date.now();
        if (now - lastFx > 6 * 36e5) {
          lastFx = now;
          refreshRates(ctx2).then((r) => ctx2.log.info(r, "c\xE2mbio atualizado")).catch((e) => ctx2.log.warn({ err: String(e) }, "c\xE2mbio falhou"));
        }
        if (now - lastMaint > 36e5) {
          lastMaint = now;
          maintenance(ctx2).then((r) => ctx2.log.info(r, "manuten\xE7\xE3o")).catch((e) => ctx2.log.warn({ err: String(e) }, "manuten\xE7\xE3o falhou"));
        }
        if (s.claimed < 50) await new Promise((r) => setTimeout(r, interval));
      } catch (e) {
        ctx2.log.error({ err: String(e) }, "worker: erro no ciclo");
        await new Promise((r) => setTimeout(r, 5e3));
      }
    }
  };
  const done = loop();
  return { stop: async () => {
    stopped = true;
    await done;
  } };
}

// src/worker-main.ts
var config = loadConfig();
var pool = createPool(config.DATABASE_URL, 5);
var ctx = createCtx(config, pool);
var w = startWorker(ctx);
var shutdown = async () => {
  await w.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
ctx.log.info({}, "worker iniciado");
//# sourceMappingURL=worker.js.map
