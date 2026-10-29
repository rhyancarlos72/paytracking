import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  backoffDelayMs, buildServerEvent, canTransition, canonicalDecimal, classifyCapiResponse, classifyGenericStatus,
  convertMinor, convertWithQuote, crossRate, formatMoney, isPublicIp, isPurchaseTransition, mapEventName,
  matchUtmToRow, minorToDecimalString, parseAmount, parseTrackingCode, previousWindow, reportWindow, resolveStatus,
  localMidnightUtc,
} from '../src/index.js';

describe('money — cenário 14/15 (conversão, formatação, nulos, limites, arredondamento)', () => {
  it('lê unidade declarada sem heurística (P-04)', () => {
    expect(parseAmount(997, 'BRL', 'minor')).toBe(997n);
    expect(parseAmount(1000, 'BRL', 'major')).toBe(100000n);
    expect(parseAmount(19700, 'BRL', 'minor')).toBe(19700n);
    expect(parseAmount('197,00', 'BRL', 'major')).toBe(19700n);
    expect(parseAmount('R$ 1.234,56', 'BRL', 'major')).toBe(123456n);
    expect(parseAmount('1,234.56', 'USD', 'major')).toBe(123456n);
    expect(parseAmount('€ 49.9', 'EUR', 'major')).toBe(4990n);
  });
  it('rejeita valores inválidos e nulos', () => {
    expect(parseAmount(null, 'BRL', 'major')).toBeNull();
    expect(parseAmount('', 'BRL', 'major')).toBeNull();
    expect(parseAmount('abc', 'BRL', 'major')).toBeNull();
    expect(parseAmount(19.7, 'BRL', 'minor')).toBeNull();
    expect(parseAmount(Number.NaN, 'BRL', 'major')).toBeNull();
  });
  it('não sofre erro de ponto flutuante', () => {
    expect(parseAmount(0.1 + 0.2, 'BRL', 'major')).toBe(30n);
    expect(parseAmount(14.9, 'BRL', 'major')).toBe(1490n);
    expect(parseAmount(1.005, 'BRL', 'major')).toBe(101n);
  });
  it('arredonda half-up e respeita expoente ISO (JPY 0, KWD 3)', () => {
    expect(parseAmount('10.5', 'JPY', 'major')).toBe(11n);
    expect(parseAmount('1.2345', 'KWD', 'major')).toBe(1235n);
    expect(parseAmount('14.904', 'BRL', 'major')).toBe(1490n);
    expect(parseAmount('14.905', 'BRL', 'major')).toBe(1491n);
  });
  it('preserva as regras de separador do legado (pt_parse_money)', () => {
    expect(canonicalDecimal('1,234')).toBe('1234');
    expect(canonicalDecimal('14,90')).toBe('14.90');
    expect(canonicalDecimal('0,5')).toBe('0.5');
    expect(canonicalDecimal('1.234.567')).toBe('1234567');
  });
  it('formata por moeda', () => {
    expect(minorToDecimalString(19700n, 'BRL')).toBe('197.00');
    expect(minorToDecimalString(5n, 'BRL')).toBe('0.05');
    expect(minorToDecimalString(1500n, 'JPY')).toBe('1500');
    expect(formatMoney(19700n, 'BRL').replace(/\s/g, ' ')).toBe('R$ 197,00');
    expect(formatMoney(4990n, 'EUR')).toContain('49,90');
  });
});

describe('fx — conversão explícita, sem fallback silencioso', () => {
  it('converte EUR→BRL com a taxa informada', () => {
    expect(convertMinor(4990n, 'EUR', 'BRL', '6.12345678')).toBe(30556n);
    expect(convertMinor(100n, 'BRL', 'BRL', '999')).toBe(100n);
    expect(convertMinor(1000n, 'JPY', 'BRL', '0.0365')).toBe(3650n);
  });
  it('taxa cruzada via EUR', () => {
    // 1 EUR = 1.08 USD; 1 EUR = 6.00 BRL ⇒ 1 USD = 5.5555… BRL
    expect(crossRate('1.08', '6.00')).toBe('5.55555556');
  });
  it('sem cotação: não converte e sinaliza (nunca taxa 1.0)', () => {
    const r = convertWithQuote(4990n, 'EUR', 'BRL', null);
    expect(r.converted).toBe(false);
    expect(r.currency).toBe('EUR');
  });
});

describe('status de pagamento — cenários 6/7/8 e P-03', () => {
  it('tokens negativos NUNCA são lidos como pagos', () => {
    for (const s of ['unpaid', 'not_paid', 'disapproved', 'not paid']) expect(classifyGenericStatus(s)).toBe('failed');
    expect(classifyGenericStatus('paid_out')).toBeUndefined();
  });
  it('classificação exata', () => {
    expect(classifyGenericStatus('PAID')).toBe('approved');
    expect(classifyGenericStatus('Aprovado')).toBe('approved');
    expect(classifyGenericStatus('waiting_payment')).toBe('pending');
    expect(classifyGenericStatus('pix.generated')).toBe('pending');
    expect(classifyGenericStatus('refunded')).toBe('refunded');
    expect(classifyGenericStatus('chargedback')).toBe('chargeback');
  });
  it('resolve múltiplos campos: sinal negativo vence', () => {
    expect(resolveStatus(['paid', 'pending'])).toBe('pending');
    expect(resolveStatus(['approved', 'refunded'])).toBe('refunded');
    expect(resolveStatus(['xpto'])).toBe('unknown');
    expect(resolveStatus([])).toBe('none');
  });
  it('máquina de estados ignora regressões e gera Purchase uma vez', () => {
    expect(canTransition(null, 'pending')).toBe(true);
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('approved', 'approved')).toBe(false);
    expect(canTransition('approved', 'refunded')).toBe(true);
    expect(canTransition('refunded', 'approved')).toBe(false);
    expect(canTransition('canceled', 'approved')).toBe(true);
    expect(isPurchaseTransition('pending', 'approved')).toBe(true);
    expect(isPurchaseTransition(null, 'pending')).toBe(false);
  });
});

describe('mapEventName — preserva os aliases do legado', () => {
  it.each([
    ['purshase', 'Purchase'], ['payment.approved', 'Purchase'], ['pix_gerado', 'InitiateCheckout'],
    ['page_view', 'PageView'], ['sale.refunded', 'Refund'], ['checkout', 'InitiateCheckout'], ['lead', 'Lead'],
  ])('%s → %s', (raw, name) => expect(mapEventName(raw)).toBe(name));
  it('desconhecido → null', () => expect(mapEventName('xyz')).toBeNull());
});

describe('CAPI — paridade com MetaCapi::buildEventData (PHP legado)', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/legacy-capi-parity.json', import.meta.url), 'utf8'));
  it('Purchase completo gera o mesmo user_data/custom_data', () => {
    const { input, output } = fixtures[0];
    const u = input.user;
    const ev = buildServerEvent({
      eventName: 'Purchase', eventId: input.event_id, eventTime: input.event_time,
      eventSourceUrl: input.event_source_url,
      customer: {
        email: u.email, phone: u.phone, firstName: u.first_name, lastName: u.last_name, city: u.city,
        state: u.state, zip: u.zip, country: u.country, gender: u.gender, birthdate: u.birthdate,
        document: u.document, externalId: u.external_id,
      },
      tracking: { fbp: input.tracking.fbp, fbc: input.tracking.fbc, clientIp: input.tracking.client_ip_address, userAgent: input.tracking.client_user_agent },
      valueMinor: 19700n, currency: 'BRL',
      products: [{ id: 'P1', name: 'Curso', quantity: 1, priceMinor: 19700n }],
      orderId: 'tx-1', utms: { utm_source: 'fb', utm_campaign: 'camp|123' },
    });
    expect(ev.user_data).toEqual(output.user_data);
    expect(ev.custom_data).toEqual(output.custom_data);
    expect(ev.event_name).toBe(output.event_name);
  });
  it('PageView não leva valor; IP privado, fbp inválido e UA de gateway são descartados', () => {
    const { output } = fixtures[1];
    const ev = buildServerEvent({
      eventName: 'PageView', eventId: 'pv-1', eventTime: 1760000000,
      customer: { country: 'PT', externalId: 'abc' },
      tracking: { fbp: 'invalid', clientIp: '192.168.0.1', userAgent: 'Hotmart-Hooks/1.0' },
      valueMinor: 1000n, currency: 'EUR',
    });
    expect(ev.user_data).toEqual(output.user_data);
    expect(ev.custom_data).toEqual({});
  });
  it('isPublicIp', () => {
    expect(isPublicIp('177.10.20.30')).toBe(true);
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.3.3', '192.168.1.1', '::1', 'abc']) expect(isPublicIp(ip)).toBe(false);
  });
});

describe('classificação da resposta da Meta — cenários 9/12/13', () => {
  it('sucesso exige events_received', () => {
    expect(classifyCapiResponse(200, { events_received: 1, fbtrace_id: 'A' })).toEqual({ kind: 'sent', eventsReceived: 1, fbtraceId: 'A' });
    expect(classifyCapiResponse(200, {}).kind).toBe('retryable');
  });
  it('token inválido/expirado é permanente', () => {
    expect(classifyCapiResponse(400, { error: { code: 190, message: 'Invalid OAuth access token' } }).kind).toBe('permanent');
  });
  it('rate limit e erros temporários são recuperáveis', () => {
    expect(classifyCapiResponse(400, { error: { code: 17 } }).kind).toBe('rate_limited');
    expect(classifyCapiResponse(429, {}).kind).toBe('rate_limited');
    expect(classifyCapiResponse(500, { error: { code: 2, is_transient: true } }).kind).toBe('retryable');
    expect(classifyCapiResponse(0, null).kind).toBe('retryable');
  });
  it('backoff cresce e respeita o teto', () => {
    const fixed = () => 1;
    expect(backoffDelayMs(1, { random: fixed })).toBe(30_000);
    expect(backoffDelayMs(3, { random: fixed })).toBe(120_000);
    expect(backoffDelayMs(50, { random: fixed })).toBe(6 * 3600_000);
  });
});

describe('janelas de relatório no fuso da organização', () => {
  const now = new Date('2026-10-29T02:30:00Z'); // 23:30 de 28/10 em São Paulo
  it('hoje respeita o fuso (não o UTC)', () => {
    const w = reportWindow('today', 'America/Sao_Paulo', { now });
    expect(w.since).toBe('2026-10-28');
    expect(w.startUtc.toISOString()).toBe('2026-10-28T03:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-10-29T03:00:00.000Z');
  });
  it('7 dias inclui hoje e a janela anterior tem o mesmo tamanho', () => {
    const w = reportWindow('last_7d', 'America/Sao_Paulo', { now });
    expect([w.since, w.until, w.days]).toEqual(['2026-10-22', '2026-10-28', 7]);
    const p = previousWindow(w);
    expect([p.since, p.until]).toEqual(['2026-10-15', '2026-10-21']);
  });
  it('meia-noite em Lisboa (horário de verão)', () => {
    expect(localMidnightUtc('2026-07-01', 'Europe/Lisbon').toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });
});

describe('UTM', () => {
  it('lê xcod/sck nos dois formatos', () => {
    expect(parseTrackingCode('external_id=abc&fbp=fb.1.2.3&utm_source=fb')).toEqual({ external_id: 'abc', fbp: 'fb.1.2.3', utm_source: 'fb' });
    expect(parseTrackingCode('fb|cpc|black')).toEqual({ utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'black' });
  });
  it('casa por nome exato ou por ID contido', () => {
    const rows = [{ id: '120210000000001', name: 'Campanha A' }, { id: '120210000000002', name: 'Campanha B' }];
    expect(matchUtmToRow(['campanha b'], rows)).toBe(1);
    expect(matchUtmToRow(['x|120210000000001'], rows)).toBe(0);
    expect(matchUtmToRow([null, ''], rows)).toBe(-1);
  });
});
