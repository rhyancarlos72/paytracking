import { describe, expect, it } from 'vitest';
import { snippets } from '../src/pixels/routes.js';

const pixel = { public_key: 'pt_px_abc', meta_pixel_id: '1234567890123', currency: 'BRL', country: 'BR', ic_rule_type: 'none', ic_rule_value: null } as any;

describe('snippets de instalação (connect rate)', () => {
  it('a página de vendas dispara o PageView da Meta no próprio snippet, antes do pixel.js', () => {
    const s = snippets('https://paytracking.com.br', pixel);
    for (const code of [s.salesPage, s.salesPageWithClickIc, s.checkoutPage]) {
      expect(code).toContain('<link rel="preconnect" href="https://connect.facebook.net">');
      const boot = code.indexOf('fbevents.js');
      const pv = code.indexOf('"PageView"');
      const pixelJs = code.indexOf('/pixel.js');
      expect(boot).toBeGreaterThan(0);
      expect(pv).toBeGreaterThan(boot);
      expect(pixelJs).toBeGreaterThan(pv); // o pixel.js vem depois e reaproveita o event_id (window.__ptpv)
      expect(code).toContain('if(!w.fbq)'); // não carrega a Meta duas vezes se a página já tiver o Pixel
      expect(code).toContain('"1234567890123"');
    }
  });

  it('executa sem erro e registra o event_id do PageView', () => {
    const s = snippets('https://paytracking.com.br', pixel).salesPage;
    const js = /<script>(.*)<\/script>/.exec(s)![1]!;
    const head = { appendChild: () => {} };
    const w: any = { crypto: { randomUUID: () => 'uuid-1' } };
    const d = { createElement: () => ({ setAttribute() {} }), getElementsByTagName: () => [], head };
    new Function('window', 'document', js)(w, d);
    expect(w.__ptpv).toEqual({ '1234567890123': 'uuid-1' });
    expect(w.fbq.queue.map((a: IArguments) => Array.from(a))).toEqual([
      ['init', '1234567890123'],
      ['trackSingle', '1234567890123', 'PageView', {}, { eventID: 'uuid-1' }],
    ]);
  });
});
