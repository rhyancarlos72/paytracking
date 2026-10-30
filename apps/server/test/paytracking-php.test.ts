import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispatchBatch } from '../src/capi/dispatcher.js';
import { DISPATCH_PHP_TEMPLATE } from '../../web/src/lib/dispatch-template.js';
import { metaOk, newAccount, newIntegration, newPixel, setup, type TestEnv } from './helpers.js';

/**
 * Roda o paytracking.php de verdade (CLI do PHP + cURL) contra o servidor escutando numa porta,
 * junto com o paytrack_dispatch.php antigo carregado no mesmo processo (convivência).
 * Pulado se não houver PHP com cURL na máquina (no CI do GitHub há).
 */
const php = (() => {
  try { return execFileSync('php', ['-r', 'echo function_exists("curl_init") ? "ok" : "no";']).toString() === 'ok'; } catch { return false; }
})();
const sqlite = php && (() => { try { return execFileSync('php', ['-r', 'echo in_array("sqlite", PDO::getAvailableDrivers()) ? "1" : "0";']).toString() === '1'; } catch { return false; } })();

const SECRET = 'whsec_teste_php';
let env: TestEnv;
let base = '';
let token = '';
let integrationId = '';
let client: Awaited<ReturnType<typeof newAccount>>['client'];
let dir = '';

// assíncrono: o servidor de teste roda neste mesmo processo e precisa responder ao PHP
async function runPhp(script: string, extraEnv: Record<string, string> = {}) {
  writeFileSync(join(dir, 'runner.php'), script);
  const { stdout } = await promisify(execFile)('php', [join(dir, 'runner.php')], {
    env: { PATH: process.env.PATH ?? '', PAYTRACKING_URL: `${base}/api/webhook.php`, PAYTRACKING_TOKEN: token, PAYTRACKING_SECRET: SECRET, ...extraEnv },
    timeout: 60_000,
  });
  return JSON.parse(stdout.trim().split('\n').pop()!);
}

const TRANSACAO = `
$tracking = json_encode([
  'purchase_event_id' => 'purchase_9452302_1793300000_ab12',
  'initiate_checkout_event_id' => 'initiate_checkout_9452302_1793299000_cd34',
  'external_id' => 'xid-php-1', 'fbp' => 'fb.1.1793299000000.123', 'fbclid' => 'IwAR_php',
  'utm_source' => 'facebook', 'utm_campaign' => 'Campanha PHP',
]);
$t = [
  'id' => 'PHP-1', 'produto_id' => '9452302', 'descricao' => 'Curso', 'valor' => '197,00',
  'nome' => 'Ana', 'sobrenome' => 'Lima', 'email' => 'ana@exemplo.com', 'telefone' => '11988887777',
  'cidade' => 'Recife', 'estado' => 'PE', 'cep' => '50000-000', 'created_at' => '2026-10-29 10:00:00',
  'device_ip' => '177.1.2.3', 'user_agent' => 'Mozilla/5.0 (PHP teste)', 'tracking_parameters' => $tracking,
];
$pdo = null;
if (in_array('sqlite', PDO::getAvailableDrivers())) {
  $pdo = new PDO('sqlite::memory:');
  $pdo->exec('CREATE TABLE transacoes_adicionais (transacao_id TEXT, produto_id TEXT, nome TEXT, preco REAL)');
  $pdo->exec("INSERT INTO transacoes_adicionais VALUES ('PHP-1', '7777', 'Bump', 27.00)");
}
`;

beforeAll(async () => {
  env = await setup();
  base = await env.app.listen({ port: 0, host: '127.0.0.1' });
  const acc = await newAccount(env);
  client = acc.client;
  await newPixel(acc.client, { productIds: ['9452302'] });
  const integ = await newIntegration(acc.client, 'checkout', { secret: SECRET });
  token = integ.token;
  integrationId = integ.integration.id;
  dir = mkdtempSync(join(tmpdir(), 'paytracking-php-'));
  copyFileSync(new URL('../../../packages/checkout-php/paytracking.php', import.meta.url), join(dir, 'paytracking.php'));
  copyFileSync(new URL('../../../packages/checkout-php/paytrack_integracao.php', import.meta.url), join(dir, 'paytrack_integracao.php'));
  // arquivo ANTIGO em produção, apontando para outro sistema (porta fechada) — não pode interferir
  writeFileSync(join(dir, 'paytrack_dispatch.php'), DISPATCH_PHP_TEMPLATE
    .split('__PAYTRACK_URL__').join('http://127.0.0.1:9/api/webhook.php')
    .split('__PAYTRACK_TOKEN__').join('itk_token_do_sistema_antigo')
    .split('__PAYTRACK_SECRET__').join('segredo_antigo'));
});
afterAll(async () => { await env?.close(); });

describe.skipIf(!php)('paytracking.php (checkout próprio) — arquivo real', () => {
  it('convive com o paytrack_dispatch.php antigo e registra PIX gerado → aprovado; reenvio é idempotente', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytrack_dispatch.php';   // antigo carregado ANTES
require __DIR__ . '/paytracking.php';
\\PayTracking\\Checkout::configurar(['log_dir' => __DIR__ . '/logs']);
${TRANSACAO}
$r = [];
$r['pix'] = \\PayTracking\\Checkout::pixGerado($t, 'efi');
$r['aprovado'] = \\PayTracking\\Checkout::pagamentoAprovado($t, $pdo, 'efi');
$r['reenvio'] = \\PayTracking\\Checkout::pagamentoAprovado($t, $pdo, 'efi');
$r['reenvio_duplicado'] = !empty(\\PayTracking\\Checkout::ultimoResultado()['resposta']['duplicate']);
$r['antigo_intacto'] = PAYTRACK_WEBHOOK_URL === 'http://127.0.0.1:9/api/webhook.php' && function_exists('paytrack_dispatch_sale');
echo json_encode($r);
`);
    expect(r).toEqual({ pix: true, aprovado: true, reenvio: true, reenvio_duplicado: true, antigo_intacto: true });

    const p = (await env.db.query(`SELECT status, amount_minor, products, utm_campaign FROM payments WHERE transaction_id = 'PHP-1'`)).rows[0];
    expect(p).toMatchObject({ status: 'approved', amount_minor: 19700n, utm_campaign: 'Campanha PHP' });
    if (sqlite) expect(p.products).toHaveLength(2);

    metaOk(env.fake);
    await dispatchBatch(env.ctx);
    const sent = JSON.parse(env.fake.calls.find((c) => c.url.includes('/events'))!.body!).data[0];
    expect(sent.event_name).toBe('Purchase');
    expect(sent.event_id).toBe('purchase_9452302_1793300000_ab12'); // o mesmo do Pixel e do arquivo antigo
    expect(sent.custom_data).toMatchObject({ value: 197, currency: 'BRL', utm_campaign: 'Campanha PHP' });
    expect(sent.user_data.fbc).toMatch(/^fb\.1\.\d{13}\.IwAR_php$/);
    for (const k of ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'external_id', 'fbp', 'client_ip_address', 'client_user_agent']) expect(sent.user_data[k], k).toBeTruthy();
  });

  it('cancelamento e estorno atualizam o status', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytracking.php';
\\PayTracking\\Checkout::configurar(['log_dir' => __DIR__ . '/logs']);
$a = ['id' => 'PHP-CANC', 'produto_id' => '9452302', 'valor' => 47];
$b = ['id' => 'PHP-1', 'produto_id' => '9452302', 'valor' => 197];
echo json_encode([
  'pix' => \\PayTracking\\Checkout::pixGerado($a),
  'cancelado' => \\PayTracking\\Checkout::cancelado($a),
  'reembolso' => \\PayTracking\\Checkout::reembolso($b),
]);
`);
    expect(r).toEqual({ pix: true, cancelado: true, reembolso: true });
    const s = await env.db.query(`SELECT transaction_id, status FROM payments WHERE transaction_id IN ('PHP-CANC', 'PHP-1') ORDER BY transaction_id`);
    expect(s.rows.map((x) => [x.transaction_id, x.status])).toEqual([['PHP-1', 'refunded'], ['PHP-CANC', 'canceled']]);
  });

  it('segredo errado: venda recusada, false para o checkout e motivo no log (sem token nem segredo)', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytracking.php';
\\PayTracking\\Checkout::configurar(['log_dir' => __DIR__ . '/logs-erro']);
echo json_encode(['ok' => \\PayTracking\\Checkout::pagamentoAprovado(['id' => 'PHP-X', 'valor' => 10]), 'http' => \\PayTracking\\Checkout::ultimoResultado()['http']]);
`, { PAYTRACKING_SECRET: 'segredo_errado' });
    expect(r).toEqual({ ok: false, http: 401 });
    const log = readFileSync(join(dir, 'logs-erro', 'paytracking.log'), 'utf8');
    expect(log).toContain('signature_mismatch');
    expect(log).not.toContain(token);
    expect(log).not.toContain('segredo_errado');
  });

  it('sem token configurado não envia nada e não quebra o checkout', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytracking.php';
\\PayTracking\\Checkout::configurar(['log_dir' => __DIR__ . '/logs-sem-token']);
echo json_encode(['ok' => \\PayTracking\\Checkout::pagamentoAprovado(['id' => 'PHP-Y', 'valor' => 10])]);
`, { PAYTRACKING_TOKEN: '' });
    expect(r).toEqual({ ok: false });
    expect(readFileSync(join(dir, 'logs-sem-token', 'paytracking.log'), 'utf8')).toContain('token não configurado');
  });
});

describe('modo sombra por integração', () => {
  it('registra a venda, mas não envia nada à Meta enquanto o envio estiver desligado', async () => {
    const acc = await newAccount(env);
    await newPixel(acc.client, { productIds: ['SOMBRA-PROD'] });
    const integ = await newIntegration(acc.client, 'checkout', { sendToMeta: false });
    expect(integ.integration.sendToMeta).toBe(false);
    const send = (body: object) => env.app.inject({ method: 'POST', url: '/api/webhook.php', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: `Bearer ${integ.token}` } });
    const r = await send({ event: 'sale.approved', status: 'paid', transaction_id: 'SOMBRA-1', value: 97, product_id: 'SOMBRA-PROD' });
    expect(r.json()).toMatchObject({ processed: true, status: 'approved', queued: false, shadow: true });
    expect((await env.db.query(`SELECT count(*)::int n FROM capi_outbox WHERE org_id = $1`, [acc.orgId])).rows[0].n).toBe(0);

    // ligando o envio, as próximas vendas vão para a Meta (as da sombra, não)
    await acc.client.patch(`/v1/integrations/${integ.integration.id}`, { sendToMeta: true });
    const r2 = await send({ event: 'sale.approved', status: 'paid', transaction_id: 'SOMBRA-2', value: 97, product_id: 'SOMBRA-PROD' });
    expect(r2.json()).toMatchObject({ status: 'approved', queued: true });
    expect(r2.json().shadow).toBeUndefined();
  });

  it('a integração do teste PHP continua enviando (padrão)', async () => {
    const list = (await client.get('/v1/integrations')).data.integrations;
    expect(list.find((i: { id: string }) => i.id === integrationId).sendToMeta).toBe(true);
  });
});

describe.skipIf(!php)('paytrack_integracao.php (painéis com a tabela paytrack_config)', () => {
  const cfg = () => `['webhook_url' => '${base}/api/webhook.php', 'api_token' => '${token}', 'secret' => '${SECRET}', 'eventos' => 'todos', 'ativo' => 1, 'log_dir' => __DIR__ . '/logs-int']`;
  const venda = (status: string, tx: string) => `['status' => '${status}', 'transaction_id' => '${tx}', 'value' => '197,00', 'product_id' => '9452302',
    'name' => 'Bruno Alves', 'email' => 'bruno@exemplo.com', 'customer' => ['city' => 'Natal', 'state' => 'RN'],
    'tracking' => ['purchase_event_id' => 'purchase_${tx}_pixel', 'utm_campaign' => 'direct', 'utm_source' => 'facebook'],
    'ip' => '177.9.9.9', 'user_agent' => 'Mozilla/5.0 (comprador)']`;

  it('teste de conexão confere token e segredo sem registrar nada', async () => {
    const before = (await env.db.query(`SELECT count(*)::int n FROM payments`)).rows[0].n;
    const r = await runPhp(`<?php
require __DIR__ . '/paytrack_integracao.php';
$_SERVER['REMOTE_ADDR'] = '200.1.1.1';
$c = ${cfg()};
echo json_encode(['ok' => paytrack_integracao_testar($c), 'errado' => paytrack_integracao_testar(['secret' => 'outro'] + $c)]);
`);
    expect(r.ok).toMatchObject({ success: true, http_code: 200 });
    expect(r.ok.message).toContain('assinatura válida');
    expect(r.errado).toMatchObject({ success: false, http_code: 401 });
    expect((await env.db.query(`SELECT count(*)::int n FROM payments`)).rows[0].n).toBe(before);
  });

  it('PIX gerado → aprovado; status desconhecido e outro produto não são enviados; IP é do comprador', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytrack_integracao.php';
$_SERVER['REMOTE_ADDR'] = '200.1.1.1'; // servidor do gateway
$c = ${cfg()};
echo json_encode([
  'pix' => paytrack_integracao_enviar($c, ${venda('pix_gerado', 'INT-1')})['success'],
  'aprovado' => paytrack_integracao_enviar($c, ${venda('venda_aprovada', 'INT-1')})['success'],
  'desconhecido' => paytrack_integracao_enviar($c, ${venda('compra_quase_feita', 'INT-2')}),
  'outro_produto' => paytrack_integracao_enviar(['produto_id' => 55] + $c, ${venda('venda_aprovada', 'INT-3')})['skipped'],
  'so_pix' => paytrack_integracao_enviar(['eventos' => 'pix_gerado'] + $c, ${venda('venda_aprovada', 'INT-4')})['skipped'],
]);
`);
    expect(r).toMatchObject({ pix: true, aprovado: true, outro_produto: true, so_pix: true });
    expect(r.desconhecido).toMatchObject({ success: true, skipped: true });
    const p = (await env.db.query(`SELECT status, utm_campaign, utm_source FROM payments WHERE transaction_id = 'INT-1'`)).rows[0];
    expect(p).toMatchObject({ status: 'approved', utm_campaign: null, utm_source: 'facebook' }); // "direct" não é campanha
    expect((await env.db.query(`SELECT count(*)::int n FROM payments WHERE transaction_id IN ('INT-2','INT-3','INT-4')`)).rows[0].n).toBe(0);
    const o = (await env.db.query(`SELECT o.payload FROM capi_outbox o JOIN payments p ON p.id = o.payment_id WHERE p.transaction_id = 'INT-1'`)).rows[0].payload;
    expect(o.event_id).toBe('purchase_INT-1_pixel');
    expect(o.user_data.client_ip_address).toBe('177.9.9.9');
    expect(o.user_data.client_user_agent).toBe('Mozilla/5.0 (comprador)');
  });

  it.skipIf(!sqlite)('enviar para todas as integrações ativas da tabela paytrack_config', async () => {
    const r = await runPhp(`<?php
require __DIR__ . '/paytrack_integracao.php';
$pdo = new PDO('sqlite::memory:');
$pdo->exec("CREATE TABLE paytrack_config (id INTEGER PRIMARY KEY, webhook_url TEXT, api_token TEXT, secret TEXT, produto_id INTEGER, eventos TEXT, ativo INTEGER)");
$pdo->exec("INSERT INTO paytrack_config VALUES (1, '${base}/api/webhooks/checkout_proprio', '${token}', '${SECRET}', NULL, 'todos', 1), (2, '${base}/api/webhook.php', 'itk_pausada', '', NULL, 'todos', 0)");
echo json_encode(paytrack_integracao_enviar_todas($pdo, ${venda('approved', 'INT-TODAS')}));
`);
    expect(Object.keys(r)).toEqual(['1']); // a inativa não é chamada
    expect(r['1']).toMatchObject({ success: true, http_code: 200 });
  });
});

describe('servidor: compatibilidade com painéis de checkout', () => {
  it('aceita /api/webhooks/checkout_proprio e o cabeçalho de teste não registra venda', async () => {
    const acc = await newAccount(env);
    const integ = await newIntegration(acc.client, 'checkout');
    const post = (url: string, headers: Record<string, string> = {}) => env.app.inject({ method: 'POST', url, payload: JSON.stringify({ event: 'paid', transaction_id: 'T-ALIAS', value: 10 }), headers: { 'content-type': 'application/json', authorization: `Bearer ${integ.token}`, ...headers } });
    expect((await post('/api/webhooks/checkout_proprio', { 'x-paytrack-test': '1' })).json()).toMatchObject({ success: true, test: true, signature: 'not_configured' });
    expect((await env.db.query(`SELECT count(*)::int n FROM payments WHERE org_id = $1`, [acc.orgId])).rows[0].n).toBe(0);
    expect((await post('/api/webhooks/checkout_proprio')).json()).toMatchObject({ processed: true, status: 'approved' });
  });
});
