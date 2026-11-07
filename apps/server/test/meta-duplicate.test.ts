import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, newAccount, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const body = (i: number) => new URLSearchParams(env.fake.calls[i]!.body ?? '');

describe('duplicar campanha/conjunto na Meta', () => {
  it('copia em etapas (campanha → conjuntos → anúncios), sem estourar o limite de 3 itens da cópia completa; repete quantas vezes quiser', async () => {
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_7', 'BRL', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    let n = 0;
    env.fake.on(/\/1202000000000(01)\/copies$/, () => json(200, { copied_campaign_id: `9000${++n}` }));
    env.fake.on(/\/1202000000000(01)\/adsets/, () => json(200, { data: [
      { id: '120210000000001', effective_status: 'ACTIVE' }, { id: '120210000000002', effective_status: 'PAUSED' },
      { id: '120210000000003', effective_status: 'ARCHIVED' }, // arquivado: não copia
    ] }));
    env.fake.on(/\/12021000000000[12]\/copies$/, (u) => json(200, { copied_adset_id: `8${u.pathname.split('/').at(-2)}` }));
    env.fake.on(/\/12021000000000[12]\/ads/, () => json(200, { data: [{ id: '120220000000001', effective_status: 'ACTIVE' }, { id: '120220000000002', effective_status: 'ACTIVE' }] }));
    env.fake.on(/\/12022000000000[12]\/copies$/, () => json(200, { copied_ad_id: '7000' }));

    const start = env.fake.calls.length;
    const r = await acc.client.post('/v1/meta/entities/120200000000001/duplicate', { type: 'campaign' });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ok: true, newId: '90001', adsets: 2, ads: 4, failed: 0 });
    const posts = env.fake.calls.slice(start).map((c, i) => ({ c, i: start + i })).filter(({ c }) => c.method === 'POST');
    // 1º: a campanha, já ATIVA e sem cópia completa
    expect(posts[0]!.c.url).toMatch(/120200000000001\/copies$/);
    expect([body(posts[0]!.i).get('status_option'), body(posts[0]!.i).get('deep_copy')]).toEqual(['ACTIVE', 'false']);
    // conjuntos vão para a campanha nova mantendo o status de origem
    const adsetCopies = posts.filter(({ c }) => /12021000000000\d\/copies$/.test(c.url));
    expect(adsetCopies).toHaveLength(2);
    for (const { i } of adsetCopies) expect([body(i).get('campaign_id'), body(i).get('status_option')]).toEqual(['90001', 'INHERITED_FROM_SOURCE']);
    // anúncios vão para o conjunto novo
    const adCopies = posts.filter(({ c }) => /12022000000000\d\/copies$/.test(c.url));
    expect(adCopies).toHaveLength(4);
    expect(adCopies.map(({ i }) => body(i).get('adset_id'))).toEqual(['8120210000000001', '8120210000000001', '8120210000000002', '8120210000000002']);
    // de novo: outra cópia
    expect((await acc.client.post('/v1/meta/entities/120200000000001/duplicate', { type: 'campaign' })).data).toMatchObject({ newId: '90002', adsets: 2, ads: 4 });
  });

  it('conjunto: cópia ativa na mesma campanha + anúncios; um anúncio recusado pela Meta não perde o resto', async () => {
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_8', 'BRL', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    env.fake.on(/\/120210000000050\/copies$/, () => json(200, { copied_adset_id: '120210000000051' }));
    env.fake.on(/\/120210000000050\/ads/, () => json(200, { data: [{ id: '120220000000050', effective_status: 'ACTIVE' }, { id: '120220000000051', effective_status: 'ACTIVE' }] }));
    env.fake.on(/\/120220000000050\/copies$/, () => json(200, { copied_ad_id: '1' }));
    env.fake.on(/\/120220000000051\/copies$/, () => json(400, { error: { code: 100, message: 'Anúncio reprovado não pode ser copiado' } }));
    // plano B (mesmo criativo) também recusado pela Meta: o aviso mostra o motivo da Meta
    env.fake.on(/\/120220000000051\?/, () => json(200, { name: 'Reprovado', status: 'ACTIVE', account_id: '444', creative: { id: '1' } }));
    env.fake.on(/\/act_444\/ads$/, () => json(400, { error: { code: 100, message: 'Anúncio reprovado não pode ser copiado' } }));
    const r = await acc.client.post('/v1/meta/entities/120210000000050/duplicate', { type: 'adset' });
    expect(r.data).toMatchObject({ ok: true, newId: '120210000000051', adsets: 0, ads: 1, failed: 1, firstError: 'Anúncio reprovado não pode ser copiado' });
  });

  it('anúncio com "aprimoramentos padrão" (descontinuado pela Meta): copia criando o anúncio com o MESMO criativo', async () => {
    const acc = await newAccount(env);
    await env.db.query(`INSERT INTO meta_connections(org_id, access_token_enc, selected_ad_account_id, ad_account_currency, status) VALUES ($1, $2, 'act_9', 'BRL', 'active')`, [acc.orgId, env.ctx.box.encrypt('TOK')]);
    env.fake.on(/\/120210000000070\/copies$/, () => json(200, { copied_adset_id: '120210000000071' }));
    env.fake.on(/\/120210000000070\/ads/, () => json(200, { data: [{ id: '120220000000070', effective_status: 'ACTIVE' }] }));
    env.fake.on(/\/120220000000070\/copies$/, () => json(400, { error: { code: 100, message: 'O recurso de inclusão do campo de aprimoramentos padrão no criativo foi descontinuado. Defina recursos individuais.' } }));
    env.fake.on(/\/120220000000070\?/, () => json(200, { name: 'Criativo 03', status: 'ACTIVE', account_id: '555', creative: { id: '777000' } }));
    env.fake.on(/\/act_555\/ads$/, () => json(200, { id: '120220000000099' }));
    const start = env.fake.calls.length;
    const r = await acc.client.post('/v1/meta/entities/120210000000070/duplicate', { type: 'adset' });
    expect(r.data).toMatchObject({ ok: true, newId: '120210000000071', ads: 1, failed: 0 });
    const created = env.fake.calls.slice(start).find((c) => c.method === 'POST' && /act_555\/ads$/.test(c.url))!;
    const b = new URLSearchParams(created.body!);
    expect(b.get('adset_id')).toBe('120210000000071');
    expect(JSON.parse(b.get('creative')!)).toEqual({ creative_id: '777000' });
    expect([b.get('name'), b.get('status')]).toEqual(['Criativo 03 - Cópia', 'ACTIVE']);
  });
});
