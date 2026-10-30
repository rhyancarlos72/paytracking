import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDispatchPhp, buildPaytrackingPhp, checkoutEndpoint } from '../src/lib/dispatch-php';

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

describe('paytracking.php (arquivo novo, independente) gerado pelo painel', () => {
  const php = buildPaytrackingPhp({ webhookUrl: 'https://paytracking.com.br/api/webhook.php', token: 'itk_novo', secret: "s'e\\c" });

  it('preenche as constantes da classe e usa nomes que não colidem com o arquivo antigo', () => {
    expect(php).toContain("private const URL = 'https://paytracking.com.br/api/webhook.php';");
    expect(php).toContain("private const TOKEN = 'itk_novo';");
    expect(php).toContain("private const SECRET = 's\\'e\\\\c';");
    expect(php).toContain('namespace PayTracking;');
    expect(php).not.toMatch(/__PAYTRACKING_(URL|TOKEN|SECRET)__/);
    expect(php).not.toMatch(/define\('PAYTRACK_|function paytrack_/); // nada do arquivo antigo
  });

  it.skipIf(!hasPhp)('é PHP válido (php -l)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptphp2-'));
    const f = join(dir, 'paytracking.php');
    writeFileSync(f, php);
    expect(execFileSync('php', ['-l', f]).toString()).toContain('No syntax errors');
  });
});
