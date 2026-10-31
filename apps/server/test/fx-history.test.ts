import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FxTable } from '../src/fx/service.js';
import { json, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('câmbio: cotação histórica do período sob demanda', () => {
  it('venda em EUR de dias atrás, sem cotação gravada: busca a série do BCE e converte (antes: receita zero)', async () => {
    let calls = 0;
    env.fake.on(/api\.frankfurter\.dev\/v1\/\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}/, (url) => {
      calls++;
      expect(url.searchParams.get('symbols')).toBe('BRL');
      return json(200, { base: 'EUR', rates: { '2026-10-20': { BRL: 6.2 }, '2026-10-21': { BRL: 6.25 } } });
    });
    const before = await FxTable.load(env.db, ['BRL', 'EUR'], '2026-10-21', '2026-10-21');
    expect(before.convert(790n, 'EUR', 'BRL', '2026-10-21').converted).toBe(false);

    const fx = await FxTable.loadFor(env.ctx, ['BRL', 'EUR'], '2026-10-21', '2026-10-21');
    const c = fx.convert(790n, 'EUR', 'BRL', '2026-10-21');
    expect(c.converted).toBe(true);
    if (c.converted) expect(c.amountMinor).toBe(4938n); // € 7,90 × 6,25 = R$ 49,375 → R$ 49,38
    expect(calls).toBe(1);

    // já coberto: não busca de novo
    await FxTable.loadFor(env.ctx, ['BRL', 'EUR'], '2026-10-21', '2026-10-21');
    expect(calls).toBe(1);
  });

  it('fonte fora do ar: não quebra o relatório e não estima (segue "não convertido")', async () => {
    env.fake.reset();
    env.fake.on(/api\.frankfurter\.dev/, () => json(503, {}));
    const fx = await FxTable.loadFor(env.ctx, ['ARS', 'EUR'], '2026-09-01', '2026-09-01');
    expect(fx.convert(100n, 'EUR', 'ARS', '2026-09-01').converted).toBe(false);
  });
});
