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

// src/scripts/import-legacy.ts
import mysql from "mysql2/promise";

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

// ../../packages/domain/src/utm.ts
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

// ../../packages/gateways/src/types.ts
var PROVIDERS = ["checkout", "kiwify", "cakto", "kirvano", "hotmart", "lowify", "wiapay"];

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
var publicKey = () => "pt_px_" + randomBytes(10).toString("hex");

// src/legacy/import.ts
var GATEWAYS = PROVIDERS.filter((p) => p !== "checkout");
var SHA256 = /^[a-f0-9]{64}$/;
var IC_RULES = /* @__PURE__ */ new Set(["none", "contains", "equals", "starts_with"]);
var toDate2 = (v) => {
  if (v == null || v === "" || String(v).startsWith("0000")) return null;
  const d = v instanceof Date ? v : /* @__PURE__ */ new Date(String(v).replace(" ", "T") + (String(v).includes("Z") || String(v).includes("+") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
};
function parseSecrets(raw, where, warnings) {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("n\xE3o \xE9 objeto");
    const out = {};
    for (const [k, v] of Object.entries(j)) if (typeof v === "string" && v.trim()) out[k.toLowerCase()] = v.trim();
    return out;
  } catch {
    warnings.push(`${where}: gateway_secrets ileg\xEDvel \u2014 segredos n\xE3o importados; configure-os no painel.`);
    return {};
  }
}
function splitProductIds(raw) {
  return [...new Set(String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 128))];
}
async function importLegacy(db, box, src, opts = {}) {
  const report = {
    dryRun: !!opts.dryRun,
    users: 0,
    orgs: 0,
    pixels: 0,
    products: 0,
    integrations: 0,
    sales: 0,
    metaConnections: 0,
    pushSubscriptions: 0,
    warnings: []
  };
  const w = report.warnings;
  const [users, projects, sales, metas, pushes] = await Promise.all([
    src.users(),
    src.projects(),
    src.sales(),
    src.metaConnections(),
    src.pushSubscriptions()
  ]);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const userMap = /* @__PURE__ */ new Map();
    const projectMap = /* @__PURE__ */ new Map();
    for (const u of users) {
      const email = String(u.email ?? "").trim().toLowerCase();
      if (!email.includes("@") || !/^\$2[aby]\$\d\d\$/.test(u.password_hash ?? "")) {
        w.push(`usu\xE1rio legado #${u.id}: e-mail ou hash de senha inv\xE1lido \u2014 ignorado.`);
        continue;
      }
      const ur = await c.query(
        `INSERT INTO users(email, password_hash, hide_email, legacy_user_id, created_at, email_verified_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, now()), NULL)
         ON CONFLICT (email) DO UPDATE SET legacy_user_id = EXCLUDED.legacy_user_id, hide_email = EXCLUDED.hide_email
           WHERE users.legacy_user_id IS NULL OR users.legacy_user_id = EXCLUDED.legacy_user_id
         RETURNING id`,
        [email, u.password_hash, !!Number(u.hide_email ?? 0), u.id, toDate2(u.created_at)]
      );
      if (!ur.rows[0]) {
        w.push(`usu\xE1rio legado #${u.id}: e-mail ${email} j\xE1 pertence a outra conta no sistema novo \u2014 ignorado.`);
        continue;
      }
      const userId = ur.rows[0].id;
      report.users++;
      const status = ["trial", "active", "expired"].includes(String(u.plan_status)) ? String(u.plan_status) : "trial";
      const goalD = parseAmount(u.goal_daily ?? 0, "BRL", "major") ?? 0n;
      const goalM = parseAmount(u.goal_monthly ?? 0, "BRL", "major") ?? 0n;
      const or = await c.query(
        `INSERT INTO organizations(name, plan_status, plan_expires_at, plan_started_at, goal_daily_minor, goal_monthly_minor, legacy_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
         ON CONFLICT (legacy_user_id) DO UPDATE SET plan_status = EXCLUDED.plan_status, plan_expires_at = EXCLUDED.plan_expires_at,
           goal_daily_minor = EXCLUDED.goal_daily_minor, goal_monthly_minor = EXCLUDED.goal_monthly_minor, updated_at = now()
         RETURNING id`,
        [email.split("@")[0] || "Minha organiza\xE7\xE3o", status, toDate2(u.plan_expires_at), toDate2(u.plan_started_at), goalD, goalM, u.id, toDate2(u.created_at)]
      );
      const orgId = or.rows[0].id;
      report.orgs++;
      await c.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [orgId, userId]);
      userMap.set(u.id, { userId, orgId });
    }
    for (const p of projects) {
      const owner = userMap.get(p.user_id);
      if (!owner) {
        w.push(`projeto legado #${p.id}: dono #${p.user_id} n\xE3o importado \u2014 ignorado.`);
        continue;
      }
      const metaPixel = String(p.pixel_id ?? "").trim();
      if (!/^\d{6,32}$/.test(metaPixel)) {
        w.push(`projeto legado #${p.id}: pixel_id "${metaPixel}" inv\xE1lido \u2014 ignorado.`);
        continue;
      }
      const currency = normalizeCurrency(p.currency) ?? "BRL";
      const country = /^[A-Za-z]{2}$/.test(String(p.country ?? "")) ? String(p.country).toUpperCase() : "BR";
      const icType = IC_RULES.has(String(p.ic_rule_type)) ? String(p.ic_rule_type) : "none";
      const token = String(p.capi_token ?? "").trim();
      const pk = p.public_key && /^[\w-]{8,64}$/.test(p.public_key) ? p.public_key : publicKey();
      const pr = await c.query(
        `INSERT INTO pixels(org_id, name, meta_pixel_id, capi_token_enc, test_event_code, currency, country, public_key, active,
                            ic_rule_type, ic_rule_value, legacy_project_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now()))
         ON CONFLICT (legacy_project_id) DO UPDATE SET name = EXCLUDED.name, meta_pixel_id = EXCLUDED.meta_pixel_id,
           capi_token_enc = EXCLUDED.capi_token_enc, test_event_code = EXCLUDED.test_event_code, currency = EXCLUDED.currency,
           country = EXCLUDED.country, active = EXCLUDED.active, ic_rule_type = EXCLUDED.ic_rule_type, ic_rule_value = EXCLUDED.ic_rule_value,
           updated_at = now()
         RETURNING id`,
        [
          owner.orgId,
          String(p.name ?? "Pixel").slice(0, 120) || "Pixel",
          metaPixel,
          token ? box.encrypt(token) : null,
          p.test_event_code?.trim() || null,
          currency,
          country,
          pk,
          !!Number(p.active),
          icType,
          p.ic_rule_value?.trim() || null,
          p.id,
          toDate2(p.created_at)
        ]
      );
      const pixelId = pr.rows[0].id;
      report.pixels++;
      if (!token) w.push(`projeto legado #${p.id}: sem token da CAPI \u2014 eventos ficar\xE3o parados at\xE9 configurar.`);
      projectMap.set(p.id, { pixelId, orgId: owner.orgId, currency });
      for (const prod of splitProductIds(p.product_ids)) {
        const r = await c.query(
          `INSERT INTO pixel_products(org_id, pixel_id, product_id) VALUES ($1, $2, $3) ON CONFLICT (org_id, product_id) DO NOTHING`,
          [owner.orgId, pixelId, prod]
        );
        if (r.rowCount) report.products++;
        else {
          const other = await c.query(`SELECT 1 FROM pixel_products WHERE org_id = $1 AND product_id = $2 AND pixel_id <> $3`, [owner.orgId, prod, pixelId]);
          if (other.rowCount) w.push(`produto "${prod}" estava em mais de um pixel no legado; ficou no primeiro importado (projeto #${p.id} n\xE3o recebeu).`);
        }
      }
      const hash = String(p.integration_token_hash ?? "").toLowerCase();
      if (SHA256.test(hash)) {
        report.integrations += await upsertIntegration(c, box, {
          orgId: owner.orgId,
          provider: "checkout",
          name: `Checkout pr\xF3prio \u2014 ${p.name}`,
          hash,
          hintSrc: null,
          secret: null,
          pixelId,
          source: `project:${p.id}:checkout`
        });
        const secrets = parseSecrets(p.gateway_secrets, `projeto #${p.id}`, w);
        for (const g of GATEWAYS) {
          if (!secrets[g]) continue;
          report.integrations += await upsertIntegration(c, box, {
            orgId: owner.orgId,
            provider: g,
            name: `${g} \u2014 ${p.name} (legado)`,
            hash,
            hintSrc: null,
            secret: secrets[g],
            pixelId,
            source: `project:${p.id}:${g}`
          });
        }
      }
    }
    for (const u of users) {
      const owner = userMap.get(u.id);
      const hash = String(u.gateway_token_hash ?? "").toLowerCase();
      if (!owner || !SHA256.test(hash)) continue;
      const secrets = parseSecrets(u.gateway_secrets, `usu\xE1rio #${u.id}`, w);
      const firstPixel = projects.filter((p) => p.user_id === u.id && Number(p.active)).map((p) => projectMap.get(p.id)?.pixelId).find(Boolean) ?? null;
      for (const g of GATEWAYS) {
        report.integrations += await upsertIntegration(c, box, {
          orgId: owner.orgId,
          provider: g,
          name: `${g[0].toUpperCase()}${g.slice(1)} (legado)`,
          hash,
          hintSrc: u.gateway_token_raw ?? null,
          secret: secrets[g] ?? null,
          pixelId: firstPixel,
          source: `user:${u.id}:${g}`
        });
      }
      if (u.gateway_token_raw) w.push(`usu\xE1rio #${u.id}: o legado guardava o token de gateway em texto puro (gateway_token_raw). Ele n\xE3o foi copiado; considere rotacion\xE1-lo ap\xF3s a migra\xE7\xE3o.`);
    }
    for (const s of sales) {
      const proj = projectMap.get(s.project_id);
      if (!proj) {
        w.push(`venda legada #${s.id}: projeto #${s.project_id} n\xE3o importado \u2014 ignorada.`);
        continue;
      }
      const currency = normalizeCurrency(s.currency) ?? proj.currency;
      const amount2 = parseAmount(String(s.value), currency, "major");
      const at = toDate2(s.created_at) ?? /* @__PURE__ */ new Date();
      const txn = String(s.transaction_id ?? "").trim().slice(0, 128);
      if (!txn) continue;
      const r = await c.query(
        `INSERT INTO payments(org_id, pixel_id, provider, transaction_id, status, amount_minor, currency, created_at, updated_at, approved_at)
         VALUES ($1, $2, 'legacy', $3, 'approved', $4, $5, $6, $6, $6)
         ON CONFLICT (org_id, provider, transaction_id) DO NOTHING`,
        [proj.orgId, proj.pixelId, txn, amount2, currency, at]
      );
      report.sales += r.rowCount ?? 0;
    }
    if (sales.length) {
      w.push('Vendas legadas foram importadas como "aprovadas", mas o PHP contava como pagos alguns status n\xE3o pagos (P-03 do relat\xF3rio). Use-as s\xF3 como hist\xF3rico; compare com o relat\xF3rio do gateway.');
    }
    for (const m of metas) {
      const owner = userMap.get(m.user_id);
      if (!owner || !m.access_token) continue;
      const r = await c.query(
        `INSERT INTO meta_connections(org_id, connected_by, access_token_enc, token_expires_at, selected_ad_account_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id) DO NOTHING`,
        [owner.orgId, owner.userId, box.encrypt(m.access_token), toDate2(m.token_expires_at), m.selected_account?.trim() || null]
      );
      report.metaConnections += r.rowCount ?? 0;
    }
    for (const ps of pushes) {
      const owner = userMap.get(ps.user_id);
      if (!owner || !ps.endpoint) continue;
      const r = await c.query(
        `INSERT INTO push_subscriptions(user_id, org_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO NOTHING`,
        [owner.userId, owner.orgId, ps.endpoint, ps.p256dh, ps.auth, ps.user_agent ?? null]
      );
      report.pushSubscriptions += r.rowCount ?? 0;
    }
    await c.query(opts.dryRun ? "ROLLBACK" : "COMMIT");
    return report;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => void 0);
    throw e;
  } finally {
    c.release();
  }
}
async function upsertIntegration(c, box, i) {
  const r = await c.query(
    `INSERT INTO integrations(org_id, provider, name, token_hash, token_hint, secret_enc, default_pixel_id, legacy_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (token_hash, provider) DO UPDATE SET secret_enc = COALESCE(EXCLUDED.secret_enc, integrations.secret_enc),
       default_pixel_id = COALESCE(integrations.default_pixel_id, EXCLUDED.default_pixel_id), updated_at = now()
       WHERE integrations.org_id = EXCLUDED.org_id
     RETURNING (xmax = 0) AS inserted`,
    [i.orgId, i.provider, i.name.slice(0, 120), i.hash, i.hintSrc ? "\u2026" + i.hintSrc.slice(-4) : "legado", i.secret ? box.encrypt(i.secret) : null, i.pixelId, i.source]
  );
  return r.rows[0]?.inserted ? 1 : 0;
}

// src/scripts/import-legacy.ts
var apply = process.argv.includes("--apply");
var { LEGACY_MYSQL_URL, DATABASE_URL, ENCRYPTION_KEY } = process.env;
if (!LEGACY_MYSQL_URL || !DATABASE_URL || !ENCRYPTION_KEY) {
  console.error("Defina LEGACY_MYSQL_URL, DATABASE_URL e ENCRYPTION_KEY.");
  process.exit(1);
}
var my = await mysql.createConnection({ uri: LEGACY_MYSQL_URL, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false });
await my.query("SET SESSION TRANSACTION READ ONLY");
async function rows(sql) {
  try {
    const [r] = await my.query(sql);
    return r;
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}
var source = {
  users: () => rows("SELECT * FROM users ORDER BY id"),
  projects: () => rows("SELECT * FROM projects ORDER BY id"),
  sales: () => rows("SELECT * FROM sales ORDER BY id"),
  metaConnections: () => rows("SELECT * FROM meta_connections ORDER BY id"),
  pushSubscriptions: () => rows("SELECT * FROM push_subscriptions ORDER BY id")
};
var pool = createPool(DATABASE_URL, 2);
try {
  const report = await importLegacy(pool, new SecretBox(ENCRYPTION_KEY), source, { dryRun: !apply });
  const { warnings, ...counts } = report;
  console.log(apply ? "Importa\xE7\xE3o aplicada." : "SIMULA\xC7\xC3O (nada gravado). Rode com --apply para gravar.");
  console.table(counts);
  if (warnings.length) {
    console.log(`
${warnings.length} aviso(s):`);
    for (const w of warnings) console.log(" -", w);
  }
} finally {
  await my.end();
  await pool.end();
}
//# sourceMappingURL=import-legacy.js.map
