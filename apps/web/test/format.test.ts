import { describe, expect, it } from 'vitest';
import { delta, maskEmail, minorToNumber, money, pct } from '../src/lib/format';

// o painel recebe valores em unidades menores (string, por causa do BigInt) e só formata
describe('formatação do painel', () => {
  it('converte unidades menores conforme o expoente da moeda', () => {
    expect(minorToNumber('19700', 'BRL')).toBe(197);
    expect(minorToNumber('500', 'JPY')).toBe(500);
    expect(minorToNumber('1234', 'KWD')).toBe(1.234);
    expect(minorToNumber(null, 'BRL')).toBe(0);
  });
  it('formata dinheiro em pt-BR sem reconverter', () => {
    expect(money('19700', 'BRL').replace(/\s/g, ' ')).toBe('R$ 197,00');
    expect(money('1000', 'USD').replace(/\s/g, ' ')).toBe('US$ 10,00');
  });
  it('variação sem base anterior não inventa percentual', () => {
    expect(delta(10, 0)).toBeNull();
    expect(delta(15, 10)).toBeCloseTo(0.5);
    expect(pct(null)).toBe('—');
  });
  it('mascara e-mail', () => {
    expect(maskEmail('fulano@exemplo.com')).not.toContain('fulano');
  });
});
