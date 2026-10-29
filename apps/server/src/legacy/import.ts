import { normalizeCurrency, parseAmount } from '@pt/domain';
import { PROVIDERS } from '@pt/gateways';
import type { Pool, PoolClient } from 'pg';
import type { SecretBox } from '../lib/crypto.js';
import { publicKey } from '../lib/crypto.js';

/**
 * Importação do banco MySQL do PHP legado (docs/fase-2-arquitetura/PLANO-MIGRACAO.md).
 *
 * - Idempotente: cada linha leva o id legado (legacy_user_id / legacy_project_id / legacy_source);
 *   rodar de novo atualiza em vez de duplicar. Nada é apagado, nem no legado nem aqui.
 * - Tokens de webhook continuam valendo: guardamos o MESMO sha256 que o PHP guardava,
 *   então as URLs configuradas nos gateways não mudam.
 * - Senhas: o hash bcrypt ($2y$) é copiado como está; o login novo aceita e re-hasheia.
 * - Segredos (token CAPI, segredos de gateway, token da Meta) passam a ser cifrados (AES-256-GCM).
 * - Vendas antigas entram como histórico (provider "legacy"), sem gerar eventos para a Meta.
 *   A fila `events` do legado NÃO é importada: reenviar eventos antigos duplicaria conversões.
 */

export interface LegacyUser {
  id: number;
  email: string;
  password_hash: string;
  created_at: Date | string;
  plan_status?: string | null;
  plan_expires_at?: Date | string | null;
  plan_started_at?: Date | string | null;
  goal_daily?: string | number | null;
  goal_monthly?: string | number | null;
  hide_email?: number | boolean | null;
  gateway_token_hash?: string | null;
  gateway_token_raw?: string | null;
  gateway_secrets?: string | null;
}

export interface LegacyProject {
  id: number;
  user_id: number;
  name: string;
  pixel_id: string;
  public_key?: string | null;
  capi_token: string;
  integration_token_hash?: string | null;
  test_event_code?: string | null;
  active: number | boolean;
  product_ids?: string | null;
  gateway_secrets?: string | null;
  currency?: string | null;
  country?: string | null;
  ic_rule_type?: string | null;
  ic_rule_value?: string | null;
  created_at: Date | string;
}

export interface LegacySale {
  id: number;
  project_id: number;
  transaction_id: string;
  value: string | number;
  currency: string | null;
  created_at: Date | string;
}

export interface LegacyMetaConnection {
  user_id: number;
  access_token: string;
  token_expires_at?: Date | string | null;
  selected_account?: string | null;
}

export interface LegacyPushSubscription {
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
}

export interface LegacySource {
  users(): Promise<LegacyUser[]>;
  projects(): Promise<LegacyProject[]>;
  sales(): Promise<LegacySale[]>;
  metaConnections(): Promise<LegacyMetaConnection[]>;
  pushSubscriptions(): Promise<LegacyPushSubscription[]>;
}

export interface ImportReport {
  dryRun: boolean;
  users: number;
  orgs: number;
  pixels: number;
  products: number;
  integrations: number;
  sales: number;
  metaConnections: number;
  pushSubscriptions: number;
  warnings: string[];
}

const GATEWAYS = PROVIDERS.filter((p) => p !== 'checkout');
const SHA256 = /^[a-f0-9]{64}$/;
const IC_RULES = new Set(['none', 'contains', 'equals', 'starts_with']);

const toDate = (v: Date | string | null | undefined): Date | null => {
  if (v == null || v === '' || String(v).startsWith('0000')) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') || String(v).includes('+') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
};

function parseSecrets(raw: string | null | undefined, where: string, warnings: string[]): Record<string, string> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('não é objeto');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && v.trim()) out[k.toLowerCase()] = v.trim();
    return out;
  } catch {
    warnings.push(`${where}: gateway_secrets ilegível — segredos não importados; configure-os no painel.`);
    return {};
  }
}

export function splitProductIds(raw: string | null | undefined): string[] {
  return [...new Set(String(raw ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 128))];
}

export async function importLegacy(db: Pool, box: SecretBox, src: LegacySource, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const report: ImportReport = {
    dryRun: !!opts.dryRun, users: 0, orgs: 0, pixels: 0, products: 0, integrations: 0, sales: 0, metaConnections: 0, pushSubscriptions: 0, warnings: [],
  };
  const w = report.warnings;
  const [users, projects, sales, metas, pushes] = await Promise.all([
    src.users(), src.projects(), src.sales(), src.metaConnections(), src.pushSubscriptions(),
  ]);

  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const userMap = new Map<number, { userId: string; orgId: string }>();
    const projectMap = new Map<number, { pixelId: string; orgId: string; currency: string }>();

    for (const u of users) {
      const email = String(u.email ?? '').trim().toLowerCase();
      if (!email.includes('@') || !/^\$2[aby]\$\d\d\$/.test(u.password_hash ?? '')) {
        w.push(`usuário legado #${u.id}: e-mail ou hash de senha inválido — ignorado.`);
        continue;
      }
      const ur = await c.query<{ id: string }>(
        `INSERT INTO users(email, password_hash, hide_email, legacy_user_id, created_at, email_verified_at)
         VALUES ($1, $2, $3, $4, COALESCE($5, now()), NULL)
         ON CONFLICT (email) DO UPDATE SET legacy_user_id = EXCLUDED.legacy_user_id, hide_email = EXCLUDED.hide_email
           WHERE users.legacy_user_id IS NULL OR users.legacy_user_id = EXCLUDED.legacy_user_id
         RETURNING id`,
        [email, u.password_hash, !!Number(u.hide_email ?? 0), u.id, toDate(u.created_at)],
      );
      if (!ur.rows[0]) {
        w.push(`usuário legado #${u.id}: e-mail ${email} já pertence a outra conta no sistema novo — ignorado.`);
        continue;
      }
      const userId = ur.rows[0].id;
      report.users++;

      // um usuário legado = uma organização (dono)
      const status = ['trial', 'active', 'expired'].includes(String(u.plan_status)) ? String(u.plan_status) : 'trial';
      const goalD = parseAmount(u.goal_daily ?? 0, 'BRL', 'major') ?? 0n;
      const goalM = parseAmount(u.goal_monthly ?? 0, 'BRL', 'major') ?? 0n;
      const or = await c.query<{ id: string }>(
        `INSERT INTO organizations(name, plan_status, plan_expires_at, plan_started_at, goal_daily_minor, goal_monthly_minor, legacy_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
         ON CONFLICT (legacy_user_id) DO UPDATE SET plan_status = EXCLUDED.plan_status, plan_expires_at = EXCLUDED.plan_expires_at,
           goal_daily_minor = EXCLUDED.goal_daily_minor, goal_monthly_minor = EXCLUDED.goal_monthly_minor, updated_at = now()
         RETURNING id`,
        [email.split('@')[0] || 'Minha organização', status, toDate(u.plan_expires_at), toDate(u.plan_started_at), goalD, goalM, u.id, toDate(u.created_at)],
      );
      const orgId = or.rows[0]!.id;
      report.orgs++;
      await c.query(`INSERT INTO memberships(org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [orgId, userId]);
      userMap.set(u.id, { userId, orgId });
    }

    for (const p of projects) {
      const owner = userMap.get(p.user_id);
      if (!owner) { w.push(`projeto legado #${p.id}: dono #${p.user_id} não importado — ignorado.`); continue; }
      const metaPixel = String(p.pixel_id ?? '').trim();
      if (!/^\d{6,32}$/.test(metaPixel)) { w.push(`projeto legado #${p.id}: pixel_id "${metaPixel}" inválido — ignorado.`); continue; }
      const currency = normalizeCurrency(p.currency) ?? 'BRL';
      const country = /^[A-Za-z]{2}$/.test(String(p.country ?? '')) ? String(p.country).toUpperCase() : 'BR';
      const icType = IC_RULES.has(String(p.ic_rule_type)) ? String(p.ic_rule_type) : 'none';
      const token = String(p.capi_token ?? '').trim();
      // a chave pública do legado continua valendo (snippets já instalados nas páginas)
      const pk = p.public_key && /^[\w-]{8,64}$/.test(p.public_key) ? p.public_key : publicKey();
      const pr = await c.query<{ id: string }>(
        `INSERT INTO pixels(org_id, name, meta_pixel_id, capi_token_enc, test_event_code, currency, country, public_key, active,
                            ic_rule_type, ic_rule_value, legacy_project_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now()))
         ON CONFLICT (legacy_project_id) DO UPDATE SET name = EXCLUDED.name, meta_pixel_id = EXCLUDED.meta_pixel_id,
           capi_token_enc = EXCLUDED.capi_token_enc, test_event_code = EXCLUDED.test_event_code, currency = EXCLUDED.currency,
           country = EXCLUDED.country, active = EXCLUDED.active, ic_rule_type = EXCLUDED.ic_rule_type, ic_rule_value = EXCLUDED.ic_rule_value,
           updated_at = now()
         RETURNING id`,
        [owner.orgId, String(p.name ?? 'Pixel').slice(0, 120) || 'Pixel', metaPixel, token ? box.encrypt(token) : null,
          p.test_event_code?.trim() || null, currency, country, pk, !!Number(p.active), icType, p.ic_rule_value?.trim() || null, p.id, toDate(p.created_at)],
      );
      const pixelId = pr.rows[0]!.id;
      report.pixels++;
      if (!token) w.push(`projeto legado #${p.id}: sem token da CAPI — eventos ficarão parados até configurar.`);
      projectMap.set(p.id, { pixelId, orgId: owner.orgId, currency });

      for (const prod of splitProductIds(p.product_ids)) {
        const r = await c.query(
          `INSERT INTO pixel_products(org_id, pixel_id, product_id) VALUES ($1, $2, $3) ON CONFLICT (org_id, product_id) DO NOTHING`,
          [owner.orgId, pixelId, prod],
        );
        if (r.rowCount) report.products++;
        else {
          const other = await c.query(`SELECT 1 FROM pixel_products WHERE org_id = $1 AND product_id = $2 AND pixel_id <> $3`, [owner.orgId, prod, pixelId]);
          if (other.rowCount) w.push(`produto "${prod}" estava em mais de um pixel no legado; ficou no primeiro importado (projeto #${p.id} não recebeu).`);
        }
      }

      // token de integração do projeto: vale para /api/webhook.php (checkout) e para
      // /api/webhook_gateway.php com token de projeto (formato antigo)
      const hash = String(p.integration_token_hash ?? '').toLowerCase();
      if (SHA256.test(hash)) {
        report.integrations += await upsertIntegration(c, box, {
          orgId: owner.orgId, provider: 'checkout', name: `Checkout próprio — ${p.name}`, hash, hintSrc: null,
          secret: null, pixelId, source: `project:${p.id}:checkout`,
        });
        const secrets = parseSecrets(p.gateway_secrets, `projeto #${p.id}`, w);
        for (const g of GATEWAYS) {
          if (!secrets[g]) continue;
          report.integrations += await upsertIntegration(c, box, {
            orgId: owner.orgId, provider: g, name: `${g} — ${p.name} (legado)`, hash, hintSrc: null,
            secret: secrets[g]!, pixelId, source: `project:${p.id}:${g}`,
          });
        }
      }
    }

    // token de gateway por usuário: uma URL para todos os pixels; o pixel sai do product_id
    for (const u of users) {
      const owner = userMap.get(u.id);
      const hash = String(u.gateway_token_hash ?? '').toLowerCase();
      if (!owner || !SHA256.test(hash)) continue;
      const secrets = parseSecrets(u.gateway_secrets, `usuário #${u.id}`, w);
      const firstPixel = projects.filter((p) => p.user_id === u.id && Number(p.active)).map((p) => projectMap.get(p.id)?.pixelId).find(Boolean) ?? null;
      for (const g of GATEWAYS) {
        report.integrations += await upsertIntegration(c, box, {
          orgId: owner.orgId, provider: g, name: `${g[0]!.toUpperCase()}${g.slice(1)} (legado)`, hash,
          hintSrc: u.gateway_token_raw ?? null, secret: secrets[g] ?? null, pixelId: firstPixel, source: `user:${u.id}:${g}`,
        });
      }
      if (u.gateway_token_raw) w.push(`usuário #${u.id}: o legado guardava o token de gateway em texto puro (gateway_token_raw). Ele não foi copiado; considere rotacioná-lo após a migração.`);
    }

    for (const s of sales) {
      const proj = projectMap.get(s.project_id);
      if (!proj) { w.push(`venda legada #${s.id}: projeto #${s.project_id} não importado — ignorada.`); continue; }
      const currency = normalizeCurrency(s.currency) ?? proj.currency;
      // sales.value é DECIMAL(12,2) em unidade principal (reais), já gravado pelo PHP
      const amount = parseAmount(String(s.value), currency, 'major');
      const at = toDate(s.created_at) ?? new Date();
      const txn = String(s.transaction_id ?? '').trim().slice(0, 128);
      if (!txn) continue;
      const r = await c.query(
        `INSERT INTO payments(org_id, pixel_id, provider, transaction_id, status, amount_minor, currency, created_at, updated_at, approved_at)
         VALUES ($1, $2, 'legacy', $3, 'approved', $4, $5, $6, $6, $6)
         ON CONFLICT (org_id, provider, transaction_id) DO NOTHING`,
        [proj.orgId, proj.pixelId, txn, amount, currency, at],
      );
      report.sales += r.rowCount ?? 0;
    }
    if (sales.length) {
      w.push('Vendas legadas foram importadas como "aprovadas", mas o PHP contava como pagos alguns status não pagos (P-03 do relatório). Use-as só como histórico; compare com o relatório do gateway.');
    }

    for (const m of metas) {
      const owner = userMap.get(m.user_id);
      if (!owner || !m.access_token) continue;
      const r = await c.query(
        `INSERT INTO meta_connections(org_id, connected_by, access_token_enc, token_expires_at, selected_ad_account_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id) DO NOTHING`,
        [owner.orgId, owner.userId, box.encrypt(m.access_token), toDate(m.token_expires_at), m.selected_account?.trim() || null],
      );
      report.metaConnections += r.rowCount ?? 0;
    }

    for (const ps of pushes) {
      const owner = userMap.get(ps.user_id);
      if (!owner || !ps.endpoint) continue;
      const r = await c.query(
        `INSERT INTO push_subscriptions(user_id, org_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO NOTHING`,
        [owner.userId, owner.orgId, ps.endpoint, ps.p256dh, ps.auth, ps.user_agent ?? null],
      );
      report.pushSubscriptions += r.rowCount ?? 0;
    }

    await c.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return report;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function upsertIntegration(c: PoolClient, box: SecretBox, i: {
  orgId: string; provider: string; name: string; hash: string; hintSrc: string | null; secret: string | null; pixelId: string | null; source: string;
}): Promise<number> {
  const r = await c.query(
    `INSERT INTO integrations(org_id, provider, name, token_hash, token_hint, secret_enc, default_pixel_id, legacy_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (token_hash, provider) DO UPDATE SET secret_enc = COALESCE(EXCLUDED.secret_enc, integrations.secret_enc),
       default_pixel_id = COALESCE(integrations.default_pixel_id, EXCLUDED.default_pixel_id), updated_at = now()
       WHERE integrations.org_id = EXCLUDED.org_id
     RETURNING (xmax = 0) AS inserted`,
    [i.orgId, i.provider, i.name.slice(0, 120), i.hash, i.hintSrc ? '…' + i.hintSrc.slice(-4) : 'legado', i.secret ? box.encrypt(i.secret) : null, i.pixelId, i.source],
  );
  return r.rows[0]?.inserted ? 1 : 0;
}
