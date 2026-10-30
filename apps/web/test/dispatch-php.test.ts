import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDispatchPhp, checkoutEndpoint } from '../src/lib/dispatch-php';

const hasPhp = (() => { try { execFileSync('php', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('paytrack_dispatch.php gerado pelo painel', () => {
  const php = buildDispatchPhp({ webhookUrl: 'https://paytracking.com.br/api/webhook.php', token: 'itk_abc123', secret: "whsec_x'y\\z" });

  it('preenche URL, token e segredo e não carrega valores do sistema antigo', () => {
    expect(php).toContain("getenv('PAYTRACK_WEBHOOK_URL') ?: 'https://paytracking.com.br/api/webhook.php'");
    expect(php).toContain("getenv('PAYTRACK_TOKEN') ?: 'itk_abc123'");
    expect(php).toContain("getenv('PAYTRACK_SECRET') ?: 'whsec_x\\'y\\\\z'"); // aspas e barra escapadas
    expect(php).not.toMatch(/__PAYTRACK_|faturapack|itk_2d26/);
  });

  it('sem token, usa o marcador que o próprio PHP recusa (itk_cole…)', () => {
    expect(buildDispatchPhp({ webhookUrl: 'https://x/api/webhook.php' })).toContain("?: 'itk_cole_seu_token_aqui'");
  });

  it('endpoint do checkout é /api/webhook.php na origem da API', () => {
    expect(checkoutEndpoint('https://paytracking.com.br/v1/webhooks/checkout/itk_1')).toBe('https://paytracking.com.br/api/webhook.php');
  });

  it.skipIf(!hasPhp)('é PHP válido (php -l)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptphp-'));
    const f = join(dir, 'paytrack_dispatch.php');
    writeFileSync(f, php);
    expect(execFileSync('php', ['-l', f]).toString()).toContain('No syntax errors');
  });
});
