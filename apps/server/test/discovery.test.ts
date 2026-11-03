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
});
