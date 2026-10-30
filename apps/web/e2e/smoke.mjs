/**
 * Teste ponta a ponta (cenário 20) contra o BUILD DE PRODUÇÃO servido pelo servidor.
 * Pré-requisito: servidor rodando em BASE (padrão http://localhost:8080) com
 * META_GRAPH_BASE_URL=http://localhost:8099 (este script sobe um mock da Graph API).
 *
 * Fluxo: cadastro pela UI → criar pixel pela UI → integração → webhooks pendente/aprovado →
 * pixel.js numa página de vendas (outro domínio) → worker entrega à "Meta" (mock) →
 * todas as páginas carregam sem erro de console, em desktop e celular, claro e escuro.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright pré-instalado no ambiente (CI: pnpm dlx playwright); carregado via require para funcionar fora do workspace
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE ?? 'http://localhost:8080';
const SHOTS = process.env.SHOTS ?? 'e2e-screenshots';
mkdirSync(SHOTS, { recursive: true });

// ---- mock da Graph API: aceita eventos e registra o que recebeu
const received = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (/\/events$/.test(req.url ?? '')) {
      const j = JSON.parse(body || '{}');
      received.push(...(j.data ?? []));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ events_received: (j.data ?? []).length, fbtrace_id: 'MOCK' }));
    } else res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"1","name":"mock"}');
  });
}).listen(8099);

const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); console.error('✗', msg); } else console.log('✓', msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a página de vendas (outra origem) acessa a API em localhost: libera o Local Network Access só no teste
const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()}: ${m.text()}`));
page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));

try {
  // 1. cadastro pela interface
  const email = `e2e_${Date.now()}@demo.paytracking.dev`;
  await page.goto(`${BASE}/criar-conta`);
  await page.fill('#name', 'Demonstração E2E');
  await page.getByRole('button', { name: /Adicionar nome da empresa/ }).click();
  await page.fill('#org', 'Loja Demonstração');
  await page.fill('#email', email);
  await page.fill('#pw', 'SenhaForte123');
  await page.fill('#pw2', 'SenhaForte123');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  await page.getByRole('heading', { name: 'Resumo' }).waitFor();
  check(true, 'cadastro e login pela UI levam ao Resumo');

  // 2. criar pixel pela UI
  await page.goto(`${BASE}/pixels`);
  await page.getByRole('button', { name: 'Novo pixel' }).click();
  await page.fill('#n', 'Pixel Demonstração');
  await page.fill('#pid', '1234567890123');
  await page.fill('#tok', 'EAAG-token-demonstracao-e2e-123456');
  await page.fill('#prod', 'PROD-E2E');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('dialog', { name: /Instalar Pixel Demonstração/ }).waitFor();
  check(true, 'pixel criado pela UI e snippet exibido');
  const snippet = await page.locator('pre').first().innerText();
  check(snippet.includes('/pixel.js') && snippet.includes('pt_px_'), 'snippet contém pixel.js e chave pública');
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'Tab não escapa do diálogo aberto');
  await page.keyboard.press('Escape');

  // 3. integração de checkout próprio (via API, com a sessão do navegador)
  const api = (path, data, method = 'POST') => page.request.fetch(`${BASE}${path}`, { method, data, headers: { origin: BASE } });
  const integ = await (await api('/v1/integrations', { provider: 'checkout' })).json();
  check(!!integ.token, 'integração criada; token exibido uma única vez');

  // 4. pixel.js numa página de vendas de OUTRO domínio
  await ctx.route('http://127.0.0.1:3001/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>${snippet}</head><body><h1>Oferta</h1><a href="http://127.0.0.1:3002/checkout?produto_id=PROD-E2E" data-pt-checkout>Comprar agora</a></body></html>` }));
  await ctx.route('https://connect.facebook.net/**', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.fbq&&(window.fbq.callMethod=function(){});' }));
  await ctx.route('http://127.0.0.1:3002/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body>checkout</body></html>' }));
  const sales = await ctx.newPage();
  const collected = [];
  sales.on('request', (r) => r.url().includes('/v1/collect') && r.method() === 'POST' && collected.push(JSON.parse(r.postData() ?? '{}')));
  await sales.goto('http://127.0.0.1:3001/oferta?utm_source=facebook&utm_campaign=Campanha%20Demo&fbclid=IwAR_demo');
  await wait(1500);
  check(collected.some((c) => c.event === 'page_view' && c.event_id && c.external_id), 'pixel.js enviou PageView com event_id e external_id');
  const xid = collected[0]?.external_id;

  // 5. webhooks: pendente e depois aprovado (com o xid do visitante)
  const hook = (body) => page.request.post(`${BASE}/v1/webhooks/checkout`, { data: body, headers: { authorization: `Bearer ${integ.token}` } });
  const pend = await (await hook({ event: 'pix_generated', transaction_id: 'E2E-1', value: '197,00', product_id: 'PROD-E2E', customer: { email: 'comprador@demo.dev' } })).json();
  check(pend.status === 'pending' && pend.queued === false, 'PIX gerado vira pendente e NÃO gera Purchase');
  const paid = await (await hook({ event: 'paid', transaction_id: 'E2E-1', value: '197,00', product_id: 'PROD-E2E', customer: { email: 'comprador@demo.dev' }, tracking: { external_id: xid } })).json();
  check(paid.status === 'approved' && paid.queued === true, 'pagamento aprovado gera Purchase na fila');
  const dup = await (await hook({ event: 'paid', transaction_id: 'E2E-1', value: '197,00' })).json();
  check(dup.duplicate === true, 'webhook repetido é idempotente');

  // 6. worker embutido entrega à "Meta"
  for (let i = 0; i < 20 && !received.some((e) => e.event_name === 'Purchase'); i++) await wait(500);
  const purchase = received.find((e) => e.event_name === 'Purchase');
  check(!!purchase, 'worker entregou o Purchase à Graph API (mock)');
  check(purchase?.custom_data?.value === 197 && purchase?.custom_data?.currency === 'BRL', 'Purchase com value 197 BRL');
  check(!!purchase?.user_data?.fbc && purchase?.custom_data?.utm_campaign === 'Campanha Demo', 'Purchase herdou fbc e UTM do navegador (ponte de identidade)');
  check(received.some((e) => e.event_name === 'PageView'), 'PageView do navegador também entregue (mesmo event_id do Pixel)');

  // 7. todas as páginas: desktop claro, celular escuro
  const routes = ['/', '/campanhas', '/vendas', '/eventos', '/atribuicao', '/diagnostico', '/pixels', '/integracoes', '/integracoes/meta', '/configuracoes', '/financeiro', '/ajuda'];
  for (const r of routes) {
    await page.goto(`${BASE}${r}`);
    await page.waitForLoadState('networkidle');
    await page.locator('h1').first().waitFor();
    await page.screenshot({ path: `${SHOTS}/desktop${r.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
  }
  check(true, `${routes.length} páginas carregadas no desktop`);
  await page.goto(`${BASE}/vendas`);
  await page.getByText('E2E-1').waitFor();
  check(true, 'venda aparece na lista de Vendas');
  await page.goto(`${BASE}/`);
  await page.getByText('R$ 197,00').first().waitFor();
  check(true, 'Resumo mostra a receita confirmada R$ 197,00');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', storageState: await ctx.storageState() });
  const m = await mobile.newPage();
  m.on('pageerror', (e) => consoleErrors.push(`mobile ${m.url()}: ${e.message}`));
  for (const r of ['/', '/vendas', '/pixels', '/diagnostico']) {
    await m.goto(`${BASE}${r}`);
    await m.waitForLoadState('networkidle');
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, `celular ${r}: sem rolagem horizontal`);
    await m.screenshot({ path: `${SHOTS}/mobile-dark${r.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
  }
  await m.getByRole('button', { name: 'Abrir menu' }).click();
  await m.getByRole('link', { name: 'Eventos' }).click();
  await m.getByRole('heading', { name: 'Eventos' }).waitFor();
  check(true, 'menu móvel navega');
  await mobile.close();

  // 8. acessibilidade básica: navegação por teclado chega ao conteúdo
  await page.bringToFront();
  await page.goto(`${BASE}/pixels`);
  await page.locator('h1').first().waitFor();
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  console.log('foco:', focused);
  check(!!focused && focused.includes('Pular para o conteúdo'), 'primeiro Tab leva ao link "Pular para o conteúdo"');

  check(consoleErrors.length === 0, `sem erros de console (${consoleErrors.length})`);
  if (consoleErrors.length) console.error(consoleErrors.join('\n'));
} catch (e) {
  fails.push(String(e));
  console.error(e);
  await page.screenshot({ path: `${SHOTS}/falha.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  mock.close();
}
console.log(fails.length ? `\n${fails.length} FALHA(S)` : '\nE2E OK');
process.exit(fails.length ? 1 : 0);
