<?php
/**
 * PayTracking — envio de vendas do checkout próprio (paytracking.php)
 * ============================================================================
 * Arquivo INDEPENDENTE: pode ficar junto com o paytrack_dispatch.php antigo sem
 * interferir nele. Tudo aqui tem nome próprio — namespace PayTracking, constantes
 * PAYTRACKING_* e log em logs/paytracking.log — então nada é redeclarado nem
 * sobrescrito, e cada arquivo envia para a sua própria plataforma.
 *
 * Gerado pelo painel (Integrações → Checkout próprio) com a URL, o token e o
 * segredo desta integração já preenchidos. Guarde-o como segredo: não publique
 * em repositório público.
 *
 * COMO USAR (no webhook do seu gateway — EFI, Woovi…):
 *
 *   require_once __DIR__ . '/paytracking.php';
 *
 *   // PIX/boleto gerado → venda PENDENTE (não vira Purchase)
 *   \PayTracking\Checkout::pixGerado($transacao, 'efi');
 *
 *   // PIX pago → venda APROVADA → Purchase na Meta (com order bumps)
 *   \PayTracking\Checkout::pagamentoAprovado($transacao, $pdo, 'efi');
 *
 *   // estorno / chargeback / cancelamento
 *   \PayTracking\Checkout::reembolso($transacao, 'efi');
 *
 * $transacao é a linha da sua tabela `transacoes` (id, produto_id, descricao,
 * valor, nome, sobrenome, email, telefone, cpf, cidade, estado, cep, device_ip,
 * user_agent, tracking_parameters…). Os nomes alternativos mais comuns também
 * são aceitos (transaction_id, product_id, amount, email…).
 *
 * GARANTIAS
 *   - Nunca lança exceção nem interrompe o checkout: retorna true/false e
 *     registra o motivo em logs/paytracking.log (sem token, segredo ou dados
 *     pessoais).
 *   - Reenvio é seguro: o PayTracking descarta duplicados, e o Purchase usa o
 *     MESMO event_id do Pixel e do paytrack_dispatch.php antigo — se os dois
 *     sistemas enviarem, a Meta conta uma venda só.
 *   - Cada envio é assinado (HMAC-SHA256 com carimbo de tempo): um POST forjado
 *     ou repetido depois de 5 minutos é recusado.
 *   - Falha de rede ou instabilidade (5xx/429): tenta de novo rapidamente, com
 *     limite de tempo para não segurar o webhook do gateway.
 *
 * Requer PHP 7.4+ (cURL recomendado; sem cURL usa as funções de stream do PHP).
 * ============================================================================
 */

declare(strict_types=1);

namespace PayTracking;

if (!class_exists(__NAMESPACE__ . '\\Checkout', false)) {

    final class Checkout
    {
        // >>> Preenchidos pelo painel. Também podem vir de constantes ou variáveis
        // de ambiente PAYTRACKING_URL, PAYTRACKING_TOKEN e PAYTRACKING_SECRET. <<<
        private const URL = '__PAYTRACKING_URL__';
        private const TOKEN = '__PAYTRACKING_TOKEN__';
        private const SECRET = '__PAYTRACKING_SECRET__';

        private const VERSION = '2.0.0';

        /** @var array<string, mixed> */
        private static $config = [];

        /** @var array<string, mixed> */
        private static $last = [];

        /**
         * Ajustes opcionais, ex.:
         *   Checkout::configurar(['log_dir' => '/caminho/logs', 'tabela_bumps' => 'transacoes_adicionais']);
         *
         * @param array<string, mixed> $c url, token, secret, timeout, connect_timeout, tentativas,
         *                                log_dir, tabela_bumps, moeda
         */
        public static function configurar(array $c): void
        {
            self::$config = array_replace(self::$config, $c);
        }

        /** PIX/boleto gerado: registra a venda como pendente (não gera Purchase). */
        public static function pixGerado(array $transacao, string $gateway = 'checkout'): bool
        {
            return self::guard(function () use ($transacao, $gateway) {
                $tracking = self::tracking($transacao);
                $eventId = self::first($tracking, ['initiate_checkout_event_id', 'initiateCheckoutEventId', 'ic_event_id', 'event_id', 'meta_event_id'], '');
                return self::enviar(self::payload($transacao, $gateway, 'sale.pending', 'pending', $tracking, null, $eventId));
            });
        }

        /** Pagamento confirmado pelo gateway: vira Purchase na Meta. $pdo (opcional) carrega os order bumps. */
        public static function pagamentoAprovado(array $transacao, $pdo = null, string $gateway = 'checkout'): bool
        {
            return self::guard(function () use ($transacao, $pdo, $gateway) {
                $tracking = self::tracking($transacao);
                // mesmo event_id do Pixel (salvo pelo checkout) e do paytrack_dispatch.php antigo
                $eventId = self::first($tracking, ['purchase_event_id', 'purchaseEventId', 'meta_purchase_event_id', 'meta_event_id', 'event_id'], '');
                if ($eventId === '') {
                    $eventId = 'purchase_' . self::transactionId($transacao);
                }
                return self::enviar(self::payload($transacao, $gateway, 'sale.approved', 'paid', $tracking, $pdo, $eventId));
            });
        }

        /** Estorno: a venda sai da receita e (se o pixel estiver configurado) a Meta recebe "Refund". */
        public static function reembolso(array $transacao, string $gateway = 'checkout'): bool
        {
            return self::guard(function () use ($transacao, $gateway) {
                return self::enviar(self::payload($transacao, $gateway, 'sale.refunded', 'refunded', self::tracking($transacao), null, ''));
            });
        }

        /** Chargeback (contestação no cartão). */
        public static function chargeback(array $transacao, string $gateway = 'checkout'): bool
        {
            return self::guard(function () use ($transacao, $gateway) {
                return self::enviar(self::payload($transacao, $gateway, 'sale.chargeback', 'chargeback', self::tracking($transacao), null, ''));
            });
        }

        /** PIX expirado / pedido cancelado antes do pagamento. */
        public static function cancelado(array $transacao, string $gateway = 'checkout'): bool
        {
            return self::guard(function () use ($transacao, $gateway) {
                return self::enviar(self::payload($transacao, $gateway, 'sale.canceled', 'canceled', self::tracking($transacao), null, ''));
            });
        }

        /**
         * Envio de baixo nível: aceita o mesmo formato JSON do webhook de checkout próprio.
         *
         * @param array<string, mixed> $payload
         */
        public static function enviar(array $payload): bool
        {
            return self::transmit($payload, []);
        }

        /**
         * Testa URL, token e segredo SEM registrar venda nem enviar nada à Meta.
         *
         * @return array{ok: bool, http: int, mensagem: string, resposta: array}
         */
        public static function testarConexao(): array
        {
            $ok = self::transmit(['event' => 'connection_test', 'transaction_id' => 'teste-de-conexao'], ['X-Paytrack-Test: 1']);
            $r = self::$last + ['http' => 0, 'resposta' => [], 'erro' => ''];
            $resp = is_array($r['resposta']) ? $r['resposta'] : [];
            if ($ok) {
                $msg = 'Conexão OK: URL e token válidos';
                $msg .= ($resp['signature'] ?? '') === 'valid' ? ', assinatura válida' : ' (sem segredo de assinatura configurado no PayTracking)';
                $msg .= isset($resp['sendToMeta']) && $resp['sendToMeta'] === false ? ' · integração em modo sombra' : '';
                $msg .= '. Nenhum evento foi enviado à Meta.';
            } elseif ((int) $r['http'] === 401) {
                $reason = (string) ($resp['reason'] ?? '');
                $msg = $reason === 'signature_mismatch' || $reason === 'missing_signature'
                    ? 'Segredo de assinatura diferente do configurado no PayTracking.'
                    : 'Token inválido ou integração pausada no PayTracking.';
            } elseif ((int) $r['http'] === 404) {
                $msg = 'URL não encontrada: use https://SEU-DOMINIO/api/webhook.php.';
            } elseif ((int) $r['http'] === 0) {
                $msg = 'Sem conexão com o PayTracking: ' . ($r['erro'] !== '' ? $r['erro'] : 'verifique a URL.');
            } else {
                $msg = 'O PayTracking respondeu HTTP ' . $r['http'] . '.';
            }
            return ['ok' => $ok, 'http' => (int) $r['http'], 'mensagem' => $msg, 'resposta' => $resp];
        }

        /** @param array<int, string> $extraHeaders */
        private static function transmit(array $payload, array $extraHeaders): bool
        {
            return self::guard(function () use ($payload, $extraHeaders) {
                self::$last = ['ok' => false, 'http' => 0, 'resposta' => [], 'erro' => 'não enviado', 'correlation_id' => null];
                $cfg = self::cfg();
                $tx = (string) ($payload['transaction_id'] ?? '');
                $ev = (string) ($payload['event'] ?? '');
                if ($cfg['token'] === '' || strpos($cfg['token'], '__PAYTRACKING') === 0 || strpos($cfg['token'], 'itk_cole') === 0) {
                    self::log('ERRO', $ev, $tx, 0, 'token não configurado em paytracking.php');
                    return false;
                }
                if ($cfg['url'] === '' || strpos($cfg['url'], '__PAYTRACKING') === 0) {
                    self::log('ERRO', $ev, $tx, 0, 'URL não configurada em paytracking.php');
                    return false;
                }
                $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
                if ($body === false) {
                    self::log('ERRO', $ev, $tx, 0, 'falha ao montar o JSON: ' . json_last_error_msg());
                    return false;
                }
                $headers = [
                    'Content-Type: application/json',
                    'Accept: application/json',
                    'Authorization: Bearer ' . $cfg['token'],
                    'User-Agent: PayTracking-PHP/' . self::VERSION . ' (+checkout-proprio)',
                    'Expect:',
                ];
                foreach ($extraHeaders as $h) {
                    $headers[] = $h;
                }
                if ($cfg['secret'] !== '') {
                    $ts = (string) time();
                    $headers[] = 'X-Paytrack-Timestamp: ' . $ts;
                    $headers[] = 'X-Paytrack-Signature: sha256=' . hash_hmac('sha256', $ts . '.' . $body, $cfg['secret']);
                }

                $started = microtime(true);
                $tries = max(1, (int) $cfg['tentativas']);
                $res = ['http' => 0, 'body' => '', 'error' => ''];
                for ($i = 1; $i <= $tries; $i++) {
                    $res = self::post($cfg, $headers, $body);
                    $retryable = $res['http'] === 0 || $res['http'] === 429 || $res['http'] >= 500;
                    // não segura o webhook do gateway por muito tempo
                    if (!$retryable || $i === $tries || microtime(true) - $started > 9.0) {
                        break;
                    }
                    usleep((int) (250000 * (2 ** ($i - 1)) + random_int(0, 150000)));
                }

                $json = json_decode((string) $res['body'], true);
                $json = is_array($json) ? $json : [];
                $ok = $res['http'] >= 200 && $res['http'] < 300;
                self::$last = [
                    'ok' => $ok,
                    'http' => $res['http'],
                    'resposta' => $json,
                    'erro' => $res['error'],
                    'correlation_id' => $json['correlationId'] ?? null,
                ];
                $motivo = $ok
                    ? (!empty($json['duplicate']) ? 'duplicado (já recebido)' : (string) ($json['status'] ?? 'processado')) . (!empty($json['shadow']) ? ' · modo sombra' : '')
                    : trim(($res['error'] !== '' ? $res['error'] . ' ' : '') . (string) ($json['error'] ?? '') . (isset($json['reason']) ? ' (' . $json['reason'] . ')' : ''));
                self::log($ok ? 'OK' : 'ERRO', $ev, $tx, $res['http'], $motivo, $json['correlationId'] ?? null);
                return $ok;
            });
        }

        /** Detalhes do último envio (http, resposta, correlation_id) — útil para depurar. */
        public static function ultimoResultado(): array
        {
            return self::$last;
        }

        // ------------------------------------------------------------------ montagem

        /** @return array<string, mixed> */
        private static function payload(array $t, string $gateway, string $event, string $status, array $tracking, $pdo, string $eventId): array
        {
            $cfg = self::cfg();
            $transactionId = self::transactionId($t);
            $productId = (string) self::first($t, ['produto_id', 'product_id', 'produtoId', 'productId'], '');
            $productName = (string) self::first($t, ['descricao', 'produto_nome', 'product_name', 'nome_produto'], '');
            $amount = self::money(self::first($t, ['valor', 'amount', 'value', 'total', 'valor_total'], null));
            $currency = strtoupper((string) self::first($t, ['moeda', 'currency'], $cfg['moeda']));

            $products = [];
            if ($productId !== '' || $productName !== '') {
                $products[] = ['id' => $productId, 'name' => $productName, 'quantity' => 1, 'price' => $amount];
            }
            if ($pdo instanceof \PDO && $transactionId !== '') {
                foreach (self::bumps($pdo, $transactionId) as $b) {
                    $products[] = $b;
                }
            }

            $fbp = self::first($tracking, ['fbp', '_fbp', 'fb_fbp'], self::first($t, ['fbp'], null));
            $fbc = self::first($tracking, ['fbc', '_fbc', 'fb_fbc'], self::first($t, ['fbc'], null));
            $fbclid = self::first($tracking, ['fbclid', 'fb_click_id'], self::first($t, ['fbclid'], null));
            if ((!is_string($fbc) || $fbc === '') && is_string($fbclid) && $fbclid !== '') {
                // data do clique ≈ criação da transação (estável entre reenvios)
                $created = isset($t['created_at']) ? strtotime((string) $t['created_at']) : false;
                $fbc = 'fb.1.' . (($created ?: time()) * 1000) . '.' . $fbclid;
            }
            $externalId = self::first($tracking, ['external_id', 'pt_xid', 'xid'], null);

            $url = (string) self::first($tracking, ['event_source_url', 'page_url', 'url'], '');
            if ($url === '' && $productId !== '' && !empty($_SERVER['HTTP_HOST'])) {
                $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
                $url = ($https ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . '/views/checkout.php?produto_id=' . rawurlencode($productId);
            }

            $first = self::first($t, ['nome', 'first_name'], null);
            $last = self::first($t, ['sobrenome', 'last_name'], null);
            $full = trim((string) self::first($t, ['nome_completo', 'name', 'customer_name'], trim((string) $first . ' ' . (string) $last)));
            if ((!$first || !$last) && $full !== '') {
                $parts = preg_split('/\s+/', $full) ?: [];
                $first = $first ?: ($parts[0] ?? null);
                $last = $last ?: (count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null);
            }

            $ip = self::first($t, ['device_ip', 'ip', 'client_ip', 'user_ip'], null);
            $ua = self::first($t, ['user_agent', 'client_user_agent'], null);

            return [
                'event' => $event,
                'status' => $status,
                'payment_status' => $status,
                'payment_method' => (string) self::first($t, ['metodo_pagamento', 'payment_method'], 'pix'),
                'gateway' => $gateway,
                'transaction_id' => $transactionId,
                'value' => $amount,
                'currency' => $currency !== '' ? $currency : 'BRL',
                'event_source_url' => $url,
                'product_id' => $productId,
                'product_name' => $productName,
                'products' => $products,
                'customer' => [
                    'first_name' => $first,
                    'last_name' => $last,
                    'name' => $full !== '' ? $full : null,
                    'email' => self::first($t, ['email', 'customer_email'], null),
                    'phone' => self::first($t, ['telefone', 'phone', 'celular'], null),
                    'document' => self::first($t, ['cpf', 'document', 'cnpj'], null),
                    'city' => self::first($t, ['cidade', 'city'], null),
                    'state' => self::first($t, ['estado', 'state', 'uf'], null),
                    'zip' => self::first($t, ['cep', 'zip'], null),
                    'country' => (string) self::first($t, ['pais', 'country'], 'BR'),
                    'external_id' => $externalId,
                ],
                'tracking' => [
                    'event_id' => $eventId !== '' ? $eventId : null,
                    'purchase_event_id' => $status === 'paid' && $eventId !== '' ? $eventId : null,
                    'external_id' => $externalId,
                    'pt_xid' => $externalId,
                    'fbp' => $fbp ?: null,
                    'fbc' => $fbc ?: null,
                    'fbclid' => $fbclid ?: null,
                    'utm_source' => self::first($tracking, ['utm_source'], null),
                    'utm_medium' => self::first($tracking, ['utm_medium'], null),
                    'utm_campaign' => self::first($tracking, ['utm_campaign'], null),
                    'utm_content' => self::first($tracking, ['utm_content'], null),
                    'utm_term' => self::first($tracking, ['utm_term'], null),
                    'utm_id' => self::first($tracking, ['utm_id', 'utmify_id'], null),
                    'client_ip_address' => $ip,
                    'client_user_agent' => $ua,
                ],
            ];
        }

        /** @return array<int, array<string, mixed>> */
        private static function bumps(\PDO $pdo, string $transactionId): array
        {
            $table = (string) self::cfg()['tabela_bumps'];
            if ($table === '' || !preg_match('/^[A-Za-z0-9_]+$/', $table)) {
                return [];
            }
            try {
                $st = $pdo->prepare("SELECT produto_id, nome, preco FROM {$table} WHERE transacao_id = ?");
                $st->execute([$transactionId]);
                $out = [];
                foreach ($st->fetchAll(\PDO::FETCH_ASSOC) as $b) {
                    $out[] = [
                        'id' => (string) ($b['produto_id'] ?? ''),
                        'name' => (string) ($b['nome'] ?? 'Bump'),
                        'quantity' => 1,
                        'price' => self::money($b['preco'] ?? null),
                    ];
                }
                return $out;
            } catch (\Throwable $e) {
                self::log('AVISO', 'bumps', $transactionId, 0, 'não foi possível ler os order bumps: ' . $e->getMessage());
                return [];
            }
        }

        /** tracking_parameters do checkout (JSON ou array) + campos de rastreio soltos na transação. */
        private static function tracking(array $t): array
        {
            $tp = $t['tracking_parameters'] ?? ($t['tracking'] ?? []);
            if (is_string($tp) && trim($tp) !== '') {
                $decoded = json_decode($tp, true);
                $tp = is_array($decoded) ? $decoded : [];
            }
            $tp = is_array($tp) ? $tp : [];
            foreach (['fbp', 'fbc', 'fbclid', 'external_id', 'pt_xid', 'event_id', 'purchase_event_id', 'initiate_checkout_event_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as $k) {
                if ((!isset($tp[$k]) || $tp[$k] === '') && isset($t[$k]) && $t[$k] !== '') {
                    $tp[$k] = $t[$k];
                }
            }
            return $tp;
        }

        private static function transactionId(array $t): string
        {
            return trim((string) self::first($t, ['id', 'transaction_id', 'transacao_id', 'pedido_id', 'txid'], ''));
        }

        /** Valor em reais com 2 casas (aceita "197,00", "197.00", 197). */
        private static function money($v): ?float
        {
            if ($v === null || $v === '') {
                return null;
            }
            if (is_string($v)) {
                $v = trim($v);
                if (preg_match('/^\d{1,3}(\.\d{3})+,\d+$/', $v)) {
                    $v = str_replace(['.', ','], ['', '.'], $v); // 1.234,56
                } elseif (strpos($v, ',') !== false && strpos($v, '.') === false) {
                    $v = str_replace(',', '.', $v); // 197,00
                }
            }
            return is_numeric($v) ? round((float) $v, 2) : null;
        }

        /** Primeiro valor não vazio entre aliases. */
        private static function first(array $src, array $keys, $default)
        {
            foreach ($keys as $k) {
                if (array_key_exists($k, $src) && $src[$k] !== null && $src[$k] !== '') {
                    return $src[$k];
                }
            }
            return $default;
        }

        // ------------------------------------------------------------------ transporte

        /** @return array{http:int, body:string, error:string} */
        private static function post(array $cfg, array $headers, string $body): array
        {
            if (function_exists('curl_init')) {
                $ch = curl_init($cfg['url']);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $body,
                    CURLOPT_HTTPHEADER => $headers,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => (int) $cfg['timeout'],
                    CURLOPT_CONNECTTIMEOUT => (int) $cfg['connect_timeout'],
                    CURLOPT_TCP_NODELAY => true,
                    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
                    CURLOPT_FOLLOWLOCATION => false,
                ]);
                $resp = curl_exec($ch);
                $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $err = curl_error($ch);
                curl_close($ch);
                return ['http' => $resp === false ? 0 : $http, 'body' => is_string($resp) ? $resp : '', 'error' => $resp === false ? $err : ''];
            }
            $ctx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => implode("\r\n", array_filter($headers, function ($h) { return $h !== 'Expect:'; })),
                'content' => $body,
                'timeout' => (float) $cfg['timeout'],
                'ignore_errors' => true,
            ]]);
            $resp = @file_get_contents($cfg['url'], false, $ctx);
            $http = 0;
            foreach ($http_response_header ?? [] as $line) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                    $http = (int) $m[1];
                }
            }
            return ['http' => $resp === false ? 0 : $http, 'body' => is_string($resp) ? $resp : '', 'error' => $resp === false ? 'falha de conexão' : ''];
        }

        // ------------------------------------------------------------------ apoio

        /** @return array<string, mixed> */
        private static function cfg(): array
        {
            $pick = function (string $name, string $fallback): string {
                if (defined($name)) {
                    return (string) constant($name);
                }
                $env = getenv($name);
                return $env !== false && $env !== '' ? $env : $fallback;
            };
            return array_replace([
                'url' => $pick('PAYTRACKING_URL', self::URL),
                'token' => $pick('PAYTRACKING_TOKEN', self::TOKEN),
                'secret' => $pick('PAYTRACKING_SECRET', self::SECRET),
                'timeout' => 6,
                'connect_timeout' => 3,
                'tentativas' => 3,
                'log_dir' => __DIR__ . '/../logs',
                'tabela_bumps' => 'transacoes_adicionais',
                'moeda' => 'BRL',
            ], self::$config);
        }

        private static function log(string $level, string $event, string $tx, int $http, string $msg, ?string $correlationId = null): void
        {
            try {
                $dir = (string) self::cfg()['log_dir'];
                if (!is_dir($dir)) {
                    @mkdir($dir, 0755, true);
                }
                $line = sprintf('[%s] %s %s tx=%s http=%d%s %s', date('Y-m-d H:i:s'), $level, $event, $tx, $http,
                    $correlationId ? ' id=' . $correlationId : '', $msg);
                @file_put_contents($dir . '/paytracking.log', $line . "\n", FILE_APPEND | LOCK_EX);
            } catch (\Throwable $e) {
                // log nunca derruba o checkout
            }
        }

        /** Executa sem nunca deixar escapar exceção para o checkout. */
        private static function guard(callable $fn): bool
        {
            try {
                return (bool) $fn();
            } catch (\Throwable $e) {
                self::log('ERRO', 'interno', '', 0, get_class($e) . ': ' . $e->getMessage());
                return false;
            }
        }
    }
}
