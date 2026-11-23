import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('arquivos para buscadores e agentes de IA', () => {
  it('llms.txt é Markdown de verdade: título H1, resumo e links', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/llms.txt' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/markdown');
    expect(r.body.split('\n')[0]).toBe('# PayTracking');
    expect(r.body).toMatch(/^> /m);
    expect(r.body).toMatch(/\[Política de privacidade\]\(http[^)]+\/privacidade\)/);
    expect(r.body).not.toMatch(/<!doctype|<html/i);
  });

  it('arquivo inexistente (ai-catalog.json, sitemap.xml) é 404 — nunca o HTML do site', async () => {
    const home = await env.app.inject({ method: 'GET', url: '/entrar' });
    if (!String(home.headers['content-type']).includes('text/html')) return; // painel não compilado neste ambiente
    for (const url of ['/.well-known/ai-catalog.json', '/qualquer.json', '/.well-known/algo']) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).not.toMatch(/<!doctype/i);
    }
    // página inexistente: 404 de verdade (agentes e buscadores não a tratam como página que existe)
    for (const url of ['/pagina-que-nao-existe', '/vendas/a/b/c']) {
      expect((await env.app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
    // as páginas do painel continuam abrindo
    expect((await env.app.inject({ method: 'GET', url: '/vendas/123e4567-e89b-12d3-a456-426614174000' })).statusCode).toBe(200);
  });

  it('assetlinks.json autoriza o app Android (TWA) com o pacote e a impressão digital da chave', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
    const body = r.json() as Array<{ relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(body[0]!.target.namespace).toBe('android_app');
    expect(body[0]!.target.package_name).toBe('br.com.paytracking.app');
    expect(body[0]!.target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('APK do app Android baixa como arquivo, com o tipo certo', async () => {
    const home = await env.app.inject({ method: 'GET', url: '/entrar' });
    if (!String(home.headers['content-type']).includes('text/html')) return; // painel não compilado neste ambiente
    const r = await env.app.inject({ method: 'GET', url: '/download/paytracking.apk' });
    if (r.statusCode === 404) return; // build do painel sem o APK
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(r.headers['content-disposition']).toContain('PayTracking.apk');
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('robots.txt com Content-Signal e Sitemap; sitemap.xml lista as páginas públicas', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/robots.txt' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.body).toMatch(/^User-agent: \*$/m);
    expect(r.body).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m);
    expect(r.body).toMatch(/^Disallow: \/v1\/$/m);
    expect(r.body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
    const sm = await env.app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sm.headers['content-type']).toContain('application/xml');
    const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(locs).toEqual(expect.arrayContaining(['/', '/criar-conta', '/sobre', '/contato', '/termos', '/privacidade']));
  });

  it('Sobre e Contato existem, com contato em mailto:', async () => {
    for (const url of ['/sobre', '/contato']) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toContain('href="mailto:');
      expect(r.body).toContain('rel="canonical"');
    }
  });

  it('servidor MCP público: server card, initialize, tools/list e tools/call', async () => {
    const card = await env.app.inject({ method: 'GET', url: '/.well-known/mcp/server-card.json' });
    expect(card.statusCode).toBe(200);
    const c = card.json();
    expect(c).toMatchObject({ name: expect.any(String), version: expect.any(String), capabilities: { tools: expect.any(Object) } });
    expect(c.endpoints[0].url).toMatch(/\/mcp$/);
    const rpc = (body: object) => env.app.inject({ method: 'POST', url: '/mcp', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } });
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json().result.serverInfo.name).toBe('paytracking-public');
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(202);
    const tools = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json().result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(['get_product_info', 'get_pricing', 'get_contact']);
    const price = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_pricing', arguments: {} } })).json().result.content[0].text;
    expect(price).toMatch(/R\$ \d+,\d{2} por mês/);
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'apagar_tudo' } })).json().error.code).toBe(-32602);
  });

  it('página inicial: conteúdo sem JavaScript, canonical, JSON-LD completo, Link e Markdown para agentes', async () => {
    const home = await env.app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    if (!String(home.headers['content-type']).includes('text/html')) return; // painel não compilado neste ambiente
    expect(home.statusCode).toBe(200);
    const h = home.body;
    expect(h).toContain('<meta name="robots" content="index, follow" />');
    expect(h).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/" \/>/);
    expect(h).toMatch(/<div id="root"><main data-prerender[\s\S]*<h1>PayTracking/);
    expect(h).toMatch(/href="\/sobre"[\s\S]*href="\/contato"[\s\S]*href="\/termos"/);
    expect(h).toContain('href="mailto:');
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h)![1]!);
    const types = ld['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebPage', 'SoftwareApplication', 'FAQPage']));
    const org = ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'Organization');
    expect(org).toMatchObject({ name: 'PayTracking', email: expect.stringContaining('@'), sameAs: expect.any(Array) });
    expect(String(home.headers.link)).toContain('</llms.txt>; rel="describedby"');
    const md = await env.app.inject({ method: 'GET', url: '/', headers: { accept: 'text/markdown' } });
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body.split('\n')[0]).toBe('# PayTracking — rastreamento de vendas para Meta Ads');
    // páginas do painel não são indexadas
    const panel = await env.app.inject({ method: 'GET', url: '/campanhas' });
    expect(panel.statusCode).toBe(200);
    expect(panel.body).toContain('content="noindex, nofollow"');
  });
});
