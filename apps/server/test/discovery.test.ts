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
    for (const url of ['/.well-known/ai-catalog.json', '/sitemap.xml', '/qualquer.json', '/.well-known/algo']) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).not.toMatch(/<!doctype/i);
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
});
