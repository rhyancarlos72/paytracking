import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// ../../packages/db/src/index.ts
import pg from "pg";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
pg.types.setTypeParser(20, (v) => BigInt(v));
function createPool(connectionString, max = 10) {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 3e4, connectionTimeoutMillis: 1e4 });
}
function directDatabaseUrl(pooledUrl, unpooledUrl) {
  if (unpooledUrl) return unpooledUrl;
  try {
    const u = new URL(pooledUrl);
    if (/^ep-[^.]+-pooler\./.test(u.hostname)) u.hostname = u.hostname.replace(/-pooler\./, ".");
    return u.toString();
  } catch {
    return pooledUrl;
  }
}
var here = path.dirname(fileURLToPath(import.meta.url));
var MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || [path.join(here, "migrations"), path.resolve(here, "../migrations")].find((d) => existsSync(d)) || path.resolve(here, "../migrations");
async function migrate(pool2, dir = MIGRATIONS_DIR, log = console.log) {
  const client = await pool2.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
        log(`migra\xE7\xE3o aplicada: ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migra\xE7\xE3o ${f}: ${e.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => void 0);
    client.release();
  }
  return applied;
}
async function tx(pool2, fn) {
  const c = await pool2.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => void 0);
    throw e;
  } finally {
    c.release();
  }
}

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
var sha256Hex = (v) => createHash("sha256").update(v, "utf8").digest("hex");
var randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
var integrationToken = () => "itk_" + randomBytes(24).toString("hex");
var publicKey = () => "pt_px_" + randomBytes(10).toString("hex");
var hint = (token) => "\u2026" + token.slice(-4);

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

// src/app.ts
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { existsSync as existsSync2, readFileSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { randomUUID as randomUUID3 } from "node:crypto";
import { ZodError } from "zod";

// src/auth/service.ts
import bcrypt from "bcryptjs";

// src/lib/errors.ts
var AppError = class extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var badRequest = (message, details) => new AppError(400, "bad_request", message, details);
var unauthorized = (message = "Fa\xE7a login para continuar.") => new AppError(401, "unauthorized", message);
var paymentRequired = (message = "Sua assinatura expirou. Regularize em Financeiro.") => new AppError(402, "plan_expired", message);
var forbidden = (message = "Voc\xEA n\xE3o tem permiss\xE3o para esta a\xE7\xE3o.") => new AppError(403, "forbidden", message);
var notFound = (message = "N\xE3o encontrado.") => new AppError(404, "not_found", message);
var conflict = (message) => new AppError(409, "conflict", message);
var tooMany = (message = "Muitas tentativas. Aguarde alguns minutos.") => new AppError(429, "rate_limited", message);

// src/auth/service.ts
var ROLE_RANK = { viewer: 0, analyst: 1, admin: 2, owner: 3 };
var BCRYPT_COST = 12;
function validatePassword(pw) {
  if (pw.length < 10 || pw.length > 200) throw badRequest("A senha deve ter entre 10 e 200 caracteres.");
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
    throw badRequest("A senha precisa conter letra mai\xFAscula, min\xFAscula e n\xFAmero.");
  }
}
var hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
async function verifyPassword(pw, hash) {
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}
var dummyHash = null;
var getDummyHash = () => dummyHash ??= bcrypt.hash("paytracking-timing-equalizer", BCRYPT_COST);
function planState(org, now) {
  if (org.plan_status === "exempt") return { status: "exempt", daysLeft: null, blocked: false };
  const exp = org.plan_expires_at;
  const expired = !exp || exp.getTime() < now.getTime();
  const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 864e5)) : 0;
  return { status: expired ? "expired" : org.plan_status, daysLeft, blocked: expired };
}
async function createUserWithOrg(ctx2, input) {
  validatePassword(input.password);
  const email2 = input.email.trim().toLowerCase();
  const hash = await hashPassword(input.password);
  const trialEnd = new Date(ctx2.now().getTime() + ctx2.config.PLAN_TRIAL_DAYS * 864e5);
  return tx(ctx2.db, async (c) => {
    const exists = await c.query("SELECT 1 FROM users WHERE email = $1", [email2]);
    if (exists.rowCount) throw conflict("J\xE1 existe uma conta com este e-mail. Fa\xE7a login.");
    const isAdmin = ctx2.config.platformAdmins.has(email2);
    const u = await c.query(
      "INSERT INTO users(email, password_hash, name, is_platform_admin) VALUES ($1, $2, $3, $4) RETURNING id",
      [email2, hash, input.name?.trim() || null, isAdmin]
    );
    const userId = u.rows[0].id;
    const o = await c.query(
      `INSERT INTO organizations(name, plan_status, plan_expires_at, plan_started_at) VALUES ($1, $2, $3, now()) RETURNING id`,
      [input.orgName?.trim() || input.name?.trim() || email2.split("@")[0], isAdmin ? "exempt" : "trial", isAdmin ? null : trialEnd]
    );
    const orgId = o.rows[0].id;
    await c.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, userId]);
    await c.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'account.created')`, [orgId, userId]);
    return { userId, orgId };
  });
}
async function authenticate(ctx2, email2, password) {
  const r = await ctx2.db.query(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [email2.trim().toLowerCase()]
  );
  const row = r.rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? await getDummyHash());
  if (!row || !ok) return null;
  if (!row.password_hash.startsWith(`$2a$${BCRYPT_COST}$`) && !row.password_hash.startsWith(`$2b$${BCRYPT_COST}$`)) {
    await ctx2.db.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(password), row.id]);
  }
  return { id: row.id };
}
async function createSession(ctx2, userId, meta) {
  const token = randomToken(32);
  const expires = new Date(ctx2.now().getTime() + ctx2.config.SESSION_TTL_DAYS * 864e5);
  await ctx2.db.query(
    "INSERT INTO sessions(id, user_id, active_org_id, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [sha256Hex(token), userId, meta.orgId ?? null, meta.ip ?? null, meta.ua?.slice(0, 300) ?? null, expires]
  );
  return { token, expires };
}
async function revokeSessions(ctx2, userId, exceptSessionId) {
  const r = await ctx2.db.query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2)",
    [userId, exceptSessionId ?? null]
  );
  return r.rowCount ?? 0;
}
async function resolveSession(ctx2, token) {
  const id = sha256Hex(token);
  const r = await ctx2.db.query(
    `SELECT s.id AS session_id, s.active_org_id, s.expires_at, s.last_seen_at,
            u.id AS user_id, u.email, u.name, u.is_platform_admin, u.email_verified_at, u.hide_email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [id]
  );
  const s = r.rows[0];
  if (!s) return null;
  const m = await ctx2.db.query(
    `SELECT m.role, o.id, o.name, o.reporting_currency, o.timezone, o.plan_status, o.plan_expires_at,
            o.goal_daily_minor, o.goal_monthly_minor
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1
      ORDER BY (o.id = $2) DESC, m.created_at ASC LIMIT 1`,
    [s.user_id, s.active_org_id]
  );
  const org = m.rows[0];
  if (!org) return null;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 6e4) {
    await ctx2.db.query(
      "UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1",
      [id, ctx2.config.SESSION_TTL_DAYS]
    );
  }
  return {
    sessionId: s.session_id,
    user: {
      id: s.user_id,
      email: s.email,
      name: s.name,
      isPlatformAdmin: s.is_platform_admin,
      emailVerified: !!s.email_verified_at,
      hideEmail: s.hide_email
    },
    role: org.role,
    org: {
      id: org.id,
      name: org.name,
      reporting_currency: org.reporting_currency.trim(),
      timezone: org.timezone,
      plan_status: org.plan_status,
      plan_expires_at: org.plan_expires_at,
      goal_daily_minor: org.goal_daily_minor,
      goal_monthly_minor: org.goal_monthly_minor
    }
  };
}
async function issueToken(ctx2, userId, kind, ttlMin) {
  const token = randomToken(32);
  await ctx2.db.query(
    `INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, kind, sha256Hex(token), ttlMin]
  );
  return token;
}
async function consumeToken(ctx2, token, kind) {
  const r = await ctx2.db.query(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256Hex(token), kind]
  );
  return r.rows[0]?.user_id ?? null;
}

// src/auth/routes.ts
import { z as z2 } from "zod";

// src/lib/rate-limit.ts
async function hit(db, bucket, limit, windowSec) {
  const r = await db.query(
    `INSERT INTO rate_limits(bucket, count, window_end) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.window_end < now() THEN 1 ELSE rate_limits.count + 1 END,
       window_end = CASE WHEN rate_limits.window_end < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.window_end END
     RETURNING count`,
    [bucket, windowSec]
  );
  const count = r.rows[0]?.count ?? 0;
  if (count > limit) throw tooMany();
  return count;
}
async function clear(db, bucket) {
  await db.query("DELETE FROM rate_limits WHERE bucket = $1", [bucket]);
}

// src/lib/http.ts
var SESSION_COOKIE = "pt_session";
function parse(schema2, data) {
  const r = schema2.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
    throw badRequest(issues[0] ? `${issues[0].path ? issues[0].path + ": " : ""}${issues[0].message}` : "Dados inv\xE1lidos.", issues);
  }
  return r.data;
}
function auth(req) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
function requireRole(req, min, opts = {}) {
  const a = auth(req);
  if (!opts.allowExpiredPlan && !a.user.isPlatformAdmin && planState(a.org, /* @__PURE__ */ new Date()).blocked) throw paymentRequired();
  if (ROLE_RANK[a.role] < ROLE_RANK[min]) throw forbidden();
  return a;
}
function requirePlatformAdmin(req) {
  const a = auth(req);
  if (!a.user.isPlatformAdmin) throw forbidden();
  return a;
}
function setSessionCookie(reply, token, expires, secure) {
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, secure, sameSite: "lax", expires });
}
function clearSessionCookie(reply, secure) {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure, sameSite: "lax" });
}
var clientIp = (req) => req.ip;
function jsonSafe(v) {
  return JSON.parse(JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x));
}

// src/auth/routes.ts
var email = z2.string().trim().toLowerCase().email("E-mail inv\xE1lido").max(190);
function authRoutes(app2, ctx2) {
  const secure = ctx2.config.isProd;
  async function sendVerification(userId, to) {
    const token = await issueToken(ctx2, userId, "email_verify", 60 * 24 * 3);
    await ctx2.mailer.send({
      to,
      subject: "Confirme seu e-mail \u2014 PayTracking",
      text: `Confirme seu e-mail acessando: ${ctx2.config.APP_URL}/verificar-email?token=${token}

O link expira em 3 dias.`
    });
  }
  app2.post("/v1/auth/signup", async (req, reply) => {
    await hit(ctx2.db, `signup:ip:${clientIp(req)}`, 10, 3600);
    const body = parse(z2.object({
      email,
      password: z2.string(),
      name: z2.string().trim().max(120).optional(),
      orgName: z2.string().trim().max(120).optional()
    }), req.body);
    const { userId, orgId } = await createUserWithOrg(ctx2, body);
    const s = await createSession(ctx2, userId, { ip: clientIp(req), ua: req.headers["user-agent"], orgId });
    setSessionCookie(reply, s.token, s.expires, secure);
    await sendVerification(userId, body.email).catch((e) => ctx2.log.error({ err: String(e) }, "falha ao enviar verifica\xE7\xE3o"));
    return reply.code(201).send({ ok: true });
  });
  app2.post("/v1/auth/login", async (req, reply) => {
    const body = parse(z2.object({ email, password: z2.string().min(1).max(200) }), req.body);
    const ipBucket = `login:ip:${clientIp(req)}`;
    const emailBucket = `login:email:${body.email}`;
    await hit(ctx2.db, ipBucket, 30, 900);
    await hit(ctx2.db, emailBucket, 8, 900);
    const user = await authenticate(ctx2, body.email, body.password);
    if (!user) throw unauthorized("E-mail ou senha incorretos.");
    await clear(ctx2.db, emailBucket);
    const s = await createSession(ctx2, user.id, { ip: clientIp(req), ua: req.headers["user-agent"] });
    setSessionCookie(reply, s.token, s.expires, secure);
    return { ok: true };
  });
  app2.post("/v1/auth/logout", async (req, reply) => {
    if (req.auth) await ctx2.db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [req.auth.sessionId]);
    clearSessionCookie(reply, secure);
    return { ok: true };
  });
  app2.get("/v1/auth/me", async (req) => {
    const a = auth(req);
    const orgs = await ctx2.db.query(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.name`,
      [a.user.id]
    );
    const plan = planState(a.org, ctx2.now());
    return {
      user: a.user,
      role: a.role,
      org: {
        id: a.org.id,
        name: a.org.name,
        reportingCurrency: a.org.reporting_currency,
        timezone: a.org.timezone,
        goalDailyMinor: a.org.goal_daily_minor.toString(),
        goalMonthlyMinor: a.org.goal_monthly_minor.toString()
      },
      plan: { ...plan, expiresAt: a.org.plan_expires_at, priceMinor: ctx2.config.PLAN_PRICE_MINOR },
      orgs: orgs.rows
    };
  });
  app2.post("/v1/auth/switch-org", async (req) => {
    const a = auth(req);
    const { orgId } = parse(z2.object({ orgId: z2.string().uuid() }), req.body);
    const m = await ctx2.db.query("SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2", [orgId, a.user.id]);
    if (!m.rowCount) throw badRequest("Organiza\xE7\xE3o n\xE3o encontrada.");
    await ctx2.db.query("UPDATE sessions SET active_org_id = $1 WHERE id = $2", [orgId, a.sessionId]);
    return { ok: true };
  });
  app2.post("/v1/auth/forgot-password", async (req) => {
    await hit(ctx2.db, `forgot:ip:${clientIp(req)}`, 10, 3600);
    const body = parse(z2.object({ email }), req.body);
    const u = await ctx2.db.query("SELECT id FROM users WHERE email = $1", [body.email]);
    const row = u.rows[0];
    if (row) {
      const token = await issueToken(ctx2, row.id, "password_reset", 60);
      await ctx2.mailer.send({
        to: body.email,
        subject: "Redefini\xE7\xE3o de senha \u2014 PayTracking",
        text: `Para criar uma nova senha acesse: ${ctx2.config.APP_URL}/redefinir-senha?token=${token}

O link expira em 1 hora. Se voc\xEA n\xE3o pediu, ignore este e-mail.`
      });
    }
    return { ok: true };
  });
  app2.post("/v1/auth/reset-password", async (req) => {
    await hit(ctx2.db, `reset:ip:${clientIp(req)}`, 20, 3600);
    const body = parse(z2.object({ token: z2.string().min(20), password: z2.string() }), req.body);
    validatePassword(body.password);
    const userId = await consumeToken(ctx2, body.token, "password_reset");
    if (!userId) throw badRequest("Link inv\xE1lido ou expirado. Solicite um novo.");
    await ctx2.db.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(body.password), userId]);
    await revokeSessions(ctx2, userId);
    await ctx2.db.query(`INSERT INTO audit_log(user_id, action) VALUES ($1, 'auth.password_reset')`, [userId]);
    return { ok: true };
  });
  app2.post("/v1/auth/verify-email", async (req) => {
    const body = parse(z2.object({ token: z2.string().min(20) }), req.body);
    const userId = await consumeToken(ctx2, body.token, "email_verify");
    if (!userId) throw badRequest("Link inv\xE1lido ou expirado.");
    await ctx2.db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [userId]);
    return { ok: true };
  });
  app2.post("/v1/auth/resend-verification", async (req) => {
    const a = auth(req);
    await hit(ctx2.db, `verify:user:${a.user.id}`, 5, 3600);
    if (!a.user.emailVerified) await sendVerification(a.user.id, a.user.email);
    return { ok: true };
  });
  app2.post("/v1/auth/change-password", async (req) => {
    const a = auth(req);
    await hit(ctx2.db, `chpw:user:${a.user.id}`, 10, 900);
    const body = parse(z2.object({ currentPassword: z2.string().min(1), newPassword: z2.string() }), req.body);
    validatePassword(body.newPassword);
    if (body.newPassword === body.currentPassword) throw badRequest("A nova senha deve ser diferente da atual.");
    const r = await ctx2.db.query("SELECT password_hash FROM users WHERE id = $1", [a.user.id]);
    if (!await verifyPassword(body.currentPassword, r.rows[0]?.password_hash ?? "")) throw badRequest("Senha atual incorreta.");
    await ctx2.db.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(body.newPassword), a.user.id]);
    const revoked = await revokeSessions(ctx2, a.user.id, a.sessionId);
    await ctx2.db.query(`INSERT INTO audit_log(org_id, user_id, action) VALUES ($1, $2, 'auth.password_changed')`, [a.org.id, a.user.id]);
    return { ok: true, revokedSessions: revoked };
  });
  app2.get("/v1/auth/sessions", async (req) => {
    const a = auth(req);
    const r = await ctx2.db.query(
      `SELECT left(id, 12) AS id, host(ip) AS ip, user_agent, created_at, last_seen_at, (id = $2) AS current
         FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`,
      [a.user.id, a.sessionId]
    );
    return { sessions: r.rows };
  });
  app2.post("/v1/auth/sessions/revoke-others", async (req) => {
    const a = auth(req);
    return { revoked: await revokeSessions(ctx2, a.user.id, a.sessionId) };
  });
  app2.patch("/v1/auth/preferences", async (req) => {
    const a = auth(req);
    const body = parse(z2.object({ hideEmail: z2.boolean().optional(), name: z2.string().trim().max(120).optional() }), req.body);
    await ctx2.db.query(
      "UPDATE users SET hide_email = COALESCE($2, hide_email), name = COALESCE($3, name), updated_at = now() WHERE id = $1",
      [a.user.id, body.hideEmail ?? null, body.name ?? null]
    );
    return { ok: true };
  });
}

// src/orgs/routes.ts
import { z as z3 } from "zod";

// ../../packages/domain/src/money.ts
var EXPONENTS = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3
};
function isCurrencyCode(code) {
  return typeof code === "string" && /^[A-Z]{3}$/.test(code);
}
function normalizeCurrency(code) {
  if (typeof code !== "string") return null;
  const c = code.trim().toUpperCase();
  return isCurrencyCode(c) ? c : null;
}
function currencyExponent(currency) {
  return EXPONENTS[currency] ?? 2;
}
var POW10 = (n) => 10n ** BigInt(n);
function decimalStringToMinor(canonical, exponent) {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(canonical);
  if (!m) return null;
  const negative = m[1] === "-";
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? "";
  const frac = fracPart.slice(0, exponent).padEnd(exponent, "0");
  let minor = BigInt(intPart) * POW10(exponent) + (frac ? BigInt(frac) : 0n);
  const nextDigit = fracPart.charAt(exponent);
  if (nextDigit !== "" && Number(nextDigit) >= 5) minor += 1n;
  return negative ? -minor : minor;
}
function canonicalDecimal(raw) {
  let v = raw.trim().replace(/[^\d.,-]/g, "");
  if (v === "" || v === "-") return null;
  const neg = v.startsWith("-");
  v = v.replace(/-/g, "");
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    v = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const commas = (v.match(/,/g) ?? []).length;
    const after = v.length - lastComma - 1;
    const thousands = commas > 1 || after === 3 && lastComma >= 1 && lastComma <= 3 && v[0] !== "0";
    v = thousands ? v.replace(/,/g, "") : v.replace(",", ".");
  } else if (lastDot !== -1) {
    const dots = (v.match(/\./g) ?? []).length;
    if (dots > 1) v = v.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return (neg ? "-" : "") + v;
}
function numberToCanonical(n) {
  if (!Number.isFinite(n)) return null;
  let s = Number(n.toPrecision(15)).toString();
  if (/e/i.test(s)) s = n.toFixed(10).replace(/\.?0+$/, "");
  return s;
}
function parseAmount(input, currency, unit) {
  if (input === null || input === void 0 || input === "") return null;
  const exp = currencyExponent(currency);
  if (unit === "minor") {
    if (typeof input === "number") return Number.isSafeInteger(input) ? BigInt(input) : null;
    if (typeof input === "string" && /^-?\d+$/.test(input.trim())) return BigInt(input.trim());
    if (typeof input === "bigint") return input;
    return null;
  }
  let canonical = null;
  if (typeof input === "number") canonical = numberToCanonical(input);
  else if (typeof input === "string") canonical = canonicalDecimal(input);
  else if (typeof input === "bigint") canonical = input.toString();
  return canonical === null ? null : decimalStringToMinor(canonical, exp);
}
function minorToDecimalString(amountMinor, currency) {
  const exp = currencyExponent(currency);
  const neg = amountMinor < 0n;
  const abs = neg ? -amountMinor : amountMinor;
  const s = abs.toString().padStart(exp + 1, "0");
  const intPart = exp ? s.slice(0, -exp) : s;
  const frac = exp ? "." + s.slice(-exp) : "";
  return (neg ? "-" : "") + intPart + frac;
}
function minorToNumber(amountMinor, currency) {
  return Number(minorToDecimalString(amountMinor, currency));
}
function formatMoney(amountMinor, currency, locale = "pt-BR") {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp
  }).format(minorToNumber(amountMinor, currency));
}

// ../../packages/domain/src/fx.ts
var RATE_SCALE = 100000000n;
function parseRate(rate) {
  const s = typeof rate === "number" ? rate.toFixed(8) : rate.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Taxa de c\xE2mbio inv\xE1lida: ${s}`);
  const frac = (m[2] ?? "").slice(0, 8).padEnd(8, "0");
  const scaled = BigInt(m[1] ?? "0") * RATE_SCALE + BigInt(frac);
  if (scaled <= 0n) throw new Error("Taxa de c\xE2mbio deve ser positiva");
  return scaled;
}
function divRound(n, d) {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const res = r * 2n >= ad ? q + 1n : q;
  return neg ? -res : res;
}
function convertMinor(amountMinor, from, to, rate) {
  if (from === to) return amountMinor;
  const scaled = parseRate(rate);
  const expFrom = currencyExponent(from);
  const expTo = currencyExponent(to);
  const num = amountMinor * scaled * 10n ** BigInt(expTo);
  const den = RATE_SCALE * 10n ** BigInt(expFrom);
  return divRound(num, den);
}
function crossRate(eurToFrom, eurToTo) {
  const a = parseRate(eurToFrom);
  const b = parseRate(eurToTo);
  const r = divRound(b * RATE_SCALE, a);
  const intPart = r / RATE_SCALE;
  const frac = (r % RATE_SCALE).toString().padStart(8, "0");
  return `${intPart}.${frac}`;
}
function convertWithQuote(amountMinor, from, to, quote) {
  if (from === to) {
    return { converted: true, amountMinor, currency: to, originalAmountMinor: amountMinor, originalCurrency: from };
  }
  if (!quote) {
    return { converted: false, amountMinor, currency: from, originalAmountMinor: amountMinor, originalCurrency: from };
  }
  return {
    converted: true,
    amountMinor: convertMinor(amountMinor, from, to, quote.rate),
    currency: to,
    originalAmountMinor: amountMinor,
    originalCurrency: from,
    rate: quote.rate,
    rateDate: quote.rateDate
  };
}

// ../../packages/domain/src/events.ts
var BROWSER_EVENTS = [
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Lead"
];
var VALUE_EVENTS = [
  "Purchase",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "AddPaymentInfo"
];
function normalizeEventKey(event) {
  return event.trim().toLowerCase().replace(/[-\s:]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
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
function mapEventName(raw) {
  if (!raw) return null;
  const key = normalizeEventKey(raw);
  return MAP[key] ?? MAP[raw.trim().toLowerCase()] ?? MAP[key.replace(/\./g, "_")] ?? null;
}

// ../../packages/domain/src/payment-status.ts
function statusToken(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  return String(raw).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s.:-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
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
function classifyGenericStatus(raw) {
  const t = statusToken(raw);
  return t ? GENERIC[t] : void 0;
}
var EXPLICIT_EVENTS = {
  paid: "approved",
  payment_paid: "approved",
  payment_approved: "approved",
  payment_completed: "approved",
  sale_approved: "approved",
  sale_paid: "approved",
  purchase_approved: "approved",
  purchase_paid: "approved",
  order_paid: "approved",
  order_completed: "approved",
  approved: "approved",
  completed: "approved",
  complete: "approved",
  captured: "approved",
  settled: "approved",
  pix_paid: "approved",
  refund: "refunded",
  refunded: "refunded",
  sale_refunded: "refunded",
  reembolso: "refunded",
  estornado: "refunded",
  chargeback: "chargeback",
  pix_generated: "pending",
  pix_created: "pending",
  pix_gerado: "pending",
  pending: "pending",
  sale_pending: "pending",
  waiting_payment: "pending",
  aguardando_pagamento: "pending",
  canceled: "canceled",
  cancelled: "canceled",
  expired: "canceled"
};
function classifyByEventName(raw) {
  return EXPLICIT_EVENTS[statusToken(raw)];
}
function resolveStatus(values) {
  const present = values.filter((v) => statusToken(v) !== "");
  if (present.length === 0) return "none";
  const classes = present.map(classifyGenericStatus).filter((s) => !!s);
  if (classes.length === 0) return "unknown";
  const order = ["refunded", "chargeback", "canceled", "failed", "pending", "approved"];
  for (const s of order) if (classes.includes(s)) return s;
  return "unknown";
}
var RANK = {
  pending: 0,
  failed: 1,
  canceled: 1,
  approved: 2,
  refunded: 3,
  chargeback: 3
};
function canTransition(from, to) {
  if (from === null) return true;
  if (from === to) return false;
  if ((from === "failed" || from === "canceled") && to === "approved") return true;
  if (from === "pending" && (to === "failed" || to === "canceled")) return true;
  if (from === "refunded" && to === "chargeback" || from === "chargeback" && to === "refunded") return false;
  return RANK[to] > RANK[from];
}
function isPurchaseTransition(from, to) {
  return to === "approved" && from !== "approved" && from !== "refunded" && from !== "chargeback";
}
function isReversal(to) {
  return to === "refunded" || to === "chargeback";
}

// ../../packages/domain/src/meta-normalize.ts
import { createHash as createHash2 } from "node:crypto";
var sha256 = (v) => createHash2("sha256").update(v, "utf8").digest("hex");
var isHash = (v) => /^[a-f0-9]{64}$/i.test(v);
var ACCENTS = {
  \u00E1: "a",
  \u00E0: "a",
  \u00E3: "a",
  \u00E2: "a",
  \u00E4: "a",
  \u00E9: "e",
  \u00E8: "e",
  \u00EA: "e",
  \u00EB: "e",
  \u00ED: "i",
  \u00EC: "i",
  \u00EE: "i",
  \u00EF: "i",
  \u00F3: "o",
  \u00F2: "o",
  \u00F5: "o",
  \u00F4: "o",
  \u00F6: "o",
  \u00FA: "u",
  \u00F9: "u",
  \u00FB: "u",
  \u00FC: "u",
  \u00E7: "c",
  \u00F1: "n"
};
var removeAccents = (s) => s.replace(/[áàãâäéèêëíìîïóòõôöúùûüçñ]/g, (c) => ACCENTS[c] ?? c);
var clean = (v) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
var hashed = (v) => v === "" ? null : isHash(v) ? v.toLowerCase() : sha256(v);
var normEmail = (v) => hashed(clean(v).toLowerCase());
var normPhone = (v) => hashed(clean(v).replace(/\D+/g, ""));
var normName = (v) => hashed(clean(v).toLowerCase());
var normCity = (v) => hashed(removeAccents(clean(v).toLowerCase()).replace(/[^a-z]/g, ""));
var normState = normCity;
var normZip = (v) => hashed(clean(v).replace(/\D+/g, ""));
var normCountry = (v) => hashed(clean(v).toLowerCase().replace(/[^a-z]/g, "").slice(0, 2));
function normGender(v) {
  const g = clean(v).toLowerCase().charAt(0);
  return g === "f" || g === "m" ? sha256(g) : null;
}
function normBirthdate(v) {
  const d = clean(v).replace(/\D+/g, "");
  return d.length >= 8 ? sha256(d.slice(0, 8)) : null;
}
var normDocument = (v) => hashed(clean(v).replace(/\D+/g, ""));
var normXid = (v) => hashed(clean(v).toLowerCase());
function validFbParam(v) {
  const s = clean(v);
  return /^fb\.\d\.\d+\..+$/.test(s) ? s : null;
}
function isPublicIp(ip) {
  const s = clean(ip);
  if (!s) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some((o) => Number(o) > 255)) return false;
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (s.includes(":")) {
    const l = s.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return false;
    return /^[0-9a-f:]+$/.test(l);
  }
  return false;
}
function isServerUserAgent(ua) {
  const s = clean(ua);
  return /^(Hotmart-Hooks|Kiwify|GuzzleHttp|curl|axios|node-fetch|python-requests|Go-http-client|Java\/|okhttp)/i.test(s);
}

// ../../packages/domain/src/capi.ts
function buildServerEvent(input) {
  const c = input.customer ?? {};
  const t = input.tracking ?? {};
  const user = {};
  const put2 = (k, v) => {
    if (v) user[k] = [v];
  };
  put2("em", normEmail(c.email));
  put2("ph", normPhone(c.phone));
  put2("fn", normName(c.firstName));
  put2("ln", normName(c.lastName));
  put2("ct", normCity(c.city));
  put2("st", normState(c.state));
  put2("zp", normZip(c.zip));
  put2("country", normCountry(c.country));
  put2("ge", normGender(c.gender));
  put2("db", normBirthdate(c.birthdate));
  const ext = [normDocument(c.document), normXid(c.externalId)].filter((v) => !!v);
  if (ext.length) user.external_id = [...new Set(ext)];
  const fbp = validFbParam(t.fbp);
  const fbc = validFbParam(t.fbc);
  if (fbp) user.fbp = fbp;
  if (fbc) user.fbc = fbc;
  if (isPublicIp(t.clientIp)) user.client_ip_address = String(t.clientIp).trim();
  const ua = (t.userAgent ?? "").trim();
  if (ua && !isServerUserAgent(ua)) user.client_user_agent = ua;
  const custom = {};
  if (VALUE_EVENTS.includes(input.eventName) && input.valueMinor != null && input.valueMinor >= 0n && input.currency) {
    custom.value = minorToNumber(input.valueMinor, input.currency);
    custom.currency = input.currency;
  }
  const products = (input.products ?? []).filter((p) => (p.id ?? p.name ?? "") !== "");
  if (products.length) {
    custom.content_ids = products.map((p) => String(p.id ?? p.name));
    custom.contents = products.map((p) => ({
      id: String(p.id ?? p.name),
      quantity: p.quantity ?? 1,
      ...p.priceMinor != null && input.currency ? { item_price: minorToNumber(p.priceMinor, input.currency) } : {}
    }));
    custom.content_type = "product";
    custom.num_items = products.reduce((n, p) => n + Math.max(1, p.quantity ?? 1), 0);
    const names = [...new Set(products.map((p) => p.name).filter((n) => !!n))];
    if (names.length) custom.content_name = names.join(", ");
  }
  if (input.contentName && !custom.content_name) custom.content_name = input.contentName;
  if (input.orderId) custom.order_id = input.orderId;
  for (const [k, v] of Object.entries(input.utms ?? {})) if (v) custom[k] = String(v);
  const event = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime),
    event_id: input.eventId,
    action_source: input.actionSource ?? "website",
    user_data: user,
    custom_data: custom
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
  return event;
}
var MATCH_KEYS = [
  "em",
  "ph",
  "fn",
  "ln",
  "ct",
  "st",
  "zp",
  "country",
  "ge",
  "db",
  "external_id",
  "fbp",
  "fbc",
  "client_ip_address",
  "client_user_agent"
];
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
function tzOffsetMs(date, tz) {
  const p = partsInTz(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1e3) * 1e3;
}
function localMidnightUtc(ymd, tz) {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  let ts = guess.getTime() - tzOffsetMs(guess, tz);
  ts = guess.getTime() - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}
function localDate(date, tz) {
  const p = partsInTz(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
}
function reportWindow(preset, tz, opts = {}) {
  const today = localDate(opts.now ?? /* @__PURE__ */ new Date(), tz);
  let since = today;
  let until = today;
  switch (preset) {
    case "yesterday":
      since = until = addDays(today, -1);
      break;
    case "last_7d":
      since = addDays(today, -6);
      break;
    case "last_30d":
      since = addDays(today, -29);
      break;
    case "last_90d":
      since = addDays(today, -89);
      break;
    case "this_month":
      since = today.slice(0, 8) + "01";
      break;
    case "custom": {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!opts.since || !opts.until || !re.test(opts.since) || !re.test(opts.until)) throw new Error("Per\xEDodo personalizado inv\xE1lido");
      since = opts.since;
      until = opts.until;
      if (diffDays(since, until) < 0) throw new Error("Data inicial maior que a final");
      if (diffDays(since, until) > 366) throw new Error("Per\xEDodo m\xE1ximo de 366 dias");
      break;
    }
  }
  return {
    preset,
    timezone: tz,
    since,
    until,
    startUtc: localMidnightUtc(since, tz),
    endUtc: localMidnightUtc(addDays(until, 1), tz),
    days: diffDays(since, until) + 1
  };
}
function previousWindow(w) {
  const until = addDays(w.since, -1);
  const since = addDays(until, -(w.days - 1));
  return { ...w, preset: "custom", since, until, startUtc: localMidnightUtc(since, w.timezone), endUtc: w.startUtc };
}
function eachDay(since, until) {
  const out = [];
  for (let d = since; diffDays(d, until) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

// ../../packages/domain/src/utm.ts
var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];
function parseTrackingCode(raw) {
  if (typeof raw !== "string") return {};
  const s = raw.trim();
  if (!s) return {};
  const out = {};
  if (s.includes("=")) {
    for (const part of s.split(/[&|;]/)) {
      const i = part.indexOf("=");
      if (i <= 0) continue;
      const k = safeDecode(part.slice(0, i)).trim();
      const v = safeDecode(part.slice(i + 1)).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }
  const parts = s.split(/[|;]/).map((p) => p.trim()).filter(Boolean);
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  parts.forEach((v, i) => {
    const k = keys[i];
    if (k) out[k] = v;
  });
  return out;
}
function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}
function matchUtmToRow(utmValues, rows) {
  const fields = utmValues.map((v) => (v ?? "").trim().toLowerCase()).filter((v) => v !== "" && v !== "null");
  if (!fields.length) return -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.name.trim().toLowerCase();
    const id = row.id.trim();
    for (const v of fields) {
      if (name !== "" && v === name || id !== "" && v.includes(id)) return i;
    }
  }
  return -1;
}

// src/orgs/routes.ts
var TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));
async function audit(ctx2, orgId, userId, action, target, metadata = {}) {
  await ctx2.db.query("INSERT INTO audit_log(org_id, user_id, action, target, metadata) VALUES ($1, $2, $3, $4, $5)", [
    orgId,
    userId,
    action,
    target ?? null,
    JSON.stringify(metadata)
  ]);
}
function orgRoutes(app2, ctx2) {
  app2.patch("/v1/org", async (req) => {
    const a = requireRole(req, "admin");
    const body = parse(z3.object({
      name: z3.string().trim().min(1).max(120).optional(),
      reportingCurrency: z3.string().regex(/^[A-Z]{3}$/).optional(),
      timezone: z3.string().refine((t) => TIMEZONES.has(t), "Fuso hor\xE1rio inv\xE1lido").optional(),
      goalDaily: z3.string().max(30).optional(),
      goalMonthly: z3.string().max(30).optional()
    }), req.body);
    const cur = body.reportingCurrency ?? a.org.reporting_currency;
    const goal = (v) => v === void 0 ? null : parseAmount(v === "" ? "0" : v, cur, "major") ?? null;
    const gd = goal(body.goalDaily);
    const gm = goal(body.goalMonthly);
    if (body.goalDaily !== void 0 && gd === null || body.goalMonthly !== void 0 && gm === null) throw badRequest("Meta inv\xE1lida.");
    await ctx2.db.query(
      `UPDATE organizations SET name = COALESCE($2, name), reporting_currency = COALESCE($3, reporting_currency),
              timezone = COALESCE($4, timezone), goal_daily_minor = COALESCE($5, goal_daily_minor),
              goal_monthly_minor = COALESCE($6, goal_monthly_minor), updated_at = now() WHERE id = $1`,
      [a.org.id, body.name ?? null, body.reportingCurrency ?? null, body.timezone ?? null, gd, gm]
    );
    await audit(ctx2, a.org.id, a.user.id, "org.updated", a.org.id, { fields: Object.keys(body) });
    return { ok: true };
  });
  app2.get("/v1/org/members", async (req) => {
    const a = requireRole(req, "viewer");
    const members = await ctx2.db.query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 ORDER BY m.created_at`,
      [a.org.id]
    );
    const invites = ROLE_OK(a.role) ? await ctx2.db.query(
      `SELECT id, email, role, expires_at, created_at FROM invitations
        WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [a.org.id]
    ) : { rows: [] };
    return { members: members.rows, invitations: invites.rows };
  });
  app2.post("/v1/org/invitations", async (req) => {
    const a = requireRole(req, "owner");
    await hit(ctx2.db, `invite:org:${a.org.id}`, 30, 3600);
    const body = parse(z3.object({ email: z3.string().trim().toLowerCase().email(), role: z3.enum(["admin", "analyst", "viewer"]) }), req.body);
    const token = randomToken(32);
    await ctx2.db.query(
      `INSERT INTO invitations(org_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')`,
      [a.org.id, body.email, body.role, sha256Hex(token), a.user.id]
    );
    await ctx2.mailer.send({
      to: body.email,
      subject: `Convite para ${a.org.name} \u2014 PayTracking`,
      text: `Voc\xEA foi convidado(a) para a organiza\xE7\xE3o "${a.org.name}".
Aceite em: ${ctx2.config.APP_URL}/convite?token=${token}

O convite expira em 7 dias.`
    });
    await audit(ctx2, a.org.id, a.user.id, "member.invited", body.email, { role: body.role });
    return { ok: true };
  });
  app2.delete("/v1/org/invitations/:id", async (req) => {
    const a = requireRole(req, "owner");
    const { id } = parse(z3.object({ id: z3.string().uuid() }), req.params);
    await ctx2.db.query("DELETE FROM invitations WHERE id = $1 AND org_id = $2", [id, a.org.id]);
    return { ok: true };
  });
  app2.post("/v1/invitations/accept", async (req) => {
    const a = auth(req);
    const { token } = parse(z3.object({ token: z3.string().min(20) }), req.body);
    return tx(ctx2.db, async (c) => {
      const r = await c.query(
        `SELECT id, org_id, email, role FROM invitations
          WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256Hex(token)]
      );
      const inv = r.rows[0];
      if (!inv) throw badRequest("Convite inv\xE1lido ou expirado.");
      if (String(inv.email).toLowerCase() !== a.user.email.toLowerCase()) throw forbidden("Este convite foi enviado para outro e-mail.");
      await c.query(
        `INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO NOTHING`,
        [inv.org_id, a.user.id, inv.role]
      );
      await c.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [inv.id]);
      await c.query("UPDATE sessions SET active_org_id = $1 WHERE id = $2", [inv.org_id, a.sessionId]);
      return { ok: true, orgId: inv.org_id };
    });
  });
  app2.patch("/v1/org/members/:userId", async (req) => {
    const a = requireRole(req, "owner");
    const { userId } = parse(z3.object({ userId: z3.string().uuid() }), req.params);
    const { role } = parse(z3.object({ role: z3.enum(["owner", "admin", "analyst", "viewer"]) }), req.body);
    if (userId === a.user.id) throw badRequest("Voc\xEA n\xE3o pode alterar o pr\xF3prio papel.");
    const r = await ctx2.db.query("UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2", [a.org.id, userId, role]);
    if (!r.rowCount) throw notFound("Membro n\xE3o encontrado.");
    await audit(ctx2, a.org.id, a.user.id, "member.role_changed", userId, { role });
    return { ok: true };
  });
  app2.delete("/v1/org/members/:userId", async (req) => {
    const a = requireRole(req, "owner");
    const { userId } = parse(z3.object({ userId: z3.string().uuid() }), req.params);
    if (userId === a.user.id) throw badRequest("Voc\xEA n\xE3o pode remover a si mesmo.");
    const owners = await ctx2.db.query(`SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner' AND user_id <> $2`, [a.org.id, userId]);
    if ((owners.rows[0]?.n ?? 0) < 1) throw conflict("A organiza\xE7\xE3o precisa de pelo menos um propriet\xE1rio.");
    await ctx2.db.query("DELETE FROM memberships WHERE org_id = $1 AND user_id = $2", [a.org.id, userId]);
    await ctx2.db.query("UPDATE sessions SET active_org_id = NULL WHERE user_id = $1 AND active_org_id = $2", [userId, a.org.id]);
    await audit(ctx2, a.org.id, a.user.id, "member.removed", userId);
    return { ok: true };
  });
  app2.get("/v1/org/audit", async (req) => {
    const a = requireRole(req, "admin");
    const r = await ctx2.db.query(
      `SELECT l.action, l.target, l.metadata, l.created_at, u.email AS user_email
         FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.org_id = $1 ORDER BY l.id DESC LIMIT 200`,
      [a.org.id]
    );
    return { entries: r.rows };
  });
}
var ROLE_OK = (r) => r === "owner" || r === "admin";

// src/pixels/routes.ts
import { z as z4 } from "zod";
var pixelInput = z4.object({
  name: z4.string().trim().min(1).max(120),
  metaPixelId: z4.string().trim().regex(/^\d{6,32}$/, "Pixel ID inv\xE1lido (apenas d\xEDgitos)"),
  capiToken: z4.string().trim().min(20).max(1e3).optional(),
  testEventCode: z4.string().trim().max(64).optional().nullable(),
  currency: z4.string().regex(/^[A-Z]{3}$/).default("BRL"),
  country: z4.string().regex(/^[A-Z]{2}$/).default("BR"),
  productIds: z4.array(z4.string().trim().min(1).max(120)).max(500).default([]),
  icRuleType: z4.enum(["none", "contains", "equals", "starts_with"]).default("none"),
  icRuleValue: z4.string().trim().max(500).optional().nullable(),
  sendRefundEvent: z4.boolean().default(true),
  allowedOrigins: z4.array(z4.string().url()).max(50).default([])
});
function normalizeProductIds(list) {
  const out = /* @__PURE__ */ new Set();
  for (const raw of list) for (const p of raw.split(/[\s,;]+/)) if (p.trim()) out.add(p.trim());
  return [...out];
}
function pixelDto(p, ctx2) {
  const api = ctx2.config.PUBLIC_API_URL;
  return {
    id: p.id,
    name: p.name,
    metaPixelId: p.meta_pixel_id,
    capiTokenConfigured: !!p.capi_token_enc,
    testEventCode: p.test_event_code,
    currency: p.currency.trim(),
    country: p.country.trim(),
    publicKey: p.public_key,
    active: p.active,
    icRuleType: p.ic_rule_type,
    icRuleValue: p.ic_rule_value,
    sendRefundEvent: p.send_refund_event,
    allowedOrigins: p.allowed_origins,
    productIds: p.product_ids ?? [],
    createdAt: p.created_at,
    snippets: snippets(api, p)
  };
}
function snippets(api, p) {
  const attrs = (extra) => {
    const all = {
      "data-key": p.public_key,
      "data-pixel-id": p.meta_pixel_id,
      "data-endpoint": `${api}/v1/collect`,
      "data-currency": p.currency.trim(),
      "data-country": p.country.trim(),
      ...extra
    };
    return Object.entries(all).map(([k, v]) => `s.setAttribute(${JSON.stringify(k)},${JSON.stringify(v)});`).join("");
  };
  const wrap = (a) => `<script>!function(){var s=document.createElement("script");s.async=true;s.src=${JSON.stringify(`${api}/pixel.js`)};${a}document.head.appendChild(s)}();</script>`;
  const click = { "data-ic-click": "1" };
  if (p.ic_rule_type !== "none" && p.ic_rule_value) {
    click["data-ic-rule"] = p.ic_rule_type;
    click["data-ic-value"] = p.ic_rule_value;
  }
  return {
    salesPage: wrap(attrs({})),
    salesPageWithClickIc: wrap(attrs(click)),
    checkoutPage: wrap(attrs({ "data-ic-onload": "1" })),
    globalCheckoutLoader: `<script src=${JSON.stringify(`${api}/checkout-loader.js`)} data-key=${JSON.stringify(p.public_key)} defer></script>`
  };
}
async function loadPixel(ctx2, orgId, id) {
  const r = await ctx2.db.query(
    `SELECT p.*, COALESCE((SELECT array_agg(product_id ORDER BY product_id) FROM pixel_products pp WHERE pp.pixel_id = p.id), '{}') AS product_ids
       FROM pixels p WHERE p.id = $1 AND p.org_id = $2`,
    [id, orgId]
  );
  if (!r.rows[0]) throw notFound("Pixel n\xE3o encontrado.");
  return r.rows[0];
}
async function setProducts(c, orgId, pixelId, ids) {
  if (ids.length) {
    const clash = await c.query(
      `SELECT pp.product_id, p.name FROM pixel_products pp JOIN pixels p ON p.id = pp.pixel_id
        WHERE pp.org_id = $1 AND pp.pixel_id <> $2 AND pp.product_id = ANY($3)`,
      [orgId, pixelId, ids]
    );
    if (clash.rowCount) {
      const list = clash.rows.map((r) => `${r.product_id} (pixel "${r.name}")`).join(", ");
      throw conflict(`Produto j\xE1 vinculado a outro pixel: ${list}. Remova de l\xE1 antes.`);
    }
  }
  await c.query("DELETE FROM pixel_products WHERE pixel_id = $1 AND NOT (product_id = ANY($2))", [pixelId, ids]);
  for (const pid of ids) {
    await c.query(
      "INSERT INTO pixel_products(org_id, pixel_id, product_id) VALUES ($1, $2, $3) ON CONFLICT (org_id, product_id) DO NOTHING",
      [orgId, pixelId, pid]
    );
  }
}
function pixelRoutes(app2, ctx2) {
  app2.get("/v1/pixels", async (req) => {
    const a = requireRole(req, "viewer");
    const r = await ctx2.db.query(
      `SELECT p.*, COALESCE((SELECT array_agg(product_id ORDER BY product_id) FROM pixel_products pp WHERE pp.pixel_id = p.id), '{}') AS product_ids
         FROM pixels p WHERE p.org_id = $1 ORDER BY p.created_at DESC`,
      [a.org.id]
    );
    return { pixels: r.rows.map((p) => pixelDto(p, ctx2)) };
  });
  app2.post("/v1/pixels", async (req, reply) => {
    const a = requireRole(req, "admin");
    const b = parse(pixelInput, req.body);
    if (!b.capiToken) throw badRequest("Informe o token de acesso da Conversions API.");
    if (b.icRuleType !== "none" && !b.icRuleValue) throw badRequest("Informe a URL/trecho do checkout para a regra de InitiateCheckout.");
    const ids = normalizeProductIds(b.productIds);
    const id = await tx(ctx2.db, async (c) => {
      const r = await c.query(
        `INSERT INTO pixels(org_id, name, meta_pixel_id, capi_token_enc, test_event_code, currency, country, public_key,
                            ic_rule_type, ic_rule_value, send_refund_event, allowed_origins)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          a.org.id,
          b.name,
          b.metaPixelId,
          ctx2.box.encrypt(b.capiToken),
          b.testEventCode || null,
          b.currency,
          b.country,
          publicKey(),
          b.icRuleType,
          b.icRuleType === "none" ? null : b.icRuleValue,
          b.sendRefundEvent,
          b.allowedOrigins
        ]
      );
      const pid = r.rows[0].id;
      await setProducts(c, a.org.id, pid, ids);
      return pid;
    });
    await audit(ctx2, a.org.id, a.user.id, "pixel.created", id);
    return reply.code(201).send({ pixel: pixelDto(await loadPixel(ctx2, a.org.id, id), ctx2) });
  });
  app2.put("/v1/pixels/:id", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z4.object({ id: z4.string().uuid() }), req.params);
    const b = parse(pixelInput, req.body);
    await loadPixel(ctx2, a.org.id, id);
    if (b.icRuleType !== "none" && !b.icRuleValue) throw badRequest("Informe a URL/trecho do checkout para a regra de InitiateCheckout.");
    await tx(ctx2.db, async (c) => {
      await c.query(
        `UPDATE pixels SET name=$3, meta_pixel_id=$4, capi_token_enc=COALESCE($5, capi_token_enc), test_event_code=$6,
                currency=$7, country=$8, ic_rule_type=$9, ic_rule_value=$10, send_refund_event=$11, allowed_origins=$12, updated_at=now()
          WHERE id=$1 AND org_id=$2`,
        [
          id,
          a.org.id,
          b.name,
          b.metaPixelId,
          b.capiToken ? ctx2.box.encrypt(b.capiToken) : null,
          b.testEventCode || null,
          b.currency,
          b.country,
          b.icRuleType,
          b.icRuleType === "none" ? null : b.icRuleValue,
          b.sendRefundEvent,
          b.allowedOrigins
        ]
      );
      await setProducts(c, a.org.id, id, normalizeProductIds(b.productIds));
    });
    await audit(ctx2, a.org.id, a.user.id, "pixel.updated", id, { capiTokenChanged: !!b.capiToken });
    return { pixel: pixelDto(await loadPixel(ctx2, a.org.id, id), ctx2) };
  });
  app2.post("/v1/pixels/:id/toggle", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z4.object({ id: z4.string().uuid() }), req.params);
    const r = await ctx2.db.query("UPDATE pixels SET active = NOT active, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING active", [id, a.org.id]);
    if (!r.rowCount) throw notFound("Pixel n\xE3o encontrado.");
    await audit(ctx2, a.org.id, a.user.id, "pixel.toggled", id, { active: r.rows[0].active });
    return { active: r.rows[0].active };
  });
  app2.post("/v1/pixels/bulk-active", async (req) => {
    const a = requireRole(req, "admin");
    const { active } = parse(z4.object({ active: z4.boolean() }), req.body);
    const r = await ctx2.db.query("UPDATE pixels SET active = $2, updated_at = now() WHERE org_id = $1 AND active <> $2", [a.org.id, active]);
    await audit(ctx2, a.org.id, a.user.id, active ? "pixel.activate_all" : "pixel.deactivate_all");
    return { changed: r.rowCount };
  });
  app2.post("/v1/pixels/:id/rotate-key", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z4.object({ id: z4.string().uuid() }), req.params);
    const r = await ctx2.db.query("UPDATE pixels SET public_key = $3, updated_at = now() WHERE id = $1 AND org_id = $2", [id, a.org.id, publicKey()]);
    if (!r.rowCount) throw notFound("Pixel n\xE3o encontrado.");
    await audit(ctx2, a.org.id, a.user.id, "pixel.key_rotated", id);
    return { pixel: pixelDto(await loadPixel(ctx2, a.org.id, id), ctx2) };
  });
  app2.delete("/v1/pixels/:id", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z4.object({ id: z4.string().uuid() }), req.params);
    const r = await ctx2.db.query("DELETE FROM pixels WHERE id = $1 AND org_id = $2", [id, a.org.id]);
    if (!r.rowCount) throw notFound("Pixel n\xE3o encontrado.");
    await audit(ctx2, a.org.id, a.user.id, "pixel.deleted", id);
    return { ok: true };
  });
  app2.post("/v1/pixels/:id/verify", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z4.object({ id: z4.string().uuid() }), req.params);
    const p = await loadPixel(ctx2, a.org.id, id);
    if (!p.capi_token_enc) return { ok: false, message: "Token da CAPI n\xE3o configurado." };
    const url = `${ctx2.config.META_GRAPH_BASE_URL}/${ctx2.config.META_GRAPH_VERSION}/${p.meta_pixel_id}?fields=id,name`;
    try {
      const res = await ctx2.fetch(url, { headers: { Authorization: `Bearer ${ctx2.box.decrypt(p.capi_token_enc)}` }, signal: AbortSignal.timeout(1e4) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.id) return { ok: true, message: `Conectado ao pixel "${body.name ?? body.id}".` };
      return { ok: false, message: body?.error?.message ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: `Falha de rede: ${e.message}` };
    }
  });
}

// src/integrations/routes.ts
import { z as z5 } from "zod";

// ../../packages/gateways/src/util.ts
import { createHmac, timingSafeEqual } from "node:crypto";
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var obj = (v) => isObj(v) ? v : {};
function pick(o, keys) {
  for (const k of keys) {
    const v = k.includes(".") ? k.split(".").reduce((acc, part) => obj(acc)[part], o) : o[k];
    if (typeof v === "string" && v.trim() !== "" || typeof v === "number") return String(v).trim();
  }
  return null;
}
function pickRaw(o, keys) {
  for (const k of keys) {
    const v = o[k];
    if (v !== void 0 && v !== null && v !== "") return v;
  }
  return null;
}
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
var hmacHex = (algo, body, secret) => createHmac(algo, secret).update(body, "utf8").digest("hex");
function currencyOr(raw, fallback) {
  return normalizeCurrency(raw) ?? fallback;
}
function amount(raw, currency, unit) {
  const v = parseAmount(raw, currency, unit);
  return v !== null && v >= 0n ? v : null;
}
function splitName(full) {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}
function customerFrom(c, extra = {}) {
  const addr = obj(c.address);
  const name = pick(c, ["full_name", "name", "nome"]);
  const split = splitName(name);
  let phone = c.mobile ?? c.phone ?? c.phone_number ?? c.telephone ?? c.checkout_phone ?? c.celular;
  if (isObj(phone)) phone = `${phone.area_code ?? ""}${phone.number ?? ""}`;
  return {
    email: pick(c, ["email"])?.toLowerCase() ?? null,
    phone: typeof phone === "string" || typeof phone === "number" ? String(phone) : null,
    firstName: pick(c, ["first_name"]) ?? split.firstName,
    lastName: pick(c, ["last_name"]) ?? split.lastName,
    document: pick(c, ["CPF", "cpf", "document", "doc", "tax_id", "cnpj"]) ?? pick(obj(c.documents), ["document"]),
    city: pick(c, ["city", "cidade"]) ?? pick(addr, ["city", "cidade"]),
    state: pick(c, ["state", "estado", "uf"]) ?? pick(addr, ["state", "estado", "uf"]),
    zip: pick(c, ["zipcode", "zip", "zip_code", "cep"]) ?? pick(addr, ["zipcode", "zip_code", "zip", "cep"]),
    country: pick(c, ["country_iso", "country"]) ?? pick(addr, ["country_iso", "country"]),
    ...extra
  };
}
var TRACK_KEYS = {
  utm_source: "utm_source",
  src: "utm_source",
  source: "utm_source",
  utm_medium: "utm_medium",
  medium: "utm_medium",
  utm_campaign: "utm_campaign",
  campaign: "utm_campaign",
  utm_content: "utm_content",
  content: "utm_content",
  utm_term: "utm_term",
  term: "utm_term",
  utm_id: "utm_id",
  campaign_id: "utm_id",
  fbp: "fbp",
  _fbp: "fbp",
  fbc: "fbc",
  _fbc: "fbc",
  fbclid: "fbclid",
  click_id: "fbclid",
  external_id: "externalId",
  pt_xid: "externalId",
  purchase_event_id: "purchaseEventId",
  purchaseEventId: "purchaseEventId",
  meta_purchase_event_id: "purchaseEventId",
  client_ip_address: "clientIp",
  client_ip: "clientIp",
  user_ip: "clientIp",
  client_user_agent: "userAgent",
  user_agent: "userAgent",
  event_source_url: "eventSourceUrl",
  page_url: "eventSourceUrl"
};
function trackingFrom(...sources) {
  const out = {};
  for (const s of sources) {
    const o = typeof s === "string" ? parseTrackingCode(s) : obj(s);
    for (const [k, v] of Object.entries(o)) {
      const key = TRACK_KEYS[k];
      if (!key || out[key]) continue;
      if (typeof v === "string" && v.trim() || typeof v === "number") out[key] = String(v).trim();
    }
  }
  return out;
}
function product(p, currency, unit, fallbackPrice = null) {
  const id = pick(p, ["product_id", "id", "sku", "offer_id", "ucode"]);
  const name = pick(p, ["product_name", "name", "title", "description"]);
  const qty = Number(p.quantity ?? 1);
  const price = amount(pickRaw(p, ["price", "amount", "value"]), currency, unit);
  return { id, name, quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1, priceMinor: price ?? fallbackPrice };
}
function toDate(v) {
  if (typeof v === "number" || typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    if (!n) return null;
    return new Date(n > 1e12 ? n : n * 1e3);
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ../../packages/gateways/src/adapters/cakto.ts
var EVENTS = {
  purchase_approved: "approved",
  purchase_completed: "approved",
  purchase_refused: "failed",
  refund: "refunded",
  refunded: "refunded",
  chargeback: "chargeback",
  pix_gerado: "pending",
  boleto_gerado: "pending",
  picpay_gerado: "pending",
  purchase_pending: "pending",
  checkout_abandonment: "ignore"
};
var cakto = {
  provider: "cakto",
  label: "Cakto",
  authMethod: 'campo "secret" no corpo JSON',
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: "payload_secret", reason: "secret_not_configured" };
    const provided = pick(req.payload, ["secret", "data.secret"]);
    if (!provided) return { ok: false, method: "payload_secret", reason: "missing_secret_field" };
    return { ok: safeEqual(secret, provided), method: "payload_secret", reason: "secret_mismatch" };
  },
  isTestPing: (req) => statusToken(req.payload.event) === "test",
  normalize(p, opts) {
    const data = Object.keys(obj(p.data)).length ? obj(p.data) : p;
    const gatewayEvent = String(p.event ?? data.status ?? "");
    const mapped = EVENTS[statusToken(p.event)];
    if (mapped === "ignore") return { kind: "ignored", provider: "cakto", reason: "not_a_payment_event", gatewayEvent };
    const status = mapped ?? classifyGenericStatus(data.status);
    const transactionId = pick(data, ["id", "transaction_id", "transactionId", "order_id", "refId"]);
    if (!transactionId) return { kind: "ignored", provider: "cakto", reason: "missing_transaction_id", gatewayEvent };
    if (!status) return { kind: "ignored", provider: "cakto", reason: "unknown_status", gatewayEvent, transactionId };
    const currency = currencyOr(data.currency, opts.defaultCurrency);
    const value = amount(pickRaw(data, ["amount", "value", "total", "baseAmount"]), currency, "major");
    const prod = obj(data.product);
    return {
      kind: "payment",
      provider: "cakto",
      sourceEventId: null,
      transactionId,
      status,
      gatewayEvent,
      amountMinor: value,
      currency,
      occurredAt: toDate(data.paidAt ?? data.paid_at ?? data.createdAt),
      customer: customerFrom(obj(data.customer)),
      products: Object.keys(prod).length ? [product(prod, currency, "major", value)] : [],
      tracking: trackingFrom(obj(data.utm), obj(data.tracking), data, typeof data.sck === "string" ? data.sck : null)
    };
  }
};

// ../../packages/gateways/src/adapters/checkout.ts
import { createHmac as createHmac2 } from "node:crypto";
var STATUS_KEYS = ["status", "payment_status", "paymentStatus", "transaction_status", "situacao", "state", "order_status", "purchase_status", "paymentState"];
var STATUS_OBJECTS = ["payment", "transaction", "order", "charge", "sale", "pix"];
var SERVER_EVENTS = ["Lead", "ViewContent", "AddToCart", "AddPaymentInfo", "PageView"];
var EVENT_ID_KEYS = {
  InitiateCheckout: ["initiate_checkout_event_id", "initiateCheckoutEventId", "ic_event_id"],
  Purchase: ["purchase_event_id", "purchaseEventId", "meta_purchase_event_id"],
  AddPaymentInfo: ["add_payment_info_event_id", "addPaymentInfoEventId"],
  Lead: ["lead_event_id", "leadEventId"]
};
function mergeAliases(body) {
  let b = body;
  if (isObj(b.data)) b = { ...b.data, ...b };
  if (isObj(b.payload)) b = { ...b.payload, ...b };
  return b;
}
function collectStatuses(b) {
  const out = [];
  for (const k of STATUS_KEYS) if (typeof b[k] === "string" || typeof b[k] === "number") out.push(b[k]);
  for (const o of STATUS_OBJECTS) {
    const nested = obj(b[o]);
    for (const k of STATUS_KEYS) if (typeof nested[k] === "string") out.push(nested[k]);
  }
  return out;
}
function checkoutEventId(b, eventName) {
  const tracking = obj(b.tracking);
  for (const k of [...EVENT_ID_KEYS[eventName] ?? [], "event_id", "meta_event_id"]) {
    const v = pick(tracking, [k]) ?? pick(b, [k]);
    if (v && v.length <= 128) return v;
  }
  return null;
}
function extractProductIds(body) {
  const b = mergeAliases(body);
  const vals = [];
  for (const k of ["product_id", "produto_id", "productId", "produtoId", "offer_id", "offerId"]) vals.push(b[k]);
  const p = obj(b.product);
  vals.push(p.id, p.product_id, p.produto_id);
  if (Array.isArray(b.products)) for (const x of b.products) {
    const o = obj(x);
    vals.push(o.id, o.product_id, o.produto_id);
  }
  const tracking = obj(b.tracking);
  for (const k of ["event_id", "meta_event_id", "initiate_checkout_event_id", "purchase_event_id"]) {
    for (const src of [b[k], tracking[k]]) {
      const m = typeof src === "string" ? /^(?:pageview|initiate_checkout|add_payment_info|purchase)_(.+?)_\d{9,}_/i.exec(src) : null;
      if (m?.[1]) vals.push(m[1]);
    }
  }
  const ids = /* @__PURE__ */ new Set();
  for (const v of vals) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    let id = String(v).trim().replace(/\s+/g, "");
    if (/^\d+\.0+$/.test(id)) id = id.split(".")[0];
    if (id) ids.add(id);
  }
  return [...ids];
}
function signCheckoutBody(rawBody, secret, timestamp) {
  const base = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  return "sha256=" + createHmac2("sha256", secret).update(base, "utf8").digest("hex");
}
var checkout = {
  provider: "checkout",
  label: "Checkout pr\xF3prio",
  authMethod: "Bearer token + HMAC-SHA256 (X-Paytrack-Signature)",
  requiresSecret: false,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: true, method: "bearer_token_only" };
    const sig = (req.headers["x-paytrack-signature"] ?? req.headers["x-signature"] ?? req.headers["x-hub-signature-256"] ?? "").trim();
    if (!sig) return { ok: false, method: "hmac_sha256", reason: "missing_signature" };
    const ts = req.headers["x-paytrack-timestamp"]?.trim();
    if (ts) {
      const skew = Math.abs(Date.now() / 1e3 - Number(ts));
      if (!Number.isFinite(skew) || skew > 300) return { ok: false, method: "hmac_sha256_ts", reason: "timestamp_out_of_window" };
    }
    const expected = signCheckoutBody(req.rawBody, secret, ts);
    const provided = sig.toLowerCase().startsWith("sha256=") ? sig.toLowerCase() : "sha256=" + sig.toLowerCase();
    return { ok: safeEqual(expected, provided), method: ts ? "hmac_sha256_ts" : "hmac_sha256", reason: "signature_mismatch" };
  },
  isTestPing: () => false,
  normalize(body, opts) {
    const b = mergeAliases(body);
    const webhookEvent = String(b.event ?? b.event_name ?? b.status ?? "");
    const metaEvent = mapEventName(webhookEvent);
    const transactionId = pick(b, ["transaction_id", "transactionId", "order_id", "orderId", "payment_id", "paymentId", "charge_id", "chargeId", "txid", "id"]);
    const currency = currencyOr(b.currency, opts.defaultCurrency);
    const value = amount(pickRaw(b, ["value", "amount", "total", "valor", "product_price", "valor_total"]), currency, "major");
    const payer = obj(b.payer);
    const customerObj = { ...payer, ...obj(b.customer) };
    for (const k of ["email", "customer_email", "payer_email"]) if (!customerObj.email && b[k]) customerObj.email = b[k];
    for (const k of ["phone", "telephone", "telefone", "customer_phone"]) if (!customerObj.phone && b[k]) customerObj.phone = b[k];
    for (const k of ["name", "nome"]) if (!customerObj.name && b[k]) customerObj.name = b[k];
    for (const k of ["first_name", "last_name", "document", "cpf", "city", "cidade", "state", "estado", "zip", "cep", "country"]) {
      if (!customerObj[k] && b[k]) customerObj[k] = b[k];
    }
    const identification = obj(payer.identification);
    const customer = customerFrom(customerObj, {
      externalId: pick(obj(b.tracking), ["external_id", "pt_xid"]) ?? pick(b, ["external_id", "pt_xid"]) ?? pick(customerObj, ["external_id"]),
      ...identification.number ? { document: String(identification.number) } : {},
      gender: pick(customerObj, ["gender"]),
      birthdate: pick(customerObj, ["birthdate"])
    });
    let products = Array.isArray(b.products) ? b.products.map((x) => product(obj(x), currency, "major")) : [];
    const prod = obj(b.product);
    if (!products.length && (Object.keys(prod).length || b.product_id || b.produto_id || b.product_sku)) {
      products = [{
        id: pick(prod, ["id"]) ?? pick(b, ["product_id", "produto_id", "product_sku"]),
        name: pick(prod, ["name", "title"]) ?? pick(b, ["product_name", "produto_nome", "content_name"]),
        quantity: Number(prod.quantity ?? b.product_quantity ?? 1) || 1,
        priceMinor: amount(prod.price ?? b.product_price, currency, "major") ?? value
      }];
    }
    const tracking = trackingFrom(obj(b.tracking), obj(b.tracking_parameters), obj(b.utm), b, payer);
    const eventSourceUrl = pick(b, ["event_source_url", "page_url", "url"]) ?? pick(obj(b.tracking), ["event_source_url", "page_url", "url"]);
    if (eventSourceUrl) tracking.eventSourceUrl = eventSourceUrl;
    if (!metaEvent) return { kind: "ignored", provider: "checkout", reason: "unmapped_event", gatewayEvent: webhookEvent };
    if (SERVER_EVENTS.includes(metaEvent)) {
      return {
        kind: "event",
        provider: "checkout",
        eventName: metaEvent,
        eventId: checkoutEventId(b, metaEvent),
        transactionId,
        amountMinor: value,
        currency,
        customer,
        products,
        tracking
      };
    }
    let status;
    const resolved = resolveStatus(collectStatuses(b));
    if (resolved === "unknown") return { kind: "ignored", provider: "checkout", reason: "unknown_status", gatewayEvent: webhookEvent };
    if (resolved !== "none") status = resolved;
    else if (metaEvent === "Refund") status = "refunded";
    else if (metaEvent === "InitiateCheckout") status = "pending";
    else status = classifyByEventName(webhookEvent);
    if (!status) {
      return { kind: "ignored", provider: "checkout", reason: "purchase_without_payment_confirmation", gatewayEvent: webhookEvent };
    }
    if (!transactionId || transactionId.length > 128) {
      return { kind: "ignored", provider: "checkout", reason: "missing_transaction_id", gatewayEvent: webhookEvent };
    }
    if (status === "approved" && (value === null || value <= 0n)) {
      return { kind: "ignored", provider: "checkout", reason: "purchase_without_positive_value", gatewayEvent: webhookEvent, transactionId };
    }
    const purchaseEventId2 = checkoutEventId(b, "Purchase");
    if (purchaseEventId2) tracking.purchaseEventId = purchaseEventId2;
    return {
      kind: "payment",
      provider: "checkout",
      sourceEventId: null,
      transactionId,
      status,
      gatewayEvent: webhookEvent,
      amountMinor: value,
      currency,
      occurredAt: toDate(b.paid_at ?? b.approved_at),
      customer,
      products,
      tracking
    };
  }
};

// ../../packages/gateways/src/adapters/generic.ts
function makeGeneric(provider, label) {
  return {
    provider,
    label,
    authMethod: "segredo na URL (+ HMAC-SHA256 ou token opcional)",
    requiresSecret: false,
    configurableAmountUnit: true,
    verify(req, secret) {
      if (!secret) return { ok: true, method: "url_token_only" };
      let provided = (req.headers["x-signature"] ?? req.headers["x-webhook-signature"] ?? req.headers["x-hub-signature-256"] ?? req.query.signature ?? pick(req.payload, ["signature", "secret"]) ?? "").trim();
      if (!provided) return { ok: false, method: "hmac_sha256", reason: "missing_signature" };
      if (/^sha256=/i.test(provided)) provided = provided.slice(7);
      if (safeEqual(hmacHex("sha256", req.rawBody, secret), provided.toLowerCase())) return { ok: true, method: "hmac_sha256" };
      if (safeEqual(secret, provided)) return { ok: true, method: "static_token" };
      return { ok: false, method: "hmac_sha256", reason: "signature_mismatch" };
    },
    isTestPing: (req) => ["test", "ping", "webhook_test"].includes(statusToken(req.payload.event ?? req.payload.type)),
    normalize(p, opts) {
      const data = Object.keys(obj(p.data)).length ? obj(p.data) : p;
      const rawStatus = String(p.event ?? data.event ?? data.status ?? data.payment_status ?? "");
      const token = statusToken(rawStatus).replace(/^(sale|payment|order)_/, "");
      const status = classifyGenericStatus(token) ?? classifyGenericStatus(data.status);
      const transactionId = pick(data, ["sale_id", "saleId", "transaction_id", "transactionId", "order_id", "orderId", "id", "reference", "checkout_id"]);
      if (!transactionId) return { kind: "ignored", provider, reason: "missing_transaction_id", gatewayEvent: rawStatus };
      if (!status) return { kind: "ignored", provider, reason: "unknown_status", gatewayEvent: rawStatus, transactionId };
      const unit = opts.amountUnit ?? "major";
      const currency = currencyOr(data.currency, opts.defaultCurrency);
      const value = amount(pickRaw(data, ["amount", "value", "total", "total_price", "price"]), currency, unit);
      const customer = obj(data.customer ?? data.buyer ?? data.client);
      const prods = Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : data.product ? [data.product] : [];
      const utm = obj(data.utm ?? data.tracking ?? p.tracking);
      return {
        kind: "payment",
        provider,
        sourceEventId: pick(p, ["event_id", "webhook_id"]),
        transactionId,
        status,
        gatewayEvent: rawStatus,
        amountMinor: value,
        currency,
        occurredAt: toDate(data.paid_at ?? data.updated_at ?? data.created_at),
        customer: customerFrom(customer),
        products: prods.map((x) => product(obj(x), currency, unit)),
        tracking: trackingFrom(utm)
      };
    }
  };
}
var lowify = makeGeneric("lowify", "Lowify");
var wiapay = makeGeneric("wiapay", "Wiapay");

// ../../packages/gateways/src/adapters/hotmart.ts
var EVENTS2 = {
  purchase_approved: "approved",
  purchase_complete: "approved",
  purchase_refunded: "refunded",
  purchase_chargeback: "chargeback",
  purchase_protest: "chargeback",
  purchase_canceled: "canceled",
  purchase_expired: "canceled",
  purchase_billet_printed: "pending",
  purchase_delayed: "pending",
  purchase_out_of_shopping_cart: "ignore"
};
var PAID = /* @__PURE__ */ new Set(["approved", "complete", "completed"]);
var hotmart = {
  provider: "hotmart",
  label: "Hotmart",
  authMethod: "header X-HOTMART-HOTTOK",
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: "hottok", reason: "secret_not_configured" };
    const provided = (req.headers["x-hotmart-hottok"] ?? req.headers.hottok ?? pick(req.payload, ["hottok"]) ?? "").trim();
    if (!provided) return { ok: false, method: "hottok", reason: "missing_hottok" };
    return { ok: safeEqual(secret, provided), method: "hottok", reason: "hottok_mismatch" };
  },
  isTestPing: () => false,
  normalize(p, opts) {
    const data = obj(p.data);
    const purchase = obj(data.purchase);
    const event = String(p.event ?? data.event ?? "");
    const evKey = statusToken(event);
    const mapped = EVENTS2[evKey];
    const gatewayEvent = event;
    const transactionId = pick(purchase, ["transaction", "order_id", "id"]);
    if (mapped === "ignore") return { kind: "ignored", provider: "hotmart", reason: "not_a_payment_event", gatewayEvent };
    if (!mapped) return { kind: "ignored", provider: "hotmart", reason: "unknown_event", gatewayEvent };
    if (!transactionId) return { kind: "ignored", provider: "hotmart", reason: "missing_transaction_id", gatewayEvent };
    const purchaseStatus = statusToken(purchase.status);
    const approvedMs = Number(purchase.approved_date ?? 0);
    const now = (opts.now?.() ?? /* @__PURE__ */ new Date()).getTime();
    if (mapped === "approved") {
      const buyerEmail = pick(obj(data.buyer), ["email"]);
      const productId = pick(obj(data.product), ["id", "ucode"]);
      const valid = PAID.has(purchaseStatus) && approvedMs > 0 && approvedMs <= now + 3e5 && !!buyerEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail) && !!productId;
      if (!valid) {
        return { kind: "ignored", provider: "hotmart", reason: "hotmart_purchase_failed_strict_validation", gatewayEvent, transactionId };
      }
    }
    const price = obj(purchase.price);
    const full = obj(purchase.full_price);
    const currency = currencyOr(price.currency_value ?? price.currency_code ?? full.currency_value, opts.defaultCurrency);
    const value = amount(price.value ?? full.value ?? obj(purchase.original_offer_price).value, currency, "major");
    const prod = obj(data.product);
    const origin = obj(purchase.origin);
    const xcod = pick(origin, ["xcod"]) ?? pick(purchase, ["xcod"]) ?? pick(data, ["xcod"]);
    const sck = pick(purchase, ["sckPaymentLink"]) ?? pick(origin, ["sck"]) ?? pick(purchase, ["sck"]) ?? pick(data, ["sck"]);
    const tracking = trackingFrom(obj(data.tracking), obj(purchase.tracking), xcod, origin, sck);
    if (xcod) tracking.xcod = xcod;
    if (sck) tracking.sck = sck;
    if (typeof p.purchase_event_id === "string" && p.purchase_event_id) tracking.purchaseEventId = p.purchase_event_id;
    return {
      kind: "payment",
      provider: "hotmart",
      sourceEventId: pick(p, ["id", "event_id", "webhook_id"]),
      transactionId,
      status: mapped,
      gatewayEvent,
      amountMinor: value,
      currency,
      occurredAt: mapped === "approved" ? toDate(approvedMs) : toDate(p.creation_date),
      customer: customerFrom(obj(data.buyer)),
      products: Object.keys(prod).length ? [{ id: pick(prod, ["id", "ucode"]), name: pick(prod, ["name"]), quantity: 1, priceMinor: value }] : [],
      tracking
    };
  }
};

// ../../packages/gateways/src/adapters/kirvano.ts
var EVENTS3 = {
  sale_approved: "approved",
  payment_approved: "approved",
  sale_refused: "failed",
  sale_refunded: "refunded",
  refund: "refunded",
  sale_chargeback: "chargeback",
  chargeback: "chargeback",
  sale_pending: "pending",
  pix_generated: "pending",
  bank_slip_generated: "pending",
  picpay_generated: "pending",
  sale_canceled: "canceled",
  pix_expired: "canceled",
  bank_slip_expired: "canceled",
  abandoned_cart: "ignore"
};
var kirvano = {
  provider: "kirvano",
  label: "Kirvano",
  authMethod: "header security-token",
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: "static_token", reason: "secret_not_configured" };
    const provided = (req.headers["security-token"] ?? req.headers["x-kirvano-token"] ?? req.headers.token ?? "").trim();
    if (!provided) return { ok: false, method: "static_token", reason: "missing_token_header" };
    return { ok: safeEqual(secret, provided), method: "static_token", reason: "token_mismatch" };
  },
  isTestPing: (req) => !req.payload.event && !req.payload.sale_id,
  normalize(p, opts) {
    const gatewayEvent = String(p.event ?? p.status ?? "");
    const mapped = EVENTS3[statusToken(p.event)];
    if (mapped === "ignore") return { kind: "ignored", provider: "kirvano", reason: "not_a_payment_event", gatewayEvent };
    const status = mapped ?? classifyGenericStatus(p.status);
    const transactionId = pick(p, ["sale_id", "transaction_id", "order_id", "checkout_id", "id"]);
    if (!transactionId) return { kind: "ignored", provider: "kirvano", reason: "missing_transaction_id", gatewayEvent };
    if (!status) return { kind: "ignored", provider: "kirvano", reason: "unknown_status", gatewayEvent, transactionId };
    const currency = currencyOr(p.currency, opts.defaultCurrency);
    const value = amount(pickRaw(p, ["total_price", "value", "amount"]), currency, "major");
    const products = Array.isArray(p.products) ? p.products.map((x) => product(obj(x), currency, "major")) : [];
    return {
      kind: "payment",
      provider: "kirvano",
      sourceEventId: null,
      transactionId,
      status,
      gatewayEvent,
      amountMinor: value,
      currency,
      occurredAt: toDate(p.created_at),
      customer: customerFrom(obj(p.customer)),
      products,
      tracking: trackingFrom(obj(p.utm), obj(p.tracking))
    };
  }
};

// ../../packages/gateways/src/adapters/kiwify.ts
var STATUS = {
  paid: "approved",
  approved: "approved",
  order_approved: "approved",
  waiting_payment: "pending",
  pix_created: "pending",
  billet_created: "pending",
  refused: "failed",
  order_rejected: "failed",
  refunded: "refunded",
  order_refunded: "refunded",
  chargedback: "chargeback",
  chargeback: "chargeback",
  canceled: "canceled",
  cancelled: "canceled"
};
var kiwify = {
  provider: "kiwify",
  label: "Kiwify",
  authMethod: "HMAC-SHA1 do corpo em ?signature=",
  requiresSecret: true,
  configurableAmountUnit: false,
  verify(req, secret) {
    if (!secret) return { ok: false, method: "hmac_sha1", reason: "secret_not_configured" };
    const provided = (req.query.signature ?? req.headers["x-kiwify-signature"] ?? "").trim().toLowerCase();
    if (!provided) return { ok: false, method: "hmac_sha1", reason: "missing_signature" };
    return { ok: safeEqual(hmacHex("sha1", req.rawBody, secret), provided), method: "hmac_sha1", reason: "signature_mismatch" };
  },
  isTestPing: (req) => !req.payload.order_id && !req.payload.order_status,
  normalize(p, opts) {
    const gatewayEvent = String(p.order_status ?? p.webhook_event_type ?? "");
    const status = statusToken(p.order_status) ? STATUS[statusToken(p.order_status)] : STATUS[statusToken(p.webhook_event_type)];
    const transactionId = pick(p, ["order_id", "order_ref", "id"]);
    if (!transactionId) return { kind: "ignored", provider: "kiwify", reason: "missing_transaction_id", gatewayEvent };
    if (!status) return { kind: "ignored", provider: "kiwify", reason: "unknown_status", gatewayEvent, transactionId };
    const comm = obj(p.Commissions);
    const currency = currencyOr(comm.currency ?? p.currency, opts.defaultCurrency);
    const value = amount(comm.charge_amount ?? p.charge_amount ?? comm.product_base_price, currency, "minor");
    const prod = obj(p.Product);
    const tp = obj(p.TrackingParameters);
    return {
      kind: "payment",
      provider: "kiwify",
      sourceEventId: null,
      transactionId,
      status,
      gatewayEvent,
      amountMinor: value,
      currency,
      occurredAt: toDate(p.approved_date ?? p.updated_at ?? p.created_at),
      customer: customerFrom(obj(p.Customer ?? p.customer)),
      products: Object.keys(prod).length ? [product(prod, currency, "minor", value)] : [],
      tracking: { ...trackingFrom(tp, typeof tp.sck === "string" ? tp.sck : null), ...tp.sck ? { sck: String(tp.sck) } : {} }
    };
  }
};

// ../../packages/gateways/src/types.ts
var PROVIDERS = ["checkout", "kiwify", "cakto", "kirvano", "hotmart", "lowify", "wiapay"];

// ../../packages/gateways/src/index.ts
var ADAPTERS = { checkout, kiwify, cakto, kirvano, hotmart, lowify, wiapay };
function idempotencyKey(n) {
  return n.sourceEventId ? `evt:${n.sourceEventId}` : `txn:${n.transactionId}:${n.status}`;
}
function purchaseEventId(n) {
  const forwarded = n.tracking.purchaseEventId?.trim();
  if (forwarded && forwarded.length <= 128) return forwarded;
  if (n.provider === "hotmart") return `hotmart_purchase_${n.transactionId}`;
  return n.transactionId;
}
function refundEventId(n) {
  return `refund_${n.provider}_${n.transactionId}`;
}

// src/integrations/routes.ts
function webhookUrl(ctx2, provider, token) {
  return `${ctx2.config.PUBLIC_API_URL}/v1/webhooks/${provider}/${token}`;
}
function dto(r) {
  const ad = ADAPTERS[r.provider];
  return {
    id: r.id,
    provider: r.provider,
    providerLabel: ad.label,
    authMethod: ad.authMethod,
    requiresSecret: ad.requiresSecret,
    configurableAmountUnit: ad.configurableAmountUnit,
    name: r.name,
    tokenHint: r.token_hint,
    secretConfigured: !!r.secret_enc,
    defaultPixelId: r.default_pixel_id,
    amountUnit: r.amount_unit,
    active: r.active,
    lastReceivedAt: r.last_received_at,
    createdAt: r.created_at,
    stats: r.stats ?? null
  };
}
var updateSchema = z5.object({
  name: z5.string().trim().min(1).max(120).optional(),
  secret: z5.string().trim().min(4).max(255).optional().nullable(),
  defaultPixelId: z5.string().uuid().optional().nullable(),
  amountUnit: z5.enum(["major", "minor"]).optional(),
  active: z5.boolean().optional()
});
function integrationRoutes(app2, ctx2) {
  async function assertPixel(orgId, pixelId) {
    if (!pixelId) return;
    const r = await ctx2.db.query("SELECT 1 FROM pixels WHERE id = $1 AND org_id = $2", [pixelId, orgId]);
    if (!r.rowCount) throw badRequest("Pixel padr\xE3o n\xE3o pertence a esta organiza\xE7\xE3o.");
  }
  app2.get("/v1/integrations/providers", async (req) => {
    requireRole(req, "viewer");
    return {
      providers: PROVIDERS.map((p) => ({
        provider: p,
        label: ADAPTERS[p].label,
        authMethod: ADAPTERS[p].authMethod,
        requiresSecret: ADAPTERS[p].requiresSecret,
        configurableAmountUnit: ADAPTERS[p].configurableAmountUnit
      }))
    };
  });
  app2.get("/v1/integrations", async (req) => {
    const a = requireRole(req, "viewer");
    const r = await ctx2.db.query(
      `SELECT i.*, (SELECT json_build_object(
                'processed', count(*) FILTER (WHERE outcome = 'processed'),
                'duplicate', count(*) FILTER (WHERE outcome = 'duplicate'),
                'ignored',   count(*) FILTER (WHERE outcome = 'ignored'),
                'rejected',  count(*) FILTER (WHERE outcome = 'rejected'),
                'failed',    count(*) FILTER (WHERE outcome = 'failed'))
              FROM webhook_receipts w WHERE w.integration_id = i.id AND w.received_at > now() - interval '7 days') AS stats
         FROM integrations i WHERE i.org_id = $1 ORDER BY i.created_at`,
      [a.org.id]
    );
    return { integrations: r.rows.map(dto) };
  });
  app2.post("/v1/integrations", async (req, reply) => {
    const a = requireRole(req, "admin");
    const b = parse(updateSchema.extend({ provider: z5.enum(PROVIDERS) }), req.body);
    const ad = ADAPTERS[b.provider];
    if (ad.requiresSecret && !b.secret) throw badRequest(`${ad.label} exige o segredo/token do webhook (${ad.authMethod}).`);
    await assertPixel(a.org.id, b.defaultPixelId);
    const token = integrationToken();
    const r = await ctx2.db.query(
      `INSERT INTO integrations(org_id, provider, name, token_hash, token_hint, secret_enc, default_pixel_id, amount_unit, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, true)) RETURNING *`,
      [
        a.org.id,
        b.provider,
        b.name ?? ad.label,
        sha256Hex(token),
        hint(token),
        ctx2.box.encryptNullable(b.secret),
        b.defaultPixelId ?? null,
        b.amountUnit ?? "major",
        b.active ?? null
      ]
    );
    await audit(ctx2, a.org.id, a.user.id, "integration.created", r.rows[0].id, { provider: b.provider });
    return reply.code(201).send({ integration: dto(r.rows[0]), token, webhookUrl: webhookUrl(ctx2, b.provider, token) });
  });
  app2.patch("/v1/integrations/:id", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z5.object({ id: z5.string().uuid() }), req.params);
    const b = parse(updateSchema, req.body);
    await assertPixel(a.org.id, b.defaultPixelId);
    const cur = await ctx2.db.query("SELECT provider FROM integrations WHERE id = $1 AND org_id = $2", [id, a.org.id]);
    if (!cur.rowCount) throw notFound("Integra\xE7\xE3o n\xE3o encontrada.");
    if (b.secret === null && ADAPTERS[cur.rows[0].provider].requiresSecret) throw badRequest("Este gateway exige segredo.");
    const r = await ctx2.db.query(
      `UPDATE integrations SET name = COALESCE($3, name),
              secret_enc = CASE WHEN $4::boolean THEN $5 ELSE secret_enc END,
              default_pixel_id = CASE WHEN $6::boolean THEN $7::uuid ELSE default_pixel_id END,
              amount_unit = COALESCE($8, amount_unit), active = COALESCE($9, active), updated_at = now()
        WHERE id = $1 AND org_id = $2 RETURNING *`,
      [
        id,
        a.org.id,
        b.name ?? null,
        b.secret !== void 0,
        ctx2.box.encryptNullable(b.secret),
        b.defaultPixelId !== void 0,
        b.defaultPixelId ?? null,
        b.amountUnit ?? null,
        b.active ?? null
      ]
    );
    await audit(ctx2, a.org.id, a.user.id, "integration.updated", id, { secretChanged: b.secret !== void 0 });
    return { integration: dto(r.rows[0]) };
  });
  app2.post("/v1/integrations/:id/rotate-token", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z5.object({ id: z5.string().uuid() }), req.params);
    const token = integrationToken();
    const r = await ctx2.db.query(
      "UPDATE integrations SET token_hash = $3, token_hint = $4, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING *",
      [id, a.org.id, sha256Hex(token), hint(token)]
    );
    if (!r.rowCount) throw notFound("Integra\xE7\xE3o n\xE3o encontrada.");
    await audit(ctx2, a.org.id, a.user.id, "integration.token_rotated", id);
    return { integration: dto(r.rows[0]), token, webhookUrl: webhookUrl(ctx2, r.rows[0].provider, token) };
  });
  app2.delete("/v1/integrations/:id", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(z5.object({ id: z5.string().uuid() }), req.params);
    const r = await ctx2.db.query("DELETE FROM integrations WHERE id = $1 AND org_id = $2", [id, a.org.id]);
    if (!r.rowCount) throw notFound("Integra\xE7\xE3o n\xE3o encontrada.");
    await audit(ctx2, a.org.id, a.user.id, "integration.deleted", id);
    return { ok: true };
  });
  app2.get("/v1/webhook-receipts", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(z5.object({
      integrationId: z5.string().uuid().optional(),
      outcome: z5.enum(["processed", "duplicate", "ignored", "rejected", "failed"]).optional(),
      cursor: z5.coerce.number().int().optional()
    }), req.query);
    const r = await ctx2.db.query(
      `SELECT w.id, w.provider, w.correlation_id, w.received_at, w.signature_ok, w.signature_method, w.outcome, w.reason,
              w.gateway_event, w.transaction_id, w.payment_id, w.processing_ms, w.body_enc IS NOT NULL AS can_replay, i.name AS integration_name
         FROM webhook_receipts w LEFT JOIN integrations i ON i.id = w.integration_id
        WHERE w.org_id = $1 AND ($2::uuid IS NULL OR w.integration_id = $2) AND ($3::text IS NULL OR w.outcome = $3)
          AND ($4::bigint IS NULL OR w.id < $4)
        ORDER BY w.id DESC LIMIT 50`,
      [a.org.id, q.integrationId ?? null, q.outcome ?? null, q.cursor ?? null]
    );
    return { receipts: r.rows, nextCursor: r.rows.length === 50 ? r.rows[49].id : null };
  });
}

// src/webhooks/ingest.ts
import { randomUUID } from "node:crypto";

// src/capi/outbox.ts
async function enqueueCapi(c, i) {
  const r = await c.query(
    `INSERT INTO capi_outbox(org_id, pixel_id, event_name, event_id, payload, payment_id, tracking_event_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
    [
      i.orgId,
      i.pixelId,
      i.event.event_name,
      i.event.event_id,
      JSON.stringify(i.event),
      i.paymentId ?? null,
      i.trackingEventId ?? null,
      i.correlationId ?? null
    ]
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}
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

// src/notifications/push.ts
import webpush from "web-push";
async function sendPushToOrg(ctx2, orgId, payload) {
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = ctx2.config;
  if (!pub || !priv) return { sent: 0, failed: 0, removed: 0, configured: false };
  const subs = await ctx2.db.query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE org_id = $1", [orgId]);
  let sent = 0, failed = 0, removed = 0;
  const body = JSON.stringify({ ...payload, url: payload.url ?? "/", icon: "/icon-192.png", type: "sale" });
  await Promise.all(subs.rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 3600, vapidDetails: { subject, publicKey: pub, privateKey: priv } }
      );
      sent++;
    } catch (e) {
      failed++;
      const code = e.statusCode;
      if (code === 404 || code === 410) {
        await ctx2.db.query("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
        removed++;
      }
    }
  }));
  return { sent, failed, removed, configured: true };
}

// src/tracking/identity.ts
var emailLookupHash = (email2) => {
  const e = (email2 ?? "").trim().toLowerCase();
  return e.includes("@") ? sha256(e) : null;
};
var phoneLookupHash = (phone) => {
  const d = String(phone ?? "").replace(/\D+/g, "");
  return d.length >= 8 ? sha256(d.slice(-9)) : null;
};
var clip = (v, n) => typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
async function rememberIdentity(c, orgId, i) {
  const xid = clip(i.xid, 100);
  if (!xid) return;
  const u = i.utms ?? {};
  await c.query(
    `INSERT INTO visitor_identities(org_id, xid, fbp, fbc, client_ip, user_agent, country, email_hash, phone_hash, source_url,
                                    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, checkout_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (org_id, xid) DO UPDATE SET
       fbp = COALESCE(EXCLUDED.fbp, visitor_identities.fbp),
       fbc = COALESCE(EXCLUDED.fbc, visitor_identities.fbc),
       client_ip = COALESCE(EXCLUDED.client_ip, visitor_identities.client_ip),
       user_agent = COALESCE(EXCLUDED.user_agent, visitor_identities.user_agent),
       country = COALESCE(EXCLUDED.country, visitor_identities.country),
       email_hash = COALESCE(visitor_identities.email_hash, EXCLUDED.email_hash),
       phone_hash = COALESCE(visitor_identities.phone_hash, EXCLUDED.phone_hash),
       source_url = COALESCE(EXCLUDED.source_url, visitor_identities.source_url),
       utm_source = COALESCE(EXCLUDED.utm_source, visitor_identities.utm_source),
       utm_medium = COALESCE(EXCLUDED.utm_medium, visitor_identities.utm_medium),
       utm_campaign = COALESCE(EXCLUDED.utm_campaign, visitor_identities.utm_campaign),
       utm_content = COALESCE(EXCLUDED.utm_content, visitor_identities.utm_content),
       utm_term = COALESCE(EXCLUDED.utm_term, visitor_identities.utm_term),
       utm_id = COALESCE(EXCLUDED.utm_id, visitor_identities.utm_id),
       checkout_seen = visitor_identities.checkout_seen OR EXCLUDED.checkout_seen,
       updated_at = now()`,
    [
      orgId,
      xid,
      clip(i.fbp, 255),
      clip(i.fbc, 255),
      isPublicIp(i.ip) ? i.ip : null,
      clip(i.userAgent, 512),
      clip(i.country, 2)?.toUpperCase() ?? null,
      emailLookupHash(i.email),
      phoneLookupHash(i.phone),
      clip(i.sourceUrl, 1e3),
      ...UTM_KEYS.map((k) => clip(u[k], 255)),
      !!i.checkoutSeen
    ]
  );
}
async function findIdentity(c, orgId, keys) {
  const cols = `xid, fbp, fbc, host(client_ip) AS client_ip, user_agent, country, source_url,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id`;
  if (keys.xid) {
    const r = await c.query(
      `SELECT ${cols} FROM visitor_identities WHERE org_id = $1 AND xid = $2 AND updated_at > now() - interval '90 days'`,
      [orgId, keys.xid.trim().slice(0, 100)]
    );
    if (r.rows[0]) return r.rows[0];
  }
  for (const [col, hash] of [["email_hash", emailLookupHash(keys.email)], ["phone_hash", phoneLookupHash(keys.phone)]]) {
    if (!hash) continue;
    const r = await c.query(
      `SELECT ${cols} FROM visitor_identities
        WHERE org_id = $1 AND ${col} = $2 AND checkout_seen AND updated_at > now() - interval '90 days'
        ORDER BY updated_at DESC LIMIT 1`,
      [orgId, hash]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

// src/webhooks/ingest.ts
var MAX_EVENT_AGE_S = 6 * 24 * 3600;
function parsePayload(raw, form) {
  if (form && Object.keys(form).length) return form;
  const t = raw.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch {
    const params = new URLSearchParams(t);
    const o = {};
    for (const [k, v] of params) o[k] = v;
    return Object.keys(o).length ? o : null;
  }
}
async function receipt(c, r) {
  const q = await c.query(
    `INSERT INTO webhook_receipts(org_id, integration_id, provider, correlation_id, idempotency_key, signature_ok, signature_method,
                                  outcome, reason, gateway_event, transaction_id, payment_id, body_sha256, body_enc, processing_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      r.orgId,
      r.integrationId,
      r.provider,
      r.correlationId,
      r.idemKey ?? null,
      r.signatureOk ?? null,
      r.signatureMethod ?? null,
      r.outcome,
      r.reason ?? null,
      r.gatewayEvent?.slice(0, 120) ?? null,
      r.transactionId?.slice(0, 128) ?? null,
      r.paymentId ?? null,
      r.bodySha,
      r.bodyEnc ?? null,
      r.ms
    ]
  );
  return Number(q.rows[0].id);
}
async function loadPixel2(c, orgId, id) {
  if (!id) return null;
  const r = await c.query("SELECT id, meta_pixel_id, currency, active, capi_token_enc, send_refund_event, name FROM pixels WHERE id = $1 AND org_id = $2", [id, orgId]);
  return r.rows[0] ? { ...r.rows[0], currency: String(r.rows[0].currency).trim() } : null;
}
async function resolvePixel(c, orgId, productIds, defaultPixelId) {
  if (productIds.length) {
    const r = await c.query(
      `SELECT pp.pixel_id, array_position($2::text[], pp.product_id) AS pos FROM pixel_products pp
        WHERE pp.org_id = $1 AND pp.product_id = ANY($2) ORDER BY pos LIMIT 1`,
      [orgId, productIds]
    );
    if (r.rows[0]) return loadPixel2(c, orgId, r.rows[0].pixel_id);
  }
  if (defaultPixelId) return loadPixel2(c, orgId, defaultPixelId);
  const only = await c.query("SELECT id FROM pixels WHERE org_id = $1 AND active ORDER BY created_at LIMIT 2", [orgId]);
  return only.rowCount === 1 ? loadPixel2(c, orgId, only.rows[0].id) : null;
}
async function ingestWebhook(ctx2, input) {
  const started = Date.now();
  const correlationId = randomUUID();
  const bodySha = sha256Hex(input.rawBody);
  const adapter = ADAPTERS[input.provider];
  const ms = () => Date.now() - started;
  const base = { provider: input.provider, correlationId, bodySha };
  const ir = await ctx2.db.query(
    "SELECT id, org_id, provider, secret_enc, default_pixel_id, amount_unit, active FROM integrations WHERE token_hash = $1 AND provider = $2",
    [sha256Hex(input.token), input.provider]
  );
  const integration = ir.rows[0];
  if (!integration || !integration.active) {
    await receipt(ctx2.db, { ...base, orgId: integration?.org_id ?? null, integrationId: integration?.id ?? null, outcome: "rejected", reason: integration ? "integration_inactive" : "invalid_token", ms: ms() });
    return { httpStatus: 401, body: { success: false, error: "Invalid integration token", correlationId } };
  }
  const ib = { ...base, orgId: integration.org_id, integrationId: integration.id };
  const payload = parsePayload(input.rawBody, input.formBody);
  if (!payload) {
    if (!input.rawBody.trim()) return { httpStatus: 200, body: { success: true, ping: true, correlationId } };
    await receipt(ctx2.db, { ...ib, outcome: "rejected", reason: "invalid_body", ms: ms() });
    return { httpStatus: 400, body: { success: false, error: "Invalid body", correlationId } };
  }
  const req = { rawBody: input.rawBody, headers: input.headers, query: input.query, payload };
  if (adapter.isTestPing(req)) return { httpStatus: 200, body: { success: true, test: true, correlationId } };
  const secret = ctx2.box.decryptNullable(integration.secret_enc);
  const sig = adapter.verify(req, secret);
  if (!sig.ok) {
    await receipt(ctx2.db, { ...ib, signatureOk: false, signatureMethod: sig.method, outcome: "rejected", reason: sig.reason ?? "invalid_signature", ms: ms() });
    ctx2.log.warn({ correlationId, provider: input.provider, reason: sig.reason }, "webhook rejeitado (assinatura)");
    return { httpStatus: 401, body: { success: false, error: "Invalid signature", reason: sig.reason, correlationId } };
  }
  const sigInfo = { signatureOk: true, signatureMethod: sig.method };
  const bodyEnc = ctx2.box.encrypt(input.rawBody);
  const defaultPixel = await loadPixel2(ctx2.db, integration.org_id, integration.default_pixel_id);
  const orgCur = await ctx2.db.query("SELECT reporting_currency FROM organizations WHERE id = $1", [integration.org_id]);
  const defaultCurrency = defaultPixel?.currency ?? String(orgCur.rows[0]?.reporting_currency ?? "BRL").trim();
  const normalized = adapter.normalize(payload, { defaultCurrency, amountUnit: integration.amount_unit, now: ctx2.now });
  await ctx2.db.query("UPDATE integrations SET last_received_at = now() WHERE id = $1", [integration.id]);
  if (normalized.kind === "ignored") {
    await receipt(ctx2.db, { ...ib, ...sigInfo, outcome: "ignored", reason: normalized.reason, gatewayEvent: normalized.gatewayEvent, transactionId: normalized.transactionId, ms: ms() });
    return { httpStatus: 200, body: { success: true, queued: false, ignored: true, reason: normalized.reason, correlationId } };
  }
  const productIds = [
    ...normalized.products.map((p) => p.id).filter((x) => !!x),
    ...input.provider === "checkout" ? extractProductIds(payload) : []
  ];
  if (normalized.kind === "event") {
    return ingestServerEvent(ctx2, integration, normalized, productIds, { ...ib, ...sigInfo, bodyEnc }, ms);
  }
  try {
    const out = await tx(ctx2.db, (c) => applyPayment(ctx2, c, integration, normalized, productIds, { ...ib, ...sigInfo, bodyEnc }, ms));
    if (out.purchase) {
      const p = out.purchase;
      sendPushToOrg(ctx2, integration.org_id, {
        title: "Venda aprovada! \u{1F525}",
        body: `${p.amount} \u2022 ${p.pixelName ?? ADAPTERS[input.provider].label}`,
        url: "/vendas",
        tag: `sale-${normalized.transactionId}`
      }).catch((e) => ctx2.log.warn({ err: String(e) }, "push falhou"));
    }
    return { httpStatus: 200, body: { success: true, correlationId, ...out.response } };
  } catch (e) {
    if (e.code === "23505") {
      await receipt(ctx2.db, { ...ib, ...sigInfo, idemKey: null, outcome: "duplicate", reason: "concurrent_duplicate", transactionId: normalized.transactionId, ms: ms() });
      return { httpStatus: 200, body: { success: true, duplicate: true, correlationId } };
    }
    ctx2.log.error({ correlationId, err: e.message }, "falha ao processar webhook");
    await receipt(ctx2.db, { ...ib, ...sigInfo, outcome: "failed", reason: e.message.slice(0, 300), transactionId: normalized.transactionId, bodyEnc, ms: ms() }).catch(() => void 0);
    return { httpStatus: 500, body: { success: false, error: "Internal error", correlationId } };
  }
}
async function applyPayment(ctx2, c, integration, n, productIds, rb, ms) {
  const orgId = integration.org_id;
  const idemKey = idempotencyKey(n);
  const dup = await c.query(
    `SELECT payment_id FROM webhook_receipts WHERE integration_id = $1 AND idempotency_key = $2 AND outcome = 'processed' LIMIT 1`,
    [integration.id, idemKey]
  );
  if (dup.rowCount) {
    await receipt(c, { ...rb, idemKey: null, outcome: "duplicate", reason: "webhook_already_processed", gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: dup.rows[0].payment_id, bodyEnc: null, ms: ms() });
    return { purchase: null, response: { duplicate: true, reason: "webhook already processed" } };
  }
  const pixel = await resolvePixel(c, orgId, productIds, integration.default_pixel_id);
  const t = n.tracking;
  const utm = (k) => t[k] ?? null;
  const ins = await c.query(
    `INSERT INTO payments(org_id, provider, transaction_id, status, integration_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, provider, transaction_id) DO NOTHING RETURNING id`,
    [orgId, n.provider, n.transactionId, n.status, integration.id]
  );
  const isNew = !!ins.rowCount;
  const cur = await c.query(
    "SELECT id, status, pixel_id, amount_minor, currency, approved_at FROM payments WHERE org_id = $1 AND provider = $2 AND transaction_id = $3 FOR UPDATE",
    [orgId, n.provider, n.transactionId]
  );
  const payment = cur.rows[0];
  const from = isNew ? null : payment.status;
  const to = n.status;
  if (!isNew && !canTransition(from, to)) {
    const reason = from === to ? "status_unchanged" : `out_of_order_transition_${from}_to_${to}`;
    await receipt(c, { ...rb, idemKey, outcome: "duplicate", reason, gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: payment.id, ms: ms() });
    return { purchase: null, response: { duplicate: true, reason, status: from } };
  }
  const at = n.occurredAt ?? ctx2.now();
  const amountMinor = n.amountMinor ?? payment.amount_minor ?? null;
  const currency = n.amountMinor !== null ? n.currency : payment.currency?.trim() ?? n.currency;
  await c.query(
    `UPDATE payments SET status = $2, amount_minor = $3, currency = $4, pixel_id = COALESCE(pixel_id, $5),
            customer_email_hash = COALESCE($6, customer_email_hash), products = CASE WHEN $7::jsonb = '[]'::jsonb THEN products ELSE $7::jsonb END,
            utm_source = COALESCE($8, utm_source), utm_medium = COALESCE($9, utm_medium), utm_campaign = COALESCE($10, utm_campaign),
            utm_content = COALESCE($11, utm_content), utm_term = COALESCE($12, utm_term), utm_id = COALESCE($13, utm_id),
            pending_at  = CASE WHEN $2 = 'pending' THEN COALESCE(pending_at, $14) ELSE pending_at END,
            approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, $14) ELSE approved_at END,
            reversed_at = CASE WHEN $2 IN ('refunded', 'chargeback') THEN $14 ELSE reversed_at END,
            canceled_at = CASE WHEN $2 IN ('canceled', 'failed') THEN $14 ELSE canceled_at END,
            updated_at = now()
      WHERE id = $1`,
    [
      payment.id,
      to,
      amountMinor,
      currency,
      pixel?.id ?? null,
      emailLookupHash(n.customer.email),
      JSON.stringify(n.products.map((p) => ({ ...p, priceMinor: p.priceMinor?.toString() ?? null }))),
      utm("utm_source"),
      utm("utm_medium"),
      utm("utm_campaign"),
      utm("utm_content"),
      utm("utm_term"),
      utm("utm_id"),
      at
    ]
  );
  const receiptId = await receipt(c, { ...rb, idemKey, outcome: "processed", gatewayEvent: n.gatewayEvent, transactionId: n.transactionId, paymentId: payment.id, ms: ms() });
  await c.query("INSERT INTO payment_transitions(payment_id, from_status, to_status, receipt_id, occurred_at) VALUES ($1, $2, $3, $4, $5)", [payment.id, from, to, receiptId, at]);
  const effectivePixel = pixel ?? (payment.pixel_id ? await loadPixel2(c, orgId, payment.pixel_id) : null);
  let queued = false;
  let purchase = null;
  if (isPurchaseTransition(from, to)) {
    purchase = { amount: amountMinor !== null && currency ? formatMoney(amountMinor, currency) : "valor n\xE3o informado", pixelName: effectivePixel?.name ?? null };
    if (!effectivePixel) {
      await raiseAlert(c, orgId, {
        kind: "sale_without_pixel",
        severity: "warning",
        dedupKey: `sale_without_pixel:${integration.id}`,
        title: "Venda aprovada sem pixel associado",
        detail: "Cadastre o ID do produto em um pixel ou defina o pixel padr\xE3o da integra\xE7\xE3o para enviar o Purchase \xE0 Meta."
      });
    } else if (!amountMinor || amountMinor <= 0n || !currency) {
      await raiseAlert(c, orgId, {
        kind: "purchase_without_value",
        severity: "warning",
        dedupKey: `purchase_without_value:${integration.id}`,
        title: "Venda aprovada sem valor",
        detail: `Transa\xE7\xE3o ${n.transactionId}: o gateway n\xE3o informou o valor; Purchase n\xE3o enviado \xE0 Meta.`
      });
    } else {
      const event = await buildPaymentEvent(c, orgId, n, "Purchase", purchaseEventId(n), amountMinor, currency, at, ctx2.now());
      await c.query("UPDATE payments SET purchase_event_id = $2 WHERE id = $1", [payment.id, event.event_id]);
      queued = await enqueueCapi(c, { orgId, pixelId: effectivePixel.id, event, paymentId: payment.id, correlationId: rb.correlationId }) !== null;
    }
  } else if (isReversal(to) && from === "approved" && effectivePixel?.send_refund_event) {
    const event = await buildPaymentEvent(c, orgId, n, "Refund", refundEventId(n), null, null, at, ctx2.now());
    queued = await enqueueCapi(c, { orgId, pixelId: effectivePixel.id, event, paymentId: payment.id, correlationId: rb.correlationId }) !== null;
  }
  return {
    purchase,
    response: { processed: true, paymentId: payment.id, status: to, previousStatus: from, queued, eventName: queued ? to === "approved" ? "Purchase" : "Refund" : null }
  };
}
async function buildPaymentEvent(c, orgId, n, eventName, eventId, amountMinor, currency, at, now) {
  const t = n.tracking;
  const identity = await findIdentity(c, orgId, { xid: t.externalId ?? n.customer.externalId, email: n.customer.email, phone: n.customer.phone });
  const nowS = Math.floor(now.getTime() / 1e3);
  const atS = Math.floor(at.getTime() / 1e3);
  const eventTime = atS > nowS || nowS - atS > MAX_EVENT_AGE_S ? nowS : atS;
  const utms = Object.fromEntries(UTM_KEYS.map((k) => [k, t[k] ?? identity?.[k] ?? null]));
  const xid = identity?.xid ?? t.externalId ?? n.customer.externalId ?? null;
  return buildServerEvent({
    eventName,
    eventId,
    eventTime,
    eventSourceUrl: t.eventSourceUrl ?? identity?.source_url ?? null,
    customer: { ...n.customer, externalId: xid, country: n.customer.country ?? identity?.country ?? null },
    // IP/UA só do navegador do comprador — nunca do gateway (legado: P-37/BUGFIX)
    tracking: { fbp: t.fbp ?? identity?.fbp, fbc: t.fbc ?? identity?.fbc, clientIp: t.clientIp ?? identity?.client_ip, userAgent: t.userAgent ?? identity?.user_agent },
    valueMinor: amountMinor,
    currency,
    products: n.products,
    orderId: n.transactionId,
    utms
  });
}
async function ingestServerEvent(ctx2, integration, n, productIds, rb, ms) {
  const orgId = integration.org_id;
  return tx(ctx2.db, async (c) => {
    const pixel = await resolvePixel(c, orgId, productIds, integration.default_pixel_id);
    if (!pixel) {
      await receipt(c, { ...rb, outcome: "ignored", reason: "no_pixel_for_event", gatewayEvent: n.eventName, ms: ms() });
      return { httpStatus: 200, body: { success: true, queued: false, ignored: true, reason: "no pixel resolved", correlationId: rb.correlationId } };
    }
    const eventId = n.eventId ?? n.transactionId ?? `srv_${sha256(rb.bodySha + n.eventName).slice(0, 32)}`;
    const event = await buildPaymentEvent(c, orgId, n, n.eventName, eventId, n.amountMinor, n.currency, ctx2.now(), ctx2.now());
    const te = await c.query(
      `INSERT INTO tracking_events(org_id, pixel_id, event_name, event_id, source, value_minor, currency, match_keys)
       VALUES ($1,$2,$3,$4,'server',$5,$6,$7) ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
      [orgId, pixel.id, n.eventName, eventId, n.amountMinor, n.currency, Object.keys(event.user_data)]
    );
    if (!te.rowCount) {
      await receipt(c, { ...rb, outcome: "duplicate", reason: "event_already_received", gatewayEvent: n.eventName, ms: ms() });
      return { httpStatus: 200, body: { success: true, duplicate: true, correlationId: rb.correlationId } };
    }
    await enqueueCapi(c, { orgId, pixelId: pixel.id, event, trackingEventId: te.rows[0].id, correlationId: rb.correlationId });
    await receipt(c, { ...rb, outcome: "processed", gatewayEvent: n.eventName, transactionId: n.transactionId, ms: ms() });
    return { httpStatus: 200, body: { success: true, queued: true, event_name: n.eventName, event_id: eventId, correlationId: rb.correlationId } };
  });
}

// src/webhooks/routes.ts
var isProvider = (p) => PROVIDERS.includes(p);
function headersOf(req) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return h;
}
function bearer(req) {
  const a = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(a);
  return (m?.[1] ?? String(req.headers["x-integration-token"] ?? "")).trim();
}
function webhookRoutes(app2, ctx2) {
  async function handle(req, reply, provider, token) {
    if (!isProvider(provider)) return reply.code(400).send({ success: false, error: "Unsupported gateway", supported: PROVIDERS });
    if (!token) return reply.code(401).send({ success: false, error: "Missing integration token" });
    const form = req.body && typeof req.body === "object" && !req.rawBody?.trim().startsWith("{") ? req.body : null;
    const out = await ingestWebhook(ctx2, {
      provider,
      token,
      rawBody: req.rawBody ?? "",
      headers: headersOf(req),
      query: Object.fromEntries(Object.entries(req.query ?? {}).map(([k, v]) => [k, String(v)])),
      formBody: form
    });
    return reply.code(out.httpStatus).header("x-correlation-id", String(out.body.correlationId ?? "")).send(out.body);
  }
  const ping = async (req) => ({ success: true, ping: true, gateway: req.params.provider ?? req.query.gateway ?? null });
  app2.post("/v1/webhooks/:provider/:token", (req, reply) => handle(req, reply, req.params.provider, req.params.token));
  app2.get("/v1/webhooks/:provider/:token", ping);
  app2.post("/v1/webhooks/checkout", (req, reply) => handle(req, reply, "checkout", bearer(req)));
  app2.post("/api/webhook.php", (req, reply) => handle(req, reply, "checkout", bearer(req)));
  app2.post("/api/webhook_gateway.php", (req, reply) => handle(req, reply, String(req.query.gateway ?? "").toLowerCase(), String(req.query.token ?? "") || bearer(req)));
  app2.get("/api/webhook_gateway.php", ping);
}

// src/collect/routes.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var buckets = /* @__PURE__ */ new Map();
function allow(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5e4) {
      for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    }
    return true;
  }
  b.n++;
  return b.n <= limit;
}
var COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-appengine-country", "x-country-code"];
function cors(req, reply) {
  const origin = String(req.headers.origin ?? "");
  reply.header("Access-Control-Allow-Origin", origin || "*");
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type, X-Public-Key");
  reply.header("Access-Control-Max-Age", "86400");
}
var str = (v, n = 500) => typeof v === "string" && v.trim() ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : null;
function collectRoutes(app2, ctx2) {
  async function pixelByKey(key, legacyToken) {
    const cols = "p.id, p.org_id, p.meta_pixel_id, p.currency, p.active, p.capi_token_enc, p.allowed_origins";
    if (key && !key.startsWith("itk_")) {
      const r2 = await ctx2.db.query(`SELECT ${cols} FROM pixels p WHERE p.public_key = $1`, [key]);
      return r2.rows[0] ?? null;
    }
    const token = key || legacyToken;
    if (!token) return null;
    const r = await ctx2.db.query(
      `SELECT ${cols} FROM integrations i JOIN pixels p ON p.id = i.default_pixel_id
        WHERE i.token_hash = $1 AND i.provider = 'checkout' AND i.active LIMIT 1`,
      [sha256Hex(token)]
    );
    return r.rows[0] ?? null;
  }
  async function collect(req, reply) {
    cors(req, reply);
    const q = req.query ?? {};
    const key = String(q.k ?? req.headers["x-public-key"] ?? "").trim();
    const pixel = await pixelByKey(key, String(q.t ?? "").trim());
    if (!pixel) return reply.code(401).send({ success: false, error: "Invalid key" });
    if (!pixel.active) return reply.code(200).send({ success: true, queued: false, ignored: true, reason: "pixel_inactive" });
    const origin = String(req.headers.origin ?? "");
    if (pixel.allowed_origins.length && origin && !pixel.allowed_origins.includes(origin)) {
      return reply.code(403).send({ success: false, error: "Origin not allowed" });
    }
    if (!allow(`c:${req.ip}`, 120, 6e4) || !allow(`p:${pixel.id}`, 6e3, 6e4)) {
      return reply.code(429).send({ success: false, error: "rate_limited" });
    }
    let body = {};
    if (req.body && typeof req.body === "object") body = req.body;
    else if (req.rawBody) {
      try {
        body = JSON.parse(req.rawBody);
      } catch {
        body = {};
      }
    }
    const eventName = mapEventName(String(body.event ?? body.event_name ?? "page_view"));
    if (!eventName) return reply.send({ success: true, queued: false, ignored: true });
    if (!BROWSER_EVENTS.includes(eventName)) {
      return reply.code(422).send({ success: false, error: `${eventName} must be sent via server webhook` });
    }
    let eventId = str(body.event_id, 200);
    if (!eventId || eventId.length > 128) eventId = randomUUID2();
    const isPageView = eventName === "PageView";
    const currency = isPageView ? null : normalizeCurrency(body.currency) ?? pixel.currency.trim();
    const valueMinor = !isPageView && currency && body.value !== void 0 ? parseAmount(body.value, currency, "major") : null;
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 512);
    const countryHeader = COUNTRY_HEADERS.map((h) => req.headers[h]).find((v) => typeof v === "string" && /^[A-Za-z]{2}$/.test(v));
    const utms = Object.fromEntries(UTM_KEYS.map((k) => [k, str(body[k], 255)]));
    const products = Array.isArray(body.products) ? body.products.slice(0, 50).map((p) => ({
      id: str(p?.id, 120),
      name: str(p?.name, 200),
      quantity: Number(p?.quantity ?? 1) || 1,
      priceMinor: currency ? parseAmount(p?.price, currency, "major") : null
    })) : [];
    const pageUrl = str(body.event_source_url, 1e3) ?? str(req.headers.referer, 1e3);
    const event = buildServerEvent({
      eventName,
      eventId,
      eventTime: Math.floor(ctx2.now().getTime() / 1e3),
      eventSourceUrl: pageUrl,
      customer: {
        email: str(body.email, 190),
        phone: str(body.phone, 40),
        firstName: str(body.first_name, 80),
        lastName: str(body.last_name, 120),
        document: str(body.document, 30) ?? str(body.cpf, 30),
        externalId: str(body.external_id, 100),
        city: str(body.city, 80),
        state: str(body.state, 80),
        zip: str(body.zip, 20),
        country: str(body.country, 2) ?? countryHeader ?? null
      },
      tracking: { fbp: str(body.fbp, 255), fbc: str(body.fbc, 255), clientIp: req.ip, userAgent: ua },
      valueMinor,
      currency,
      products,
      utms
    });
    const result = await tx(ctx2.db, async (c) => {
      const te = await c.query(
        `INSERT INTO tracking_events(org_id, pixel_id, event_name, event_id, source, value_minor, currency, page_url,
                                     utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, match_keys)
         VALUES ($1,$2,$3,$4,'browser',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (pixel_id, event_name, event_id) DO NOTHING RETURNING id`,
        [
          pixel.org_id,
          pixel.id,
          eventName,
          eventId,
          valueMinor,
          currency,
          pageUrl,
          ...UTM_KEYS.map((k) => utms[k]),
          Object.keys(event.user_data)
        ]
      );
      if (!te.rowCount) return { duplicate: true, queued: false };
      const xid = str(body.external_id, 100);
      if (xid) {
        await rememberIdentity(c, pixel.org_id, {
          xid,
          fbp: str(body.fbp, 255),
          fbc: str(body.fbc, 255),
          ip: req.ip,
          userAgent: ua,
          country: countryHeader ?? null,
          email: str(body.email, 190),
          phone: str(body.phone, 40),
          sourceUrl: pageUrl,
          utms,
          checkoutSeen: eventName === "InitiateCheckout" || eventName === "AddPaymentInfo"
        });
      }
      const queued = pixel.capi_token_enc ? await enqueueCapi(c, { orgId: pixel.org_id, pixelId: pixel.id, event, trackingEventId: te.rows[0].id }) !== null : false;
      return { duplicate: false, queued };
    });
    return reply.send({ success: true, ...result, event_id: eventId });
  }
  for (const path3 of ["/v1/collect", "/api/track.php"]) {
    app2.options(path3, async (req, reply) => {
      cors(req, reply);
      return reply.code(204).send();
    });
    app2.post(path3, collect);
    app2.get(path3, async (req, reply) => {
      cors(req, reply);
      return req.query.pt_ping ? { pong: true } : reply.code(405).send({ success: false, error: "Method not allowed" });
    });
  }
  async function pixelConfig(req, reply) {
    cors(req, reply);
    reply.header("Cache-Control", "no-store");
    const q = req.query ?? {};
    const productId = String(q.produto_id ?? q.product_id ?? q.offer_id ?? q.product_sku ?? q.produtoId ?? q.productId ?? "").replace(/\s+/g, "");
    if (!productId) return reply.code(400).send({ success: false, error: "Missing produto_id" });
    const key = String(q.key ?? q.k ?? "").trim();
    const sql = `SELECT p.meta_pixel_id, p.public_key, p.currency FROM pixel_products pp JOIN pixels p ON p.id = pp.pixel_id
                  WHERE pp.product_id = $1 AND p.active`;
    const r = key ? await ctx2.db.query(`${sql} AND pp.org_id = (SELECT org_id FROM pixels WHERE public_key = $2)`, [productId, key]) : await ctx2.db.query(`${sql} LIMIT 2`, [productId]);
    if (r.rowCount !== 1) {
      if ((r.rowCount ?? 0) > 1) ctx2.log.warn({ productId }, "pixel-config legado amb\xEDguo entre organiza\xE7\xF5es");
      return reply.code(404).send({ success: false, error: "No pixel for this product" });
    }
    const p = r.rows[0];
    return {
      success: true,
      pixel_id: p.meta_pixel_id,
      public_key: p.public_key,
      currency: String(p.currency).trim(),
      endpoint: `${ctx2.config.PUBLIC_API_URL}/v1/collect`
    };
  }
  for (const path3 of ["/v1/pixel-config", "/api/pixel-config.php"]) {
    app2.options(path3, async (req, reply) => {
      cors(req, reply);
      return reply.code(204).send();
    });
    app2.get(path3, pixelConfig);
  }
}

// src/reports/routes.ts
import { z as z7 } from "zod";

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
async function requeue(ctx2, orgId, filter) {
  const r = await ctx2.db.query(
    `UPDATE capi_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, last_error_class = NULL
      WHERE org_id = $1 AND status = 'dead' AND ($2::bigint IS NULL OR id = $2)`,
    [orgId, filter.all ? null : filter.id ?? -1]
  );
  return r.rowCount ?? 0;
}

// src/fx/service.ts
var LOOKBACK_DAYS = 10;
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
var FxTable = class _FxTable {
  byQuote = /* @__PURE__ */ new Map();
  static async load(db, currencies, since, until) {
    const t = new _FxTable();
    const list = [...new Set(currencies.filter((c) => c && c !== "EUR"))];
    if (list.length) {
      const r = await db.query(
        `SELECT rate_date::text AS date, quote, rate::text AS rate, source FROM fx_rates
          WHERE base = 'EUR' AND quote = ANY($1) AND rate_date BETWEEN ($2::date - $4::int) AND $3::date
          ORDER BY quote, rate_date`,
        [list, since, until, LOOKBACK_DAYS]
      );
      for (const row of r.rows) {
        const arr = t.byQuote.get(row.quote) ?? [];
        arr.push({ date: row.date, rate: row.rate, source: row.source });
        t.byQuote.set(row.quote, arr);
      }
    }
    return t;
  }
  /** Cotação EUR→currency válida na data (última até a data, dentro da janela). */
  eurTo(currency, date) {
    if (currency === "EUR") return { rate: "1", date, source: "identity" };
    const arr = this.byQuote.get(currency);
    if (!arr) return null;
    let best = null;
    for (const r of arr) if (r.date <= date) best = r;
    if (!best) return null;
    const ageDays = (Date.parse(date) - Date.parse(best.date)) / 864e5;
    return ageDays <= LOOKBACK_DAYS ? best : null;
  }
  quote(from, to, date) {
    if (from === to) return { base: from, quote: to, rate: "1", rateDate: date, source: "identity" };
    const a = this.eurTo(from, date);
    const b = this.eurTo(to, date);
    if (!a || !b) return null;
    return { base: from, quote: to, rate: crossRate(a.rate, b.rate), rateDate: a.date > b.date ? a.date : b.date, source: `${a.source}/${b.source}` };
  }
  convert(amountMinor, from, to, date) {
    return convertWithQuote(amountMinor, from, to, this.quote(from, to, date));
  }
};

// src/meta/routes.ts
import { z as z6 } from "zod";

// src/meta/client.ts
import { createHmac as createHmac3 } from "node:crypto";
var MetaApiError = class extends Error {
  constructor(message, code, httpStatus, fbtraceId) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.fbtraceId = fbtraceId;
  }
  get isTokenError() {
    return this.code === 190 || this.code === 102;
  }
  get isRateLimit() {
    return this.code !== null && [4, 17, 32, 613, 8e4, 80003, 80004].includes(this.code);
  }
  get isPermission() {
    return this.code === 10 || this.code === 200 || this.code !== null && this.code >= 200 && this.code < 300;
  }
};
var INSIGHT_FIELDS = "spend,impressions,clicks,inline_link_clicks,ctr,cpc,actions,action_values,account_currency";
function extractPurchase(actions) {
  const map = /* @__PURE__ */ new Map();
  for (const a of Array.isArray(actions) ? actions : []) if (a?.action_type) map.set(String(a.action_type), Number(a.value ?? 0));
  for (const t of ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase", "web_in_store_purchase"]) {
    if (map.has(t)) return map.get(t);
  }
  return 0;
}
function extractAction(actions, type) {
  for (const a of Array.isArray(actions) ? actions : []) if (a?.action_type === type) return Number(a.value ?? 0);
  return 0;
}
function metricsFromInsight(i) {
  const x = i ?? {};
  return {
    spend: String(x.spend ?? "0"),
    impressions: Number(x.impressions ?? 0),
    clicks: Number(x.clicks ?? 0),
    linkClicks: Number(x.inline_link_clicks ?? 0),
    landingPageViews: extractAction(x.actions, "landing_page_view"),
    purchases: extractPurchase(x.actions),
    revenue: String(extractPurchase(x.action_values)),
    ctr: Number(x.ctr ?? 0),
    cpc: String(x.cpc ?? "0"),
    currency: x.account_currency ? String(x.account_currency).toUpperCase() : null
  };
}
var MetaClient = class {
  constructor(ctx2, token) {
    this.ctx = ctx2;
    this.token = token;
  }
  get base() {
    return `${this.ctx.config.META_GRAPH_BASE_URL}/${this.ctx.config.META_GRAPH_VERSION}`;
  }
  withProof(params) {
    if (this.ctx.config.META_APP_SECRET) {
      params.set("appsecret_proof", createHmac3("sha256", this.ctx.config.META_APP_SECRET).update(this.token).digest("hex"));
    }
  }
  async request(method, urlOrPath, params = {}) {
    const url = new URL(urlOrPath.startsWith("http") ? urlOrPath : this.base + urlOrPath);
    const body = new URLSearchParams();
    const target = method === "GET" ? url.searchParams : body;
    for (const [k, v] of Object.entries(params)) target.set(k, v);
    if (!url.searchParams.has("appsecret_proof")) this.withProof(method === "GET" ? url.searchParams : body);
    let res;
    try {
      res = await this.ctx.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {} },
        body: method === "POST" ? body : void 0,
        signal: AbortSignal.timeout(3e4)
      });
    } catch (e) {
      throw new MetaApiError(`Falha de conex\xE3o com a Meta: ${e.message}`, null, 0);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      const err = json?.error ?? {};
      throw new MetaApiError(String(err.error_user_msg ?? err.message ?? `HTTP ${res.status}`), typeof err.code === "number" ? err.code : null, res.status, err.fbtrace_id);
    }
    return json;
  }
  async getAll(path3, params, maxPages = 50) {
    const first = await this.request("GET", path3, params);
    const data = [...first.data ?? []];
    let next = first.paging?.next;
    for (let i = 0; next && i < maxPages; i++) {
      const page = await this.request("GET", next);
      data.push(...page.data ?? []);
      next = page.paging?.next;
    }
    return data;
  }
  me() {
    return this.request("GET", "/me", { fields: "id,name" });
  }
  async permissions() {
    const r = await this.request("GET", "/me/permissions");
    return (r.data ?? []).filter((p) => p.status === "granted").map((p) => String(p.permission));
  }
  adAccounts() {
    return this.getAll("/me/adaccounts", { fields: "account_id,name,account_status,currency,timezone_name", limit: "200" });
  }
  /** Insights diários da conta (inclui campanhas excluídas/arquivadas — bate com o Gerenciador). */
  accountInsightsDaily(accountId, since, until) {
    return this.getAll(`/${accountId}/insights`, {
      level: "account",
      time_increment: "1",
      fields: `${INSIGHT_FIELDS},date_start`,
      time_range: JSON.stringify({ since, until }),
      limit: "500"
    });
  }
  campaigns(accountId, since, until) {
    return this.getAll(`/${accountId}/campaigns`, {
      fields: `id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){${INSIGHT_FIELDS}}`,
      limit: "200"
    });
  }
  adsets(accountId, since, until, campaignIds = []) {
    const params = {
      fields: `id,name,status,effective_status,campaign_id,campaign{name},daily_budget,lifetime_budget,insights.time_range(${JSON.stringify({ since, until })}){${INSIGHT_FIELDS}}`,
      limit: "500"
    };
    if (campaignIds.length) params.filtering = JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]);
    return this.getAll(`/${accountId}/adsets`, params);
  }
  updateStatus(id, status) {
    return this.request("POST", `/${id}`, { status });
  }
  duplicate(id, type) {
    return this.request("POST", `/${id}/copies`, { status_option: "PAUSED", ...type === "adset" ? { deep_copy: "true" } : {} });
  }
  /** Orçamento em unidade mínima da MOEDA DA CONTA (sem conversão — corrige P-25/P-27). */
  updateBudget(id, field, amountMinor) {
    return this.request("POST", `/${id}`, { [field]: amountMinor.toString() });
  }
};
function metaAuthUrl(ctx2, state) {
  const p = new URLSearchParams({
    client_id: ctx2.config.META_APP_ID,
    redirect_uri: metaRedirectUri(ctx2),
    state,
    response_type: "code"
  });
  if (ctx2.config.META_LOGIN_CONFIG_ID) p.set("config_id", ctx2.config.META_LOGIN_CONFIG_ID);
  else p.set("scope", "ads_read,ads_management");
  return `https://www.facebook.com/${ctx2.config.META_GRAPH_VERSION}/dialog/oauth?${p.toString()}`;
}
var metaRedirectUri = (ctx2) => `${ctx2.config.PUBLIC_API_URL}/v1/meta/callback`;
async function exchangeCode(ctx2, code) {
  const base = `${ctx2.config.META_GRAPH_BASE_URL}/${ctx2.config.META_GRAPH_VERSION}/oauth/access_token`;
  const call = async (params) => {
    const res = await ctx2.fetch(`${base}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(2e4) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error || !j.access_token) {
      throw new MetaApiError(String(j?.error?.message ?? `HTTP ${res.status}`), j?.error?.code ?? null, res.status);
    }
    return j;
  };
  const short = await call({
    client_id: ctx2.config.META_APP_ID,
    client_secret: ctx2.config.META_APP_SECRET,
    redirect_uri: metaRedirectUri(ctx2),
    code
  });
  let long = short;
  try {
    long = await call({
      grant_type: "fb_exchange_token",
      client_id: ctx2.config.META_APP_ID,
      client_secret: ctx2.config.META_APP_SECRET,
      fb_exchange_token: short.access_token
    });
  } catch (e) {
    ctx2.log.warn({ err: String(e) }, "troca por token longo falhou; usando token curto");
  }
  const exp = Number(long.expires_in ?? 0);
  return { token: long.access_token, expiresAt: exp > 0 ? new Date(ctx2.now().getTime() + exp * 1e3) : null };
}
var normalizeAccountId = (id) => {
  const t = id.trim();
  return t.startsWith("act_") ? t : `act_${t.replace(/\D+/g, "")}`;
};

// src/meta/service.ts
async function getConnection(ctx2, orgId) {
  const r = await ctx2.db.query(
    "SELECT access_token_enc, selected_ad_account_id, ad_account_currency, status, token_expires_at, scopes FROM meta_connections WHERE org_id = $1",
    [orgId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    client: new MetaClient(ctx2, ctx2.box.decrypt(row.access_token_enc)),
    accountId: row.selected_ad_account_id,
    accountCurrency: row.ad_account_currency?.trim() ?? null,
    status: row.status,
    expiresAt: row.token_expires_at,
    scopes: row.scopes
  };
}
async function handleMetaError(ctx2, orgId, e) {
  if (e instanceof MetaApiError && e.isTokenError) {
    await ctx2.db.query(`UPDATE meta_connections SET status = 'expired', last_error = $2, updated_at = now() WHERE org_id = $1`, [orgId, e.message]);
    await raiseAlert(ctx2.db, orgId, {
      kind: "meta_token",
      severity: "critical",
      dedupKey: "meta_token",
      title: "Conex\xE3o com o Facebook Ads expirou ou foi revogada",
      detail: "Reconecte a conta em Integra\xE7\xF5es \u2192 Meta Ads."
    });
  } else if (e instanceof MetaApiError) {
    await ctx2.db.query("UPDATE meta_connections SET last_error = $2, updated_at = now() WHERE org_id = $1", [orgId, e.message]);
  }
  throw e;
}
async function cached(ctx2, orgId, key, ttlSec, load) {
  const r = await ctx2.db.query(
    "SELECT data FROM meta_insights_cache WHERE org_id = $1 AND cache_key = $2 AND fetched_at > now() - make_interval(secs => $3)",
    [orgId, key, ttlSec]
  );
  if (r.rows[0]) return r.rows[0].data;
  const data = await load();
  await ctx2.db.query(
    `INSERT INTO meta_insights_cache(org_id, cache_key, data) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, cache_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
    [orgId, key, JSON.stringify(data)]
  );
  return data;
}
var ttlFor = (until) => until >= localDate(/* @__PURE__ */ new Date(), "UTC") ? 300 : 6 * 3600;
async function accountDaily(ctx2, orgId, since, until) {
  const conn = await getConnection(ctx2, orgId);
  if (!conn || !conn.accountId || conn.status !== "active") return null;
  try {
    const rows = await cached(ctx2, orgId, `daily:${conn.accountId}:${since}:${until}`, ttlFor(until), () => conn.client.accountInsightsDaily(conn.accountId, since, until));
    const days = rows.map((r) => ({ ...metricsFromInsight(r), date: String(r.date_start) }));
    return { currency: days[0]?.currency ?? conn.accountCurrency ?? "BRL", days };
  } catch (e) {
    return handleMetaError(ctx2, orgId, e);
  }
}
async function entities(ctx2, orgId, level, since, until, campaignIds = []) {
  const conn = await getConnection(ctx2, orgId);
  if (!conn || !conn.accountId || conn.status !== "active") return null;
  try {
    const key = `${level}:${conn.accountId}:${since}:${until}:${campaignIds.join(",")}`;
    const raw = await cached(ctx2, orgId, key, Math.min(ttlFor(until), 120), () => level === "campaign" ? conn.client.campaigns(conn.accountId, since, until) : conn.client.adsets(conn.accountId, since, until, campaignIds));
    const currency = conn.accountCurrency ?? "BRL";
    const rows = raw.map((c) => ({
      ...metricsFromInsight(c.insights?.data?.[0]),
      currency,
      id: String(c.id),
      name: String(c.name ?? ""),
      status: String(c.status ?? ""),
      effectiveStatus: String(c.effective_status ?? c.status ?? ""),
      objective: c.objective,
      campaignId: c.campaign_id,
      campaignName: c.campaign?.name,
      dailyBudgetMinor: c.daily_budget != null ? String(c.daily_budget) : null,
      lifetimeBudgetMinor: c.lifetime_budget != null ? String(c.lifetime_budget) : null
    }));
    return { currency, rows };
  } catch (e) {
    return handleMetaError(ctx2, orgId, e);
  }
}
var metaMoneyToMinor = (v, currency) => parseAmount(v, currency, "major") ?? 0n;
async function invalidateCache(ctx2, orgId) {
  await ctx2.db.query("DELETE FROM meta_insights_cache WHERE org_id = $1", [orgId]);
}

// src/meta/routes.ts
var periodQuery = z6.object({
  preset: z6.enum(["today", "yesterday", "last_7d", "last_30d", "last_90d", "this_month", "custom"]).default("today"),
  since: z6.string().optional(),
  until: z6.string().optional()
});
function metaError(e) {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) throw new AppError(409, "meta_token_expired", "A conex\xE3o com o Facebook Ads expirou ou foi revogada. Reconecte a conta.");
    if (e.isRateLimit) throw new AppError(429, "meta_rate_limited", "Limite de chamadas da Meta atingido. Tente novamente em alguns minutos.");
    if (e.isPermission) throw new AppError(403, "meta_permission", `A Meta recusou a opera\xE7\xE3o por permiss\xE3o: ${e.message}. Reconecte concedendo "ads_management".`);
    throw new AppError(502, "meta_error", `Erro da Meta: ${e.message}`);
  }
  throw e;
}
function metaRoutes(app2, ctx2) {
  const configured = () => !!ctx2.config.META_APP_ID && !!ctx2.config.META_APP_SECRET;
  app2.get("/v1/meta/status", async (req) => {
    const a = requireRole(req, "viewer");
    const r = await ctx2.db.query(
      "SELECT selected_ad_account_id, ad_account_currency, status, token_expires_at, scopes, last_error, updated_at FROM meta_connections WHERE org_id = $1",
      [a.org.id]
    );
    return {
      appConfigured: configured(),
      loginMode: ctx2.config.META_LOGIN_CONFIG_ID ? "business_login" : "classic",
      redirectUri: metaRedirectUri(ctx2),
      graphVersion: ctx2.config.META_GRAPH_VERSION,
      connection: r.rows[0] ?? null
    };
  });
  app2.post("/v1/meta/connect", async (req) => {
    const a = requireRole(req, "admin");
    if (!configured()) throw badRequest("META_APP_ID e META_APP_SECRET n\xE3o est\xE3o configurados no servidor.");
    const state = randomToken(24);
    await ctx2.db.query(`INSERT INTO oauth_states(state, org_id, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`, [state, a.org.id, a.user.id]);
    return { url: metaAuthUrl(ctx2, state) };
  });
  app2.get("/v1/meta/callback", async (req, reply) => {
    const q = req.query;
    const back = (params) => reply.redirect(`${ctx2.config.APP_URL}/integracoes/meta?${new URLSearchParams(params)}`);
    const st = await ctx2.db.query("DELETE FROM oauth_states WHERE state = $1 AND expires_at > now() RETURNING org_id, user_id", [q.state ?? ""]);
    const row = st.rows[0];
    if (!row) return back({ error: "Falha de valida\xE7\xE3o do OAuth (state inv\xE1lido ou expirado). Tente novamente." });
    if (req.auth && req.auth.user.id !== row.user_id) return back({ error: "Sess\xE3o diferente da que iniciou a conex\xE3o." });
    if (q.error || !q.code) return back({ error: `Conex\xE3o cancelada: ${q.error_description ?? q.error ?? "sem c\xF3digo"}` });
    try {
      const tok = await exchangeCode(ctx2, q.code);
      const client2 = new MetaClient(ctx2, tok.token);
      const scopes = await client2.permissions().catch(() => []);
      await ctx2.db.query(
        `INSERT INTO meta_connections(org_id, connected_by, access_token_enc, token_expires_at, scopes, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (org_id) DO UPDATE SET connected_by = EXCLUDED.connected_by, access_token_enc = EXCLUDED.access_token_enc,
           token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes, status = 'active', last_error = NULL, updated_at = now()`,
        [row.org_id, row.user_id, ctx2.box.encrypt(tok.token), tok.expiresAt, scopes]
      );
      await invalidateCache(ctx2, row.org_id);
      await resolveAlert(ctx2.db, row.org_id, "meta_token");
      await audit(ctx2, row.org_id, row.user_id, "meta.connected", void 0, { scopes });
      return back({ connected: "1" });
    } catch (e) {
      return back({ error: `N\xE3o foi poss\xEDvel conectar: ${e.message}` });
    }
  });
  app2.post("/v1/meta/disconnect", async (req) => {
    const a = requireRole(req, "admin");
    await ctx2.db.query("DELETE FROM meta_connections WHERE org_id = $1", [a.org.id]);
    await invalidateCache(ctx2, a.org.id);
    await audit(ctx2, a.org.id, a.user.id, "meta.disconnected");
    return { ok: true };
  });
  app2.get("/v1/meta/ad-accounts", async (req) => {
    const a = requireRole(req, "viewer");
    const conn = await getConnection(ctx2, a.org.id);
    if (!conn) return { accounts: [], selected: null };
    try {
      const accounts = await conn.client.adAccounts();
      return {
        selected: conn.accountId,
        accounts: accounts.map((x) => ({ id: normalizeAccountId(String(x.account_id)), name: x.name, currency: x.currency, status: x.account_status, timezone: x.timezone_name }))
      };
    } catch (e) {
      return handleMetaError(ctx2, a.org.id, e).catch(metaError);
    }
  });
  app2.post("/v1/meta/ad-account", async (req) => {
    const a = requireRole(req, "admin");
    const { accountId, currency } = parse(z6.object({ accountId: z6.string().min(3).max(40), currency: z6.string().regex(/^[A-Z]{3}$/) }), req.body);
    const r = await ctx2.db.query(
      "UPDATE meta_connections SET selected_ad_account_id = $2, ad_account_currency = $3, updated_at = now() WHERE org_id = $1",
      [a.org.id, normalizeAccountId(accountId), currency]
    );
    if (!r.rowCount) throw badRequest("Conecte o Facebook Ads antes.");
    await invalidateCache(ctx2, a.org.id);
    await audit(ctx2, a.org.id, a.user.id, "meta.ad_account_selected", accountId);
    return { ok: true };
  });
  app2.get("/v1/meta/campaigns", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({
      level: z6.enum(["campaign", "adset"]).default("campaign"),
      campaignIds: z6.string().optional()
    }), req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const campaignIds = (q.campaignIds ?? "").split(",").map((s) => s.replace(/\D+/g, "")).filter(Boolean);
    let data;
    try {
      data = await entities(ctx2, a.org.id, q.level, w.since, w.until, campaignIds);
    } catch (e) {
      metaError(e);
    }
    if (!data) return { connected: false, rows: [] };
    const rep = a.org.reporting_currency;
    let adsetMap = /* @__PURE__ */ new Map();
    if (q.level === "campaign") {
      const adsets = await entities(ctx2, a.org.id, "adset", w.since, w.until).catch(() => null);
      adsetMap = new Map((adsets?.rows ?? []).flatMap((s) => [[`id:${s.id}`, s.campaignId ?? ""], [`name:${s.name.toLowerCase()}`, s.campaignId ?? ""]]));
    }
    const pays = await ctx2.db.query(
      `SELECT amount_minor, currency, approved_at, utm_campaign, utm_content, utm_term, utm_medium, utm_id
         FROM payments WHERE org_id = $1 AND status = 'approved' AND approved_at >= $2 AND approved_at < $3`,
      [a.org.id, w.startUtc, w.endUtc]
    );
    const fx = await FxTable.load(ctx2.db, [rep, data.currency, ...pays.rows.map((p) => String(p.currency ?? "").trim())], w.since, w.until);
    const acc = data.rows.map(() => ({ sales: 0, revenue: 0n, unconverted: 0 }));
    const rows = data.rows.map((r) => ({ id: r.id, name: r.name }));
    for (const p of pays.rows) {
      const values = [p.utm_campaign, p.utm_content, p.utm_term, p.utm_medium, p.utm_id].filter(Boolean);
      if (q.level === "campaign") {
        for (const v of [...values]) {
          const parent = adsetMap.get(`id:${v}`) ?? adsetMap.get(`name:${String(v).toLowerCase()}`);
          if (parent) {
            values.push(parent);
            break;
          }
        }
      }
      const i = matchUtmToRow(values, rows);
      if (i < 0) continue;
      acc[i].sales++;
      if (p.amount_minor != null && p.currency) {
        const conv2 = fx.convert(BigInt(p.amount_minor), String(p.currency).trim(), rep, p.approved_at.toISOString().slice(0, 10));
        if (conv2.converted) acc[i].revenue += conv2.amountMinor;
        else acc[i].unconverted++;
      }
    }
    const fxDate = w.until;
    const conv = (v) => fx.convert(metaMoneyToMinor(v, data.currency), data.currency, rep, fxDate);
    const metaConvertible = fx.quote(data.currency, rep, fxDate) !== null;
    return jsonSafe({
      connected: true,
      window: { since: w.since, until: w.until },
      accountCurrency: data.currency,
      reportingCurrency: rep,
      fx: { date: fxDate, converted: metaConvertible, rate: fx.quote(data.currency, rep, fxDate)?.rate ?? null },
      rows: data.rows.map((r, i) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        effectiveStatus: r.effectiveStatus,
        objective: r.objective,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        budget: r.dailyBudgetMinor != null ? { type: "daily", amountMinor: r.dailyBudgetMinor, currency: data.currency } : r.lifetimeBudgetMinor != null ? { type: "lifetime", amountMinor: r.lifetimeBudgetMinor, currency: data.currency } : null,
        spendMinor: conv(r.spend).amountMinor,
        cpcMinor: conv(r.cpc).amountMinor,
        impressions: r.impressions,
        clicks: r.clicks,
        linkClicks: r.linkClicks,
        landingPageViews: r.landingPageViews,
        ctr: r.ctr,
        meta: { purchases: r.purchases, revenueMinor: conv(r.revenue).amountMinor },
        tracked: { sales: acc[i].sales, revenueMinor: acc[i].revenue, unconverted: acc[i].unconverted }
      }))
    });
  });
  const entityParams = z6.object({ id: z6.string().regex(/^\d{5,30}$/) });
  async function client(orgId) {
    const conn = await getConnection(ctx2, orgId);
    if (!conn) throw badRequest("Conecte o Facebook Ads antes.");
    return conn;
  }
  app2.post("/v1/meta/entities/:id/status", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(entityParams, req.params);
    const { status } = parse(z6.object({ status: z6.enum(["ACTIVE", "PAUSED"]) }), req.body);
    const conn = await client(a.org.id);
    try {
      await conn.client.updateStatus(id, status);
    } catch (e) {
      metaError(e);
    }
    await invalidateCache(ctx2, a.org.id);
    await audit(ctx2, a.org.id, a.user.id, "meta.status_changed", id, { status });
    return { ok: true, status };
  });
  app2.post("/v1/meta/entities/:id/duplicate", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(entityParams, req.params);
    const { type } = parse(z6.object({ type: z6.enum(["campaign", "adset"]) }), req.body);
    const conn = await client(a.org.id);
    let res;
    try {
      res = await conn.client.duplicate(id, type);
    } catch (e) {
      metaError(e);
    }
    await invalidateCache(ctx2, a.org.id);
    await audit(ctx2, a.org.id, a.user.id, "meta.duplicated", id, { type });
    return { ok: true, newId: String(res?.copied_campaign_id ?? res?.copied_adset_id ?? res?.id ?? "") };
  });
  app2.post("/v1/meta/entities/:id/budget", async (req) => {
    const a = requireRole(req, "admin");
    const { id } = parse(entityParams, req.params);
    const b = parse(z6.object({ type: z6.enum(["daily", "lifetime"]), amount: z6.string().min(1).max(20) }), req.body);
    const conn = await client(a.org.id);
    const cur = conn.accountCurrency;
    if (!cur) throw badRequest("Selecione a conta de an\xFAncios novamente para identificar a moeda.");
    const minor = parseAmount(b.amount, cur, "major");
    if (minor === null || minor <= 0n) throw badRequest("Valor de or\xE7amento inv\xE1lido.");
    try {
      await conn.client.updateBudget(id, b.type === "daily" ? "daily_budget" : "lifetime_budget", minor);
    } catch (e) {
      metaError(e);
    }
    await invalidateCache(ctx2, a.org.id);
    await audit(ctx2, a.org.id, a.user.id, "meta.budget_changed", id, { type: b.type, amountMinor: minor.toString(), currency: cur });
    return { ok: true, amountMinor: minor.toString(), currency: cur, exponent: currencyExponent(cur) };
  });
}

// src/reports/dashboard.ts
var empty = () => ({ count: 0, amountMinor: 0n, unconverted: 0 });
async function salesBuckets(ctx2, org, w, f, fx, column, statusFilter) {
  const r = await ctx2.db.query(
    `SELECT to_char((${column} AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, currency, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
       FROM payments
      WHERE org_id = $1 AND ${column} >= $2 AND ${column} < $3 AND ${statusFilter}
        AND ($5::uuid IS NULL OR pixel_id = $5) AND ($6::text IS NULL OR provider = $6)
      GROUP BY 1, 2`,
    [org.id, w.startUtc, w.endUtc, org.timezone, f.pixelId ?? null, f.provider ?? null]
  );
  const total = empty();
  const byDay = /* @__PURE__ */ new Map();
  for (const row of r.rows) {
    const day = row.day;
    const b = byDay.get(day) ?? empty();
    b.count += row.n;
    total.count += row.n;
    if (row.currency) {
      const c = fx.convert(BigInt(row.amount), String(row.currency).trim(), org.reporting_currency, day);
      if (c.converted) {
        b.amountMinor += c.amountMinor;
        total.amountMinor += c.amountMinor;
      } else {
        b.unconverted += row.n;
        total.unconverted += row.n;
      }
    }
    byDay.set(day, b);
  }
  return { total, byDay };
}
async function currenciesInUse(ctx2, orgId) {
  const r = await ctx2.db.query("SELECT DISTINCT currency FROM payments WHERE org_id = $1 AND currency IS NOT NULL", [orgId]);
  return r.rows.map((x) => String(x.currency).trim());
}
async function windowKpis(ctx2, org, w, f, withMeta) {
  const meta = withMeta && !f.pixelId && !f.provider ? await accountDaily(ctx2, org.id, w.since, w.until).catch(() => null) : null;
  const fx = await FxTable.load(ctx2.db, [org.reporting_currency, ...await currenciesInUse(ctx2, org.id), meta?.currency ?? ""], w.since, w.until);
  const confirmed = await salesBuckets(ctx2, org, w, f, fx, "approved_at", `status = 'approved'`);
  const reversed = await salesBuckets(ctx2, org, w, f, fx, "reversed_at", `status IN ('refunded', 'chargeback') AND approved_at IS NOT NULL`);
  const created = await ctx2.db.query(
    `SELECT status, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount, max(currency) AS any_currency, count(DISTINCT currency)::int AS currencies
       FROM payments WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
        AND ($4::uuid IS NULL OR pixel_id = $4) AND ($5::text IS NULL OR provider = $5)
      GROUP BY status`,
    [org.id, w.startUtc, w.endUtc, f.pixelId ?? null, f.provider ?? null]
  );
  const byStatus = Object.fromEntries(created.rows.map((r) => [r.status, r.n]));
  const createdTotal = created.rows.reduce((n, r) => n + r.n, 0);
  const approvedLike = (byStatus.approved ?? 0) + (byStatus.refunded ?? 0) + (byStatus.chargeback ?? 0);
  const pendingRow = created.rows.find((r) => r.status === "pending");
  let spendMinor = 0n;
  let metaPurchases = 0;
  let metaRevenueMinor = 0n;
  let linkClicks = 0;
  let lpv = 0;
  let spendUnconvertedDays = 0;
  const spendByDay = /* @__PURE__ */ new Map();
  if (meta) {
    for (const d of meta.days) {
      const s = fx.convert(metaMoneyToMinor(d.spend, meta.currency), meta.currency, org.reporting_currency, d.date);
      const rv = fx.convert(metaMoneyToMinor(d.revenue, meta.currency), meta.currency, org.reporting_currency, d.date);
      if (s.converted) {
        spendMinor += s.amountMinor;
        spendByDay.set(d.date, s.amountMinor);
      } else spendUnconvertedDays++;
      if (rv.converted) metaRevenueMinor += rv.amountMinor;
      metaPurchases += d.purchases;
      linkClicks += d.linkClicks;
      lpv += d.landingPageViews;
    }
  }
  const funnel = await ctx2.db.query(
    `SELECT event_name, count(*)::int AS n FROM tracking_events
      WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)
        AND event_name IN ('PageView', 'InitiateCheckout') GROUP BY event_name`,
    [org.id, w.startUtc, w.endUtc, f.pixelId ?? null]
  );
  const ev = Object.fromEntries(funnel.rows.map((r) => [r.event_name, r.n]));
  const revenue = confirmed.total.amountMinor;
  const sales = confirmed.total.count;
  return {
    window: { since: w.since, until: w.until, days: w.days },
    sales,
    revenueMinor: revenue,
    refunds: { count: reversed.total.count, amountMinor: reversed.total.amountMinor },
    pending: { count: byStatus.pending ?? 0, amountMinor: pendingRow?.currencies === 1 ? BigInt(pendingRow.amount) : null, currency: pendingRow?.currencies === 1 ? String(pendingRow.any_currency).trim() : null },
    canceledOrFailed: (byStatus.canceled ?? 0) + (byStatus.failed ?? 0),
    paymentsCreated: createdTotal,
    approvalRate: createdTotal ? approvedLike / createdTotal : null,
    unconvertedSales: confirmed.total.unconverted,
    averageTicketMinor: sales ? revenue / BigInt(sales) : null,
    meta: meta ? { connected: true, accountCurrency: meta.currency, spendMinor, purchases: metaPurchases, revenueMinor: metaRevenueMinor, linkClicks, landingPageViews: lpv, unconvertedDays: spendUnconvertedDays } : { connected: false },
    cpaMinor: meta && sales ? spendMinor / BigInt(sales) : null,
    roas: meta && spendMinor > 0n ? Number(revenue) / Number(spendMinor) : null,
    profitMinor: meta ? revenue - spendMinor : null,
    funnel: { linkClicks: meta ? linkClicks : null, landingPageViews: meta ? lpv : null, pageViews: ev.PageView ?? 0, initiateCheckouts: ev.InitiateCheckout ?? 0, sales },
    conversionRate: (ev.PageView ?? 0) > 0 ? sales / (ev.PageView ?? 1) : null,
    series: eachDay(w.since, w.until).map((day) => ({
      day,
      sales: confirmed.byDay.get(day)?.count ?? 0,
      revenueMinor: confirmed.byDay.get(day)?.amountMinor ?? 0n,
      refundsMinor: reversed.byDay.get(day)?.amountMinor ?? 0n,
      spendMinor: spendByDay.get(day) ?? (meta ? 0n : null)
    }))
  };
}
async function dashboard(ctx2, org, q) {
  const w = reportWindow(q.preset, org.timezone, { now: ctx2.now(), since: q.since, until: q.until });
  const filters = { pixelId: q.pixelId, provider: q.provider };
  const [current, previous] = await Promise.all([
    windowKpis(ctx2, org, w, filters, true),
    windowKpis(ctx2, org, previousWindow(w), filters, true)
  ]);
  const fxToday = await FxTable.load(ctx2.db, [org.reporting_currency, ...await currenciesInUse(ctx2, org.id)], reportWindow("this_month", org.timezone, { now: ctx2.now() }).since, reportWindow("today", org.timezone, { now: ctx2.now() }).until);
  const today = await salesBuckets(ctx2, org, reportWindow("today", org.timezone, { now: ctx2.now() }), {}, fxToday, "approved_at", `status = 'approved'`);
  const month = await salesBuckets(ctx2, org, reportWindow("this_month", org.timezone, { now: ctx2.now() }), {}, fxToday, "approved_at", `status = 'approved'`);
  const capi = await ctx2.db.query(
    `SELECT status, count(*)::int AS n FROM capi_outbox WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
        AND ($4::uuid IS NULL OR pixel_id = $4) GROUP BY status`,
    [org.id, w.startUtc, w.endUtc, q.pixelId ?? null]
  );
  const tracked = await ctx2.db.query(
    "SELECT count(*)::int AS n FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)",
    [org.id, w.startUtc, w.endUtc, q.pixelId ?? null]
  );
  const alerts = await ctx2.db.query(`SELECT count(*)::int AS n FROM alerts WHERE org_id = $1 AND resolved_at IS NULL`, [org.id]);
  return {
    reportingCurrency: org.reporting_currency,
    timezone: org.timezone,
    current,
    previous,
    goals: {
      daily: { goalMinor: org.goal_daily_minor, achievedMinor: today.total.amountMinor },
      monthly: { goalMinor: org.goal_monthly_minor, achievedMinor: month.total.amountMinor }
    },
    events: {
      received: tracked.rows[0]?.n ?? 0,
      capi: Object.fromEntries(capi.rows.map((r) => [r.status, r.n]))
    },
    openAlerts: alerts.rows[0]?.n ?? 0
  };
}

// src/reports/routes.ts
var uuidOpt = z7.string().uuid().optional();
function reportRoutes(app2, ctx2) {
  app2.get("/v1/reports/dashboard", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({ pixelId: uuidOpt, provider: z7.string().max(20).optional() }), req.query);
    return jsonSafe(await dashboard(ctx2, a.org, { ...q, preset: q.preset }));
  });
  app2.get("/v1/payments", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({
      status: z7.enum(["pending", "approved", "refunded", "chargeback", "canceled", "failed"]).optional(),
      provider: z7.string().max(20).optional(),
      pixelId: uuidOpt,
      search: z7.string().max(128).optional(),
      page: z7.coerce.number().int().min(1).max(1e4).default(1)
    }), req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const params = [a.org.id, w.startUtc, w.endUtc, q.status ?? null, q.provider ?? null, q.pixelId ?? null, q.search ? `%${q.search}%` : null];
    const where = `p.org_id = $1 AND p.created_at >= $2 AND p.created_at < $3 AND ($4::text IS NULL OR p.status = $4)
                   AND ($5::text IS NULL OR p.provider = $5) AND ($6::uuid IS NULL OR p.pixel_id = $6)
                   AND ($7::text IS NULL OR p.transaction_id ILIKE $7)`;
    const total = await ctx2.db.query(`SELECT count(*)::int AS n FROM payments p WHERE ${where}`, params);
    const rows = await ctx2.db.query(
      `SELECT p.id, p.provider, p.transaction_id, p.status, p.amount_minor, p.currency, p.utm_source, p.utm_campaign, p.utm_content,
              p.created_at, p.approved_at, p.reversed_at, px.name AS pixel_name,
              (SELECT status FROM capi_outbox o WHERE o.payment_id = p.id AND o.event_name = 'Purchase' LIMIT 1) AS purchase_capi_status
         FROM payments p LEFT JOIN pixels px ON px.id = p.pixel_id
        WHERE ${where} ORDER BY p.created_at DESC LIMIT 50 OFFSET $8`,
      [...params, (q.page - 1) * 50]
    );
    return jsonSafe({ total: total.rows[0]?.n ?? 0, page: q.page, pageSize: 50, payments: rows.rows });
  });
  app2.get("/v1/payments/:id", async (req) => {
    const a = requireRole(req, "viewer");
    const { id } = parse(z7.object({ id: z7.string().uuid() }), req.params);
    const p = await ctx2.db.query(
      `SELECT p.*, px.name AS pixel_name FROM payments p LEFT JOIN pixels px ON px.id = p.pixel_id WHERE p.id = $1 AND p.org_id = $2`,
      [id, a.org.id]
    );
    if (!p.rows[0]) throw notFound("Pagamento n\xE3o encontrado.");
    const [transitions, receipts, outbox] = await Promise.all([
      ctx2.db.query("SELECT from_status, to_status, occurred_at, receipt_id FROM payment_transitions WHERE payment_id = $1 ORDER BY id", [id]),
      ctx2.db.query(`SELECT id, received_at, outcome, reason, gateway_event, correlation_id, signature_method FROM webhook_receipts WHERE payment_id = $1 AND org_id = $2 ORDER BY id`, [id, a.org.id]),
      ctx2.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.last_error, o.events_received, o.fbtrace_id, o.sent_at, o.payload,
                (SELECT json_agg(json_build_object('at', attempted_at, 'http', http_status, 'outcome', outcome, 'message', message) ORDER BY id)
                   FROM capi_attempts t WHERE t.outbox_id = o.id) AS attempts_log
           FROM capi_outbox o WHERE o.payment_id = $1 AND o.org_id = $2`,
        [id, a.org.id]
      )
    ]);
    return jsonSafe({ payment: p.rows[0], transitions: transitions.rows, receipts: receipts.rows, capi: outbox.rows });
  });
  app2.get("/v1/events", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({
      status: z7.enum(["pending", "sending", "sent", "dead"]).optional(),
      eventName: z7.string().max(40).optional(),
      pixelId: uuidOpt,
      page: z7.coerce.number().int().min(1).max(1e4).default(1)
    }), req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const params = [a.org.id, w.startUtc, w.endUtc, q.status ?? null, q.eventName ?? null, q.pixelId ?? null];
    const base = `o.org_id = $1 AND o.created_at >= $2 AND o.created_at < $3
                   AND ($5::text IS NULL OR o.event_name = $5) AND ($6::uuid IS NULL OR o.pixel_id = $6)`;
    const where = `${base} AND ($4::text IS NULL OR o.status = $4)`;
    const [rows, counts] = await Promise.all([
      ctx2.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.next_attempt_at, o.last_error, o.last_error_class,
                o.last_http_status, o.events_received, o.fbtrace_id, o.created_at, o.sent_at, o.payment_id, o.correlation_id,
                o.payload, px.name AS pixel_name
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id WHERE ${where} ORDER BY o.id DESC LIMIT 50 OFFSET $7`,
        [...params, (q.page - 1) * 50]
      ),
      ctx2.db.query(`SELECT o.status, count(*)::int AS n FROM capi_outbox o WHERE ${base} AND ($4::text IS NULL OR $4::text IS NOT NULL) GROUP BY o.status`, params)
    ]);
    return jsonSafe({ page: q.page, pageSize: 50, events: rows.rows, counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])) });
  });
  app2.post("/v1/events/requeue", async (req) => {
    const a = requireRole(req, "analyst");
    const b = parse(z7.object({ id: z7.coerce.number().int().positive().optional(), all: z7.boolean().optional() }), req.body);
    const n = await requeue(ctx2, a.org.id, b);
    await audit(ctx2, a.org.id, a.user.id, "capi.requeued", b.id ? String(b.id) : "all", { count: n });
    return { requeued: n };
  });
  app2.get("/v1/reports/capi", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery, req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const [byPixel, failures, latency, receipts] = await Promise.all([
      ctx2.db.query(
        `SELECT px.id AS pixel_id, px.name AS pixel_name, px.meta_pixel_id, o.event_name,
                count(*)::int AS total, count(*) FILTER (WHERE o.status = 'sent')::int AS sent,
                count(*) FILTER (WHERE o.status IN ('pending', 'sending'))::int AS pending,
                count(*) FILTER (WHERE o.status = 'dead')::int AS dead
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id
          WHERE o.org_id = $1 AND o.created_at >= $2 AND o.created_at < $3
          GROUP BY 1, 2, 3, 4 ORDER BY 2, 4`,
        [a.org.id, w.startUtc, w.endUtc]
      ),
      ctx2.db.query(
        `SELECT o.id, o.event_name, o.event_id, o.status, o.attempts, o.last_error, o.last_error_class, o.last_http_status, o.fbtrace_id,
                o.created_at, px.name AS pixel_name
           FROM capi_outbox o JOIN pixels px ON px.id = o.pixel_id
          WHERE o.org_id = $1 AND o.last_error IS NOT NULL AND o.created_at >= $2 AND o.created_at < $3
          ORDER BY o.id DESC LIMIT 50`,
        [a.org.id, w.startUtc, w.endUtc]
      ),
      ctx2.db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (sent_at - created_at))) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (sent_at - created_at))) AS p95
           FROM capi_outbox WHERE org_id = $1 AND status = 'sent' AND created_at >= $2 AND created_at < $3`,
        [a.org.id, w.startUtc, w.endUtc]
      ),
      ctx2.db.query(
        `SELECT provider, outcome, count(*)::int AS n FROM webhook_receipts
          WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1, 2 ORDER BY 1, 2`,
        [a.org.id, w.startUtc, w.endUtc]
      )
    ]);
    return {
      byPixel: byPixel.rows,
      failures: failures.rows,
      latencySeconds: { p50: latency.rows[0]?.p50 ?? null, p95: latency.rows[0]?.p95 ?? null },
      webhooks: receipts.rows,
      dispatchPaused: ctx2.config.CAPI_DISPATCH === "paused"
    };
  });
  app2.get("/v1/reports/coverage", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({ pixelId: uuidOpt, group: z7.enum(["day", "week", "month"]).default("day") }), req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const presence = MATCH_KEYS.map((k, i) => `count(*) FILTER (WHERE '${k}' = ANY(match_keys))::int AS k${i}`).join(", ");
    const base = `FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 AND ($4::uuid IS NULL OR pixel_id = $4)`;
    const params = [a.org.id, w.startUtc, w.endUtc, q.pixelId ?? null, a.org.timezone];
    const [totals, periods, byEvent] = await Promise.all([
      ctx2.db.query(`SELECT count(*)::int AS total, ${presence} ${base}`, params.slice(0, 4)),
      ctx2.db.query(
        `SELECT to_char(date_trunc('${q.group}', received_at AT TIME ZONE $5), 'YYYY-MM-DD') AS period, count(*)::int AS total,
                avg(cardinality(match_keys))::float AS avg_params,
                count(*) FILTER (WHERE match_keys && ARRAY['fbp','fbc','external_id'])::int AS dedup_ready,
                count(*) FILTER (WHERE source = 'browser')::int AS browser, count(*) FILTER (WHERE source = 'server')::int AS server
           ${base} GROUP BY 1 ORDER BY 1 DESC`,
        params
      ),
      ctx2.db.query(
        `SELECT event_name, count(*)::int AS total, avg(cardinality(match_keys))::float AS avg_params,
                count(*) FILTER (WHERE match_keys && ARRAY['fbp','fbc','external_id'])::int AS dedup_ready
           ${base} GROUP BY 1 ORDER BY 2 DESC`,
        params.slice(0, 4)
      )
    ]);
    const t = totals.rows[0] ?? { total: 0 };
    return {
      matchKeys: MATCH_KEYS,
      total: t.total,
      presence: Object.fromEntries(MATCH_KEYS.map((k, i) => [k, t.total ? t[`k${i}`] / t.total : 0])),
      periods: periods.rows,
      byEvent: byEvent.rows
    };
  });
  app2.get("/v1/reports/attribution", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery.extend({ dimension: z7.enum(["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"]).default("utm_campaign") }), req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const dim = q.dimension;
    if (!UTM_KEYS.includes(dim)) throw notFound();
    const events = await ctx2.db.query(
      `SELECT COALESCE(utm_source, '(direto)') AS source, COALESCE(${dim}, '\u2014') AS key,
              count(*) FILTER (WHERE event_name = 'PageView')::int AS page_views,
              count(*) FILTER (WHERE event_name = 'InitiateCheckout')::int AS initiate_checkouts
         FROM tracking_events WHERE org_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1, 2`,
      [a.org.id, w.startUtc, w.endUtc]
    );
    const sales = await ctx2.db.query(
      `SELECT COALESCE(utm_source, '(direto)') AS source, COALESCE(${dim}, '\u2014') AS key, currency,
              to_char((approved_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS amount
         FROM payments WHERE org_id = $1 AND status = 'approved' AND approved_at >= $2 AND approved_at < $3 GROUP BY 1, 2, 3, 4`,
      [a.org.id, w.startUtc, w.endUtc, a.org.timezone]
    );
    const fx = await FxTable.load(ctx2.db, [a.org.reporting_currency, ...sales.rows.map((r) => String(r.currency ?? "").trim())], w.since, w.until);
    const rows = /* @__PURE__ */ new Map();
    const get = (s, k) => {
      const id = `${s}\0${k}`;
      if (!rows.has(id)) rows.set(id, { source: s, key: k, pageViews: 0, initiateCheckouts: 0, sales: 0, revenueMinor: 0n, unconverted: 0 });
      return rows.get(id);
    };
    for (const e of events.rows) Object.assign(get(e.source, e.key), { pageViews: e.page_views, initiateCheckouts: e.initiate_checkouts });
    for (const s of sales.rows) {
      const r = get(s.source, s.key);
      r.sales += s.n;
      if (s.currency) {
        const c = fx.convert(BigInt(s.amount), String(s.currency).trim(), a.org.reporting_currency, s.day);
        if (c.converted) r.revenueMinor += c.amountMinor;
        else r.unconverted += s.n;
      }
    }
    const list = [...rows.values()].sort((x, y) => y.revenueMinor > x.revenueMinor ? 1 : y.revenueMinor < x.revenueMinor ? -1 : y.pageViews - x.pageViews);
    return jsonSafe({ dimension: dim, reportingCurrency: a.org.reporting_currency, rows: list.slice(0, 500) });
  });
  app2.get("/v1/alerts", async (req) => {
    const a = requireRole(req, "viewer");
    const r = await ctx2.db.query(
      `SELECT id, kind, severity, title, detail, occurrences, first_seen_at, last_seen_at, resolved_at FROM alerts
        WHERE org_id = $1 ORDER BY resolved_at IS NOT NULL, last_seen_at DESC LIMIT 100`,
      [a.org.id]
    );
    return { alerts: r.rows };
  });
  app2.post("/v1/alerts/:id/resolve", async (req) => {
    const a = requireRole(req, "analyst");
    const { id } = parse(z7.object({ id: z7.coerce.number().int() }), req.params);
    await ctx2.db.query("UPDATE alerts SET resolved_at = now() WHERE id = $1 AND org_id = $2", [id, a.org.id]);
    return { ok: true };
  });
  app2.get("/v1/reports/reconciliation", async (req) => {
    const a = requireRole(req, "viewer");
    const q = parse(periodQuery, req.query);
    const w = reportWindow(q.preset, a.org.timezone, { since: q.since, until: q.until });
    const r = await ctx2.db.query(
      `SELECT
         count(*)::int AS approved,
         count(*) FILTER (WHERE o.status = 'sent')::int AS purchase_sent,
         count(*) FILTER (WHERE o.status IN ('pending', 'sending'))::int AS purchase_pending,
         count(*) FILTER (WHERE o.status = 'dead')::int AS purchase_dead,
         count(*) FILTER (WHERE o.id IS NULL AND p.pixel_id IS NULL)::int AS without_pixel,
         count(*) FILTER (WHERE o.id IS NULL AND p.pixel_id IS NOT NULL)::int AS not_queued
       FROM payments p LEFT JOIN capi_outbox o ON o.payment_id = p.id AND o.event_name = 'Purchase'
      WHERE p.org_id = $1 AND p.approved_at >= $2 AND p.approved_at < $3`,
      [a.org.id, w.startUtc, w.endUtc]
    );
    return r.rows[0];
  });
}

// src/billing/routes.ts
import { createHmac as createHmac4 } from "node:crypto";
var PERIOD_DAYS = 30;
function wooviSignature(rawBody, secret) {
  return createHmac4("sha256", secret).update(rawBody, "utf8").digest("base64");
}
function billingRoutes(app2, ctx2) {
  app2.get("/v1/billing", async (req) => {
    const a = requireRole(req, "viewer", { allowExpiredPlan: true });
    const charges = await ctx2.db.query(
      `SELECT id, correlation_id, amount_minor, status, paid_at, expires_at, created_at, br_code, qr_code_image, payment_link_url
         FROM billing_charges WHERE org_id = $1 ORDER BY created_at DESC LIMIT 24`,
      [a.org.id]
    );
    return jsonSafe({
      plan: { ...planState(a.org, ctx2.now()), expiresAt: a.org.plan_expires_at, priceMinor: ctx2.config.PLAN_PRICE_MINOR, currency: "BRL" },
      charges: charges.rows,
      wooviConfigured: !!ctx2.config.WOOVI_APP_ID
    });
  });
  app2.post("/v1/billing/charge", async (req) => {
    const a = requireRole(req, "owner", { allowExpiredPlan: true });
    await hit(ctx2.db, `charge:org:${a.org.id}`, 10, 3600);
    if (!ctx2.config.WOOVI_APP_ID) throw new AppError(503, "billing_unavailable", "Pagamento indispon\xEDvel: WOOVI_APP_ID n\xE3o configurado.");
    const open = await ctx2.db.query(
      `SELECT * FROM billing_charges WHERE org_id = $1 AND status = 'pending' AND expires_at > now() + interval '10 minutes' ORDER BY created_at DESC LIMIT 1`,
      [a.org.id]
    );
    if (open.rows[0]) return jsonSafe({ charge: open.rows[0], reused: true });
    const correlationID = `pt_sub_${a.org.id.replace(/-/g, "").slice(0, 12)}_${randomToken(8)}`;
    const res = await ctx2.fetch(`${ctx2.config.WOOVI_API_BASE}/api/v1/charge`, {
      method: "POST",
      headers: { Authorization: ctx2.config.WOOVI_APP_ID, "Content-Type": "application/json" },
      body: JSON.stringify({
        correlationID,
        value: ctx2.config.PLAN_PRICE_MINOR,
        comment: "Assinatura mensal PayTracking",
        customer: { name: a.org.name.slice(0, 60), email: a.user.email },
        expiresIn: 86400
      }),
      signal: AbortSignal.timeout(2e4)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.charge) {
      ctx2.log.error({ http: res.status, error: j?.error ?? j?.message }, "Woovi: falha ao criar cobran\xE7a");
      throw new AppError(502, "billing_provider_error", `Falha ao criar cobran\xE7a PIX (HTTP ${res.status}). Tente novamente.`);
    }
    const c = j.charge;
    const ins = await ctx2.db.query(
      `INSERT INTO billing_charges(org_id, correlation_id, provider_charge_id, amount_minor, br_code, qr_code_image, payment_link_url, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '24 hours') RETURNING *`,
      [a.org.id, correlationID, c.identifier ?? null, ctx2.config.PLAN_PRICE_MINOR, c.brCode ?? null, c.qrCodeImage ?? null, c.paymentLinkUrl ?? null]
    );
    return jsonSafe({ charge: ins.rows[0], reused: false });
  });
  async function wooviWebhook(req) {
    const raw = req.rawBody ?? "";
    const secret = ctx2.config.WOOVI_WEBHOOK_SECRET;
    if (!secret) return { status: 503, body: { ok: false, error: "webhook_secret_not_configured" } };
    const sig = String(req.headers["x-webhook-signature"] ?? "");
    if (!sig || !safeEqual(wooviSignature(raw, secret), sig)) return { status: 401, body: { ok: false, error: "invalid_signature" } };
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: 400, body: { ok: false, error: "invalid_json" } };
    }
    const event = String(data?.event ?? "");
    const charge = data?.charge ?? data?.pix?.charge ?? {};
    const paid = ["OPENPIX:CHARGE_COMPLETED", "OPENPIX:TRANSACTION_RECEIVED"].includes(event) || ["COMPLETED", "CONFIRMED"].includes(String(charge?.status ?? ""));
    if (!paid) return { status: 200, body: { ok: true, ignored: event || "not_paid" } };
    const correlationID = String(charge?.correlationID ?? data?.correlationID ?? "");
    const value = Number(charge?.value ?? data?.pix?.value ?? 0);
    return tx(ctx2.db, async (c) => {
      const r = await c.query(
        `UPDATE billing_charges SET status = 'paid', paid_at = now() WHERE correlation_id = $1 AND status <> 'paid' RETURNING org_id, amount_minor, period_days`,
        [correlationID]
      );
      const row = r.rows[0];
      if (!row) {
        const exists = await c.query("SELECT 1 FROM billing_charges WHERE correlation_id = $1", [correlationID]);
        return { status: 200, body: { ok: true, duplicate: !!exists.rowCount, unknown: !exists.rowCount } };
      }
      if (value && BigInt(value) < BigInt(row.amount_minor)) {
        throw new AppError(400, "amount_mismatch", "Valor pago menor que o da cobran\xE7a");
      }
      await c.query(
        `UPDATE organizations SET plan_status = 'active', plan_started_at = COALESCE(plan_started_at, now()),
                plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(days => $2), updated_at = now()
          WHERE id = $1 AND plan_status <> 'exempt'`,
        [row.org_id, row.period_days ?? PERIOD_DAYS]
      );
      await c.query(`INSERT INTO audit_log(org_id, action, target) VALUES ($1, 'billing.paid', $2)`, [row.org_id, correlationID]);
      return { status: 200, body: { ok: true, renewed: true } };
    });
  }
  for (const path3 of ["/v1/webhooks/woovi", "/api/billing_webhook.php"]) {
    app2.post(path3, async (req, reply) => {
      const out = await wooviWebhook(req);
      return reply.code(out.status).send(out.body);
    });
  }
}

// src/admin/routes.ts
import { z as z8 } from "zod";
function adminRoutes(app2, ctx2) {
  app2.get("/v1/admin/overview", async (req) => {
    requirePlatformAdmin(req);
    const totals = await ctx2.db.query(
      `SELECT count(*)::int AS orgs,
              count(*) FILTER (WHERE plan_status = 'active' AND plan_expires_at > now())::int AS active,
              count(*) FILTER (WHERE plan_status = 'trial' AND plan_expires_at > now())::int AS trial,
              count(*) FILTER (WHERE plan_status <> 'exempt' AND (plan_expires_at IS NULL OR plan_expires_at <= now()))::int AS expired,
              count(*) FILTER (WHERE plan_status = 'exempt')::int AS exempt
         FROM organizations`
    );
    const mrr = await ctx2.db.query(
      `SELECT COALESCE(sum(amount_minor), 0)::bigint AS minor FROM billing_charges WHERE status = 'paid' AND paid_at > now() - interval '30 days'`
    );
    return jsonSafe({ ...totals.rows[0], revenueLast30dMinor: mrr.rows[0]?.minor ?? 0n });
  });
  app2.get("/v1/admin/orgs", async (req) => {
    requirePlatformAdmin(req);
    const q = parse(z8.object({ q: z8.string().max(120).optional(), status: z8.enum(["all", "trial", "active", "expired", "exempt"]).default("all") }), req.query);
    const r = await ctx2.db.query(
      `SELECT o.id, o.name, o.plan_status, o.plan_expires_at, o.created_at,
              (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email,
              (SELECT count(*) FROM pixels p WHERE p.org_id = o.id)::int AS pixels,
              (SELECT count(*) FROM payments p WHERE p.org_id = o.id AND p.status = 'approved' AND p.approved_at > now() - interval '30 days')::int AS sales_30d,
              (SELECT max(paid_at) FROM billing_charges b WHERE b.org_id = o.id AND b.status = 'paid') AS last_paid_at
         FROM organizations o
        WHERE ($1::text IS NULL OR o.name ILIKE $1 OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND u.email ILIKE $1))
          AND ($2 = 'all'
               OR ($2 = 'exempt' AND o.plan_status = 'exempt')
               OR ($2 = 'expired' AND o.plan_status <> 'exempt' AND (o.plan_expires_at IS NULL OR o.plan_expires_at <= now()))
               OR ($2 IN ('trial', 'active') AND o.plan_status = $2 AND o.plan_expires_at > now()))
        ORDER BY o.created_at DESC LIMIT 500`,
      [q.q ? `%${q.q}%` : null, q.status]
    );
    return { orgs: r.rows };
  });
  app2.post("/v1/admin/orgs/:id/plan", async (req) => {
    const a = requirePlatformAdmin(req);
    const { id } = parse(z8.object({ id: z8.string().uuid() }), req.params);
    const b = parse(z8.object({ action: z8.enum(["extend_trial", "activate", "expire", "exempt"]), days: z8.coerce.number().int().min(1).max(3650).default(30) }), req.body);
    if (b.action === "expire" && id === a.org.id) throw badRequest("Voc\xEA n\xE3o pode expirar a pr\xF3pria organiza\xE7\xE3o.");
    const sql = {
      extend_trial: `UPDATE organizations SET plan_status = 'trial', plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(days => $2) WHERE id = $1`,
      activate: `UPDATE organizations SET plan_status = 'active', plan_expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      expire: `UPDATE organizations SET plan_status = 'expired', plan_expires_at = now() WHERE id = $1 AND $2::int IS NOT NULL`,
      exempt: `UPDATE organizations SET plan_status = 'exempt', plan_expires_at = NULL WHERE id = $1 AND $2::int IS NOT NULL`
    };
    const r = await ctx2.db.query(sql[b.action], [id, b.days]);
    if (!r.rowCount) throw notFound("Organiza\xE7\xE3o n\xE3o encontrada.");
    await audit(ctx2, id, a.user.id, `admin.plan_${b.action}`, id, { days: b.days });
    return { ok: true };
  });
  app2.delete("/v1/admin/orgs/:id", async (req) => {
    const a = requirePlatformAdmin(req);
    const { id } = parse(z8.object({ id: z8.string().uuid() }), req.params);
    const { confirm } = parse(z8.object({ confirm: z8.literal("EXCLUIR") }), req.body);
    if (id === a.org.id) throw badRequest("Voc\xEA n\xE3o pode excluir a pr\xF3pria organiza\xE7\xE3o.");
    const r = await ctx2.db.query("DELETE FROM organizations WHERE id = $1", [id]);
    if (!r.rowCount) throw notFound("Organiza\xE7\xE3o n\xE3o encontrada.");
    await audit(ctx2, null, a.user.id, "admin.org_deleted", id);
    return { ok: true };
  });
}

// src/notifications/routes.ts
import { z as z9 } from "zod";
function pushRoutes(app2, ctx2) {
  app2.get("/v1/push/config", async (req) => {
    const a = auth(req);
    const n = await ctx2.db.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND org_id = $2", [a.user.id, a.org.id]);
    return { vapidPublicKey: ctx2.config.VAPID_PUBLIC_KEY || null, configured: !!(ctx2.config.VAPID_PUBLIC_KEY && ctx2.config.VAPID_PRIVATE_KEY), subscriptions: n.rows[0]?.n ?? 0 };
  });
  app2.post("/v1/push/subscriptions", async (req) => {
    const a = requireRole(req, "viewer");
    const b = parse(z9.object({
      endpoint: z9.string().url().max(800),
      keys: z9.object({ p256dh: z9.string().min(10).max(255), auth: z9.string().min(8).max(255) })
    }), req.body);
    await ctx2.db.query(
      `INSERT INTO push_subscriptions(user_id, org_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, org_id = EXCLUDED.org_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [a.user.id, a.org.id, b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers["user-agent"] ?? "").slice(0, 255)]
    );
    return { ok: true };
  });
  app2.post("/v1/push/unsubscribe", async (req) => {
    const a = auth(req);
    const { endpoint } = parse(z9.object({ endpoint: z9.string().url().max(800) }), req.body);
    await ctx2.db.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, a.user.id]);
    return { ok: true };
  });
  app2.post("/v1/push/test", async (req) => {
    const a = requireRole(req, "viewer");
    return sendPushToOrg(ctx2, a.org.id, { title: "Teste de notifica\xE7\xE3o", body: "As notifica\xE7\xF5es de venda est\xE3o funcionando.", url: "/" });
  });
}

// src/app.ts
var SEVERITY = { trace: "DEBUG", debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR", fatal: "CRITICAL" };
var PUBLIC_PREFIXES = ["/v1/webhooks", "/api/", "/v1/collect", "/v1/pixel-config", "/v1/meta/callback", "/healthz", "/pixel.js", "/checkout-loader"];
var isPublic = (url) => PUBLIC_PREFIXES.some((p) => url.startsWith(p));
async function buildApp(ctx2) {
  const app2 = Fastify({
    logger: ctx2.config.NODE_ENV === "test" ? false : {
      level: ctx2.config.isProd ? "info" : "debug",
      formatters: { level: (label, level) => ({ level, severity: SEVERITY[label] ?? "DEFAULT" }) },
      redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-hotmart-hottok"]', 'req.headers["security-token"]'],
      serializers: {
        // nunca registra a querystring (tokens de webhook legados vão na URL)
        req: (r) => ({ method: r.method, url: String(r.url).split("?")[0].replace(/^(\/v1\/webhooks\/[^/]+\/)[^/]+$/, "$1[token]"), id: r.id })
      }
    },
    // número = confia só nos N últimos saltos (o que o proxy acrescentou), igual ao proxy-addr
    trustProxy: typeof ctx2.config.TRUST_PROXY === "number" ? /* @__PURE__ */ ((hops) => (_addr, i) => i < hops)(ctx2.config.TRUST_PROXY) : ctx2.config.TRUST_PROXY,
    bodyLimit: 1048576,
    genReqId: () => randomUUID3()
  });
  await app2.register(cookie);
  app2.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => typeof v === "bigint" ? v.toString() : v));
  app2.addContentTypeParser(["application/json", "text/plain"], { parseAs: "string" }, (req, body, done) => {
    const s = String(body);
    req.rawBody = s;
    if (!s.trim()) return done(null, {});
    try {
      done(null, JSON.parse(s));
    } catch {
      done(null, null);
    }
  });
  app2.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
    const s = String(body);
    req.rawBody = s;
    done(null, Object.fromEntries(new URLSearchParams(s)));
  });
  app2.addContentTypeParser("*", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = String(body);
    done(null, null);
  });
  const appOrigin = new URL(ctx2.config.APP_URL).origin;
  const apiOrigin = new URL(ctx2.config.PUBLIC_API_URL).origin;
  app2.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (ctx2.config.isProd) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const url = req.url;
    if (url.startsWith("/v1/") && !isPublic(url)) {
      reply.header("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = String(req.headers.origin ?? "");
        if (origin !== appOrigin && origin !== apiOrigin) {
          return reply.code(403).send({ error: { code: "bad_origin", message: "Origem da requisi\xE7\xE3o n\xE3o permitida." } });
        }
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token && (url.startsWith("/v1/") || url === "/v1")) {
      req.auth = await resolveSession(ctx2, token) ?? void 0;
    }
  });
  app2.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: "bad_request", message: "Dados inv\xE1lidos." } });
    const status = err.statusCode;
    if (status && status < 500) return reply.code(status).send({ error: { code: "bad_request", message: err.message } });
    req.log.error({ err }, "erro n\xE3o tratado");
    return reply.code(500).send({ error: { code: "internal", message: "Erro interno. Tente novamente.", requestId: req.id } });
  });
  app2.get("/healthz", async (_req, reply) => {
    try {
      await ctx2.db.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, db: "unavailable" });
    }
  });
  authRoutes(app2, ctx2);
  orgRoutes(app2, ctx2);
  pixelRoutes(app2, ctx2);
  integrationRoutes(app2, ctx2);
  webhookRoutes(app2, ctx2);
  collectRoutes(app2, ctx2);
  reportRoutes(app2, ctx2);
  metaRoutes(app2, ctx2);
  billingRoutes(app2, ctx2);
  adminRoutes(app2, ctx2);
  pushRoutes(app2, ctx2);
  const here2 = path2.dirname(fileURLToPath2(import.meta.url));
  const pixelDir = ctx2.config.PIXEL_DIST_DIR || path2.resolve(here2, "../../../packages/pixel/dist");
  const scripts = {
    "/pixel.js": "pixel.js",
    "/checkout-loader.js": "checkout-loader.js",
    "/checkout-loader-ic-only.js": "checkout-loader.js"
  };
  for (const [route, file] of Object.entries(scripts)) {
    app2.get(route, async (_req, reply) => {
      const p = path2.join(pixelDir, file);
      if (!existsSync2(p)) return reply.code(404).send("// build do pixel ausente");
      reply.header("Content-Type", "application/javascript; charset=utf-8");
      reply.header("Cache-Control", "public, max-age=300");
      reply.header("Access-Control-Allow-Origin", "*");
      return readFileSync(p, "utf8");
    });
  }
  const webDir = ctx2.config.WEB_DIST_DIR || path2.resolve(here2, "../../web/dist");
  if (existsSync2(path2.join(webDir, "index.html"))) {
    await app2.register(fastifyStatic, { root: webDir, wildcard: false, maxAge: "1h", index: false });
    const indexHtml = readFileSync(path2.join(webDir, "index.html"), "utf8");
    app2.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/v1/") && !req.url.startsWith("/api/")) {
        reply.header("Content-Security-Policy", [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: https:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'"
        ].join("; "));
        return reply.type("text/html").header("Cache-Control", "no-cache").send(indexHtml);
      }
      return reply.code(404).send({ error: { code: "not_found", message: "Rota n\xE3o encontrada." } });
    });
  }
  return app2;
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

// src/server.ts
var config = loadConfig();
var pool = createPool(config.DATABASE_URL, 10);
var ctx = createCtx(config, pool);
if (process.env.MIGRATE_ON_START === "true") {
  const direct = createPool(directDatabaseUrl(config.DATABASE_URL, config.DATABASE_URL_UNPOOLED), 1);
  try {
    await migrate(direct);
  } finally {
    await direct.end();
  }
}
var app = await buildApp(ctx);
var worker = process.env.EMBEDDED_WORKER === "true" ? startWorker(ctx) : null;
await app.listen({ port: config.PORT, host: "0.0.0.0" });
var shutdown = async () => {
  await app.close();
  await worker?.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
//# sourceMappingURL=server.js.map
