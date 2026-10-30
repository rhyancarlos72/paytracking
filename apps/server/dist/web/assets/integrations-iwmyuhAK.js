import{b as ie,u as A,a as m,e as ce,j as e}from"./query-Yz5d6HRD.js";import{c as C}from"./charts-DoFVN0zj.js";import{c as z,f as de,O as B,P as le,B as g,a1 as X,j as K,E as ue,o as F,Q as pe,N as W,l as O,a2 as U,k as G,x as me,h as w,$ as D,p as J,a3 as ge,a5 as $e,b as V,C as Q,_ as N,V as Z,F as R,I as ee,g as L}from"./index-BBK-x8Fq.js";import{e as fe}from"./react-DJEZOhnW.js";import{E as Y}from"./eye-off-BrOt-c3O.js";import{S as he}from"./shield-check-BvEntcZe.js";import{S as ve,D as M}from"./send-B208ylta.js";import{K as xe}from"./key-round-Cetw0CE1.js";import{C as _e}from"./code-xml-Dfl2r_w9.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ae=z("FileCode2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m5 12-3 3 3 3",key:"oke12k"}],["path",{d:"m9 18 3-3-3-3",key:"112psh"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const be=z("Webhook",[["path",{d:"M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2",key:"q3hayz"}],["path",{d:"m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06",key:"1go1hn"}],["path",{d:"m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8",key:"qlwsc0"}]]),ke=`<?php
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
 *   \\PayTracking\\Checkout::pixGerado($transacao, 'efi');
 *
 *   // PIX pago → venda APROVADA → Purchase na Meta (com order bumps)
 *   \\PayTracking\\Checkout::pagamentoAprovado($transacao, $pdo, 'efi');
 *
 *   // estorno / chargeback / cancelamento
 *   \\PayTracking\\Checkout::reembolso($transacao, 'efi');
 *
 * $transacao é a linha da sua tabela \`transacoes\` (id, produto_id, descricao,
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

if (!class_exists(__NAMESPACE__ . '\\\\Checkout', false)) {

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
            if ($pdo instanceof \\PDO && $transactionId !== '') {
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
                $parts = preg_split('/\\s+/', $full) ?: [];
                $first = $first ?: ($parts[0] ?? null);
                $last = $last ?: (count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null);
            }

            $ip = self::first($t, ['device_ip', 'ip', 'client_ip', 'user_ip'], null);
            // X-Forwarded-For pode trazer "comprador, proxy1, proxy2": o primeiro é o do comprador
            if (is_string($ip) && strpos($ip, ',') !== false) {
                $ip = trim(explode(',', $ip)[0]);
            }
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
        private static function bumps(\\PDO $pdo, string $transactionId): array
        {
            $table = (string) self::cfg()['tabela_bumps'];
            if ($table === '' || !preg_match('/^[A-Za-z0-9_]+$/', $table)) {
                return [];
            }
            try {
                $st = $pdo->prepare("SELECT produto_id, nome, preco FROM {$table} WHERE transacao_id = ?");
                $st->execute([$transactionId]);
                $out = [];
                foreach ($st->fetchAll(\\PDO::FETCH_ASSOC) as $b) {
                    $out[] = [
                        'id' => (string) ($b['produto_id'] ?? ''),
                        'name' => (string) ($b['nome'] ?? 'Bump'),
                        'quantity' => 1,
                        'price' => self::money($b['preco'] ?? null),
                    ];
                }
                return $out;
            } catch (\\Throwable $e) {
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
                if (preg_match('/^\\d{1,3}(\\.\\d{3})+,\\d+$/', $v)) {
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
                'header' => implode("\\r\\n", array_filter($headers, function ($h) { return $h !== 'Expect:'; })),
                'content' => $body,
                'timeout' => (float) $cfg['timeout'],
                'ignore_errors' => true,
            ]]);
            $resp = @file_get_contents($cfg['url'], false, $ctx);
            $http = 0;
            foreach ($http_response_header ?? [] as $line) {
                if (preg_match('#^HTTP/\\S+\\s+(\\d{3})#', $line, $m)) {
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
                @file_put_contents($dir . '/paytracking.log', $line . "\\n", FILE_APPEND | LOCK_EX);
            } catch (\\Throwable $e) {
                // log nunca derruba o checkout
            }
        }

        /** Executa sem nunca deixar escapar exceção para o checkout. */
        private static function guard(callable $fn): bool
        {
            try {
                return (bool) $fn();
            } catch (\\Throwable $e) {
                self::log('ERRO', 'interno', '', 0, get_class($e) . ': ' . $e->getMessage());
                return false;
            }
        }
    }
}
`,I=n=>n.replace(/\\/g,"\\\\").replace(/'/g,"\\'");function ne(n){return ke.split("__PAYTRACKING_URL__").join(I(n.webhookUrl)).split("__PAYTRACKING_TOKEN__").join(I(n.token||"itk_cole_seu_token_aqui")).split("__PAYTRACKING_SECRET__").join(I(n.secret||""))}function te(n,s,r="application/x-php"){const o=URL.createObjectURL(new Blob([s],{type:`${r};charset=utf-8`})),c=document.createElement("a");c.href=o,c.download=n,document.body.appendChild(c),c.click(),c.remove(),setTimeout(()=>URL.revokeObjectURL(o),1e3)}const re=n=>`${new URL(n).origin}/api/webhook.php`,oe={checkout:"Use o paytracking.php gerado aqui: arquivo independente (convive com o paytrack_dispatch.php antigo), que envia o PIX gerado e o pagamento aprovado com token e assinatura HMAC-SHA256.",kiwify:'Kiwify → Apps → Webhooks → Adicionar. Cole a URL e copie o "Token" do webhook para o campo segredo.',cakto:'Cakto → Integrações → Webhooks. Cole a URL e use o mesmo "secret" aqui.',kirvano:"Kirvano → Integrações → Webhooks. Cole a URL e use o mesmo token (enviado em security-token).",hotmart:"Hotmart → Ferramentas → Webhook (versão 2.0). Selecione compra aprovada, completa, reembolso, chargeback e cancelamento. Cole o Hottok no segredo.",lowify:"Lowify → Integrações → Webhooks. A URL já autentica. Confira a unidade do valor (reais ou centavos) com um pagamento de teste.",wiapay:"Wiapay → Configurações → Webhooks. A URL já autentica. Confira a unidade do valor com um pagamento de teste."},ye={checkout:{letter:"",cls:"bg-gradient-to-br from-[#7653ff] to-[#4f39e6]"},kiwify:{letter:"K",cls:"bg-gradient-to-br from-emerald-600 to-emerald-800"},hotmart:{letter:"H",cls:"bg-gradient-to-br from-orange-600 to-red-700"},cakto:{letter:"C",cls:"bg-gradient-to-br from-sky-600 to-blue-800"},kirvano:{letter:"Kv",cls:"bg-gradient-to-br from-violet-600 to-purple-800"},lowify:{letter:"L",cls:"bg-gradient-to-br from-teal-600 to-cyan-800"},wiapay:{letter:"W",cls:"bg-gradient-to-br from-pink-600 to-rose-800"}};function se({provider:n,className:s}){var o;const r=ye[n]??{letter:((o=n[0])==null?void 0:o.toUpperCase())??"?",cls:"bg-surface-3"};return e.jsx("span",{"aria-hidden":!0,className:C("flex shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm ring-1 ring-inset ring-white/10",r.cls,s??"h-11 w-11"),children:n==="checkout"?e.jsx(_e,{className:"h-5 w-5"}):r.letter})}function Le(){var k,d;const n=de(),s=ie(),r=B(),[o,c]=fe(),l=A({queryKey:["integrations"],queryFn:()=>L("/v1/integrations")}),i=A({queryKey:["pixels"],queryFn:()=>L("/v1/pixels")}),[v,$]=m.useState(null),[x,_]=m.useState(null),[y,b]=m.useState(null),j=()=>s.invalidateQueries({queryKey:["integrations"]}),f=ce({mutationFn:({id:a,body:p})=>$e(`/v1/integrations/${a}`,p),onSuccess:()=>{r.ok("Integração atualizada"),j()},onError:a=>r.err(a)}),h=n.can("admin"),E=a=>{var p,t;return(t=(((p=i.data)==null?void 0:p.pixels)??[]).find(T=>T.id===a))==null?void 0:t.name},P=(((k=l.data)==null?void 0:k.integrations)??[]).some(a=>a.provider==="checkout");return m.useEffect(()=>{const a=o.get("nova");if(a&&h){$(a==="1"?"hotmart":a);const p=new URLSearchParams(o);p.delete("nova"),c(p,{replace:!0})}},[o,h,c]),e.jsxs(e.Fragment,{children:[e.jsx(le,{title:"Integrações",eyebrow:"Configuração",description:"Gateways de pagamento e checkout próprio. Cada integração tem uma URL de webhook exclusiva e só confirma venda com pagamento aprovado.",actions:h&&e.jsx(g,{variant:"primary",icon:e.jsx(X,{className:"h-4 w-4"}),onClick:()=>$("hotmart"),children:"Nova integração"})}),x&&e.jsx(Ne,{r:x,onDone:()=>_(null)}),!P&&l.data&&!x&&h&&e.jsx(je,{onStart:()=>$("checkout")}),l.isError?e.jsx(K,{children:e.jsx(ue,{error:l.error,onRetry:()=>l.refetch()})}):l.data?l.data.integrations.length===0?e.jsx(K,{children:e.jsx(pe,{icon:e.jsx(W,{}),title:"Nenhuma integração",description:"Conecte Kiwify, Cakto, Kirvano, Hotmart, Lowify, Wiapay ou o seu checkout próprio para registrar as vendas reais.",action:h&&e.jsx(g,{variant:"primary",onClick:()=>$("hotmart"),children:"Adicionar integração"})})}):e.jsx("div",{className:"grid gap-5 xl:grid-cols-2",children:l.data.integrations.map(a=>{var T,q,H;const p=a.requiresSecret&&!a.secretConfigured,t=((T=a.stats)==null?void 0:T.rejected)??0;return e.jsxs("article",{className:"card card-interactive p-5",children:[e.jsxs("div",{className:"flex items-start justify-between gap-3",children:[e.jsxs("div",{className:"flex min-w-0 items-center gap-3",children:[e.jsx(se,{provider:a.provider}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("h2",{className:"truncate font-semibold",children:a.name}),e.jsxs("p",{className:"truncate text-xs text-muted",children:[a.providerLabel," · ",a.authMethod]})]})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[a.active&&!a.sendToMeta&&e.jsxs(O,{tone:"info",children:[e.jsx(Y,{className:"h-3 w-3","aria-hidden":!0}),"Modo sombra"]}),e.jsx(O,{tone:a.active?p?"warn":"ok":"neutral",dot:!0,children:a.active?p?"Falta segredo":"Ativa":"Pausada"}),h&&e.jsx(U,{checked:a.active,label:`Ativar ${a.name}`,onChange:u=>f.mutate({id:a.id,body:{active:u}})})]})]}),e.jsxs("div",{className:"mt-5 grid grid-cols-3 gap-2",children:[e.jsx(S,{label:"Processados (7 dias)",value:G(((q=a.stats)==null?void 0:q.processed)??0)}),e.jsx(S,{label:"Rejeitados",value:G(t),tone:t>0?"err":void 0}),e.jsx(S,{label:"Último webhook",value:me(a.lastReceivedAt),small:!0})]}),e.jsxs("dl",{className:"mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]",children:[e.jsx("dt",{className:"text-muted",children:"Token"}),e.jsx("dd",{className:"font-mono",children:a.tokenHint}),e.jsx("dt",{className:"text-muted",children:"Segredo"}),e.jsx("dd",{children:a.secretConfigured?e.jsxs("span",{className:"inline-flex items-center gap-1 text-ok",children:[e.jsx(he,{className:"h-3.5 w-3.5","aria-hidden":!0}),"configurado"]}):a.requiresSecret?e.jsx("span",{className:"text-err",children:"obrigatório"}):"opcional"}),e.jsx("dt",{className:"text-muted",children:"Pixel padrão"}),e.jsx("dd",{className:"truncate",children:E(a.defaultPixelId)??"por produto"}),a.configurableAmountUnit&&e.jsxs(e.Fragment,{children:[e.jsx("dt",{className:"text-muted",children:"Unidade do valor"}),e.jsx("dd",{children:a.amountUnit==="minor"?"centavos":"reais"})]})]}),e.jsxs("div",{className:C("mt-4 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3",a.sendToMeta?"border-border bg-surface-2/40":"border-info/30 bg-info/[0.06]"),children:[e.jsxs("div",{className:"min-w-0",children:[e.jsxs("p",{className:"flex items-center gap-1.5 text-[13px] font-semibold",children:[a.sendToMeta?e.jsx(ve,{className:"h-3.5 w-3.5 text-primary","aria-hidden":!0}):e.jsx(Y,{className:"h-3.5 w-3.5 text-info","aria-hidden":!0}),a.sendToMeta?"Enviando à Meta":"Modo sombra: registra sem enviar à Meta"]}),e.jsx("p",{className:"mt-0.5 text-xs text-muted",children:a.sendToMeta?"Vendas aprovadas viram Purchase na Conversions API.":"Use enquanto o sistema antigo ainda envia as conversões. Ao ligar, só as vendas novas são enviadas."})]}),h&&e.jsx(U,{checked:a.sendToMeta,label:`Enviar vendas de ${a.name} à Meta`,onChange:u=>f.mutate({id:a.id,body:{sendToMeta:u}})})]}),e.jsx("p",{className:"mt-3 text-xs leading-relaxed text-muted",children:oe[a.provider]}),h&&e.jsxs("div",{className:"mt-4 flex flex-wrap gap-2 border-t border-border pt-4",children:[a.provider==="checkout"&&e.jsx(g,{size:"sm",icon:e.jsx(M,{className:"h-4 w-4"}),title:"O token só aparece na criação: o arquivo vem sem ele (defina PAYTRACKING_TOKEN). Para um arquivo completo, use “Novo token”.",onClick:()=>te("paytracking.php",ne({webhookUrl:re(location.origin),token:null})),children:"Baixar paytracking.php (sem token)"}),e.jsx(g,{size:"sm",icon:e.jsx(xe,{className:"h-4 w-4"}),onClick:()=>b(a),children:a.secretConfigured?"Trocar segredo":"Definir segredo"}),e.jsxs(w,{"aria-label":"Pixel padrão",className:"h-8 w-[180px] rounded-lg text-[13px]",value:a.defaultPixelId??"",onChange:u=>f.mutate({id:a.id,body:{defaultPixelId:u.target.value||null}}),children:[e.jsx("option",{value:"",children:"Pixel: por produto"}),(((H=i.data)==null?void 0:H.pixels)??[]).map(u=>e.jsx("option",{value:u.id,children:u.name},u.id))]}),a.configurableAmountUnit&&e.jsxs(w,{"aria-label":"Unidade do valor",className:"h-8 w-[150px] rounded-lg text-[13px]",value:a.amountUnit,onChange:u=>f.mutate({id:a.id,body:{amountUnit:u.target.value}}),children:[e.jsx("option",{value:"major",children:"Valor em reais"}),e.jsx("option",{value:"minor",children:"Valor em centavos"})]}),e.jsx(D,{size:"sm",title:"Gerar nova URL e token?",description:"A URL e o token atuais deixam de funcionar imediatamente. Atualize no gateway (ou baixe o PHP de novo).",confirmLabel:"Gerar",onConfirm:async()=>{const u=await J(`/v1/integrations/${a.id}/rotate-token`);_({url:u.webhookUrl,token:u.token,provider:a.provider})},children:"Novo token"}),e.jsx(D,{size:"sm",variant:"ghost",danger:!0,title:`Excluir ${a.name}?`,description:"Webhooks enviados para esta URL passam a ser recusados.",confirmLabel:"Excluir",onConfirm:async()=>{await ge(`/v1/integrations/${a.id}`),await j()},children:"Excluir"})]})]},a.id)})}):e.jsxs("div",{className:"grid gap-4 xl:grid-cols-2",children:[e.jsx(F,{className:"h-64"}),e.jsx(F,{className:"h-64"})]}),v&&e.jsx(Ce,{initial:v,pixels:((d=i.data)==null?void 0:d.pixels)??[],onClose:()=>$(null),onCreated:a=>{$(null),_(a),j()}}),y&&e.jsx(Pe,{integ:y,onClose:()=>b(null),onSave:async a=>{await f.mutateAsync({id:y.id,body:{secret:a}}),b(null)}})]})}function S({label:n,value:s,tone:r,small:o}){return e.jsxs("div",{className:"rounded-xl border border-border bg-surface-2/50 px-3 py-2.5",children:[e.jsx("p",{className:"truncate text-[11px] text-muted",children:n}),e.jsx("p",{className:C("num mt-0.5 truncate font-semibold",o?"text-[13px]":"text-lg",r==="err"&&"text-err"),children:s})]})}function je({onStart:n}){return e.jsxs("section",{className:"card relative mb-6 overflow-hidden p-6 lg:p-8",children:[e.jsx("div",{className:"pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/20 blur-3xl","aria-hidden":!0}),e.jsx("div",{className:"pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-accent/10 blur-3xl","aria-hidden":!0}),e.jsxs("div",{className:"relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center",children:[e.jsxs("div",{children:[e.jsx(O,{tone:"primary",children:"Checkout próprio"}),e.jsx("h2",{className:"mt-3 text-2xl font-semibold",children:"Conecte o seu checkout em 3 passos"}),e.jsxs("p",{className:"mt-2 text-sm text-muted",children:["Geramos o ",e.jsx("code",{className:"rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]",children:"paytracking.php"})," já configurado — um arquivo independente, que convive com o paytrack_dispatch.php antigo sem misturar nada. Ele envia o PIX gerado e o pagamento aprovado, com order bumps, UTMs e o mesmo event_id do Pixel, e cada envio é assinado."]}),e.jsx(g,{variant:"primary",size:"lg",className:"mt-6",icon:e.jsx(X,{className:"h-4 w-4"}),onClick:n,children:"Criar integração do checkout"})]}),e.jsx("ol",{className:"space-y-3",children:[{icon:e.jsx(W,{}),t:"Crie a integração",d:"Defina um segredo para bloquear envios forjados."},{icon:e.jsx(M,{}),t:"Baixe o paytracking.php",d:"URL, token e segredo já vêm preenchidos."},{icon:e.jsx(ae,{}),t:"Chame no webhook do gateway",d:"Uma linha quando o PIX for gerado e outra quando for pago."}].map((s,r)=>e.jsxs("li",{className:"flex items-start gap-3 rounded-2xl border border-border bg-surface/70 p-4",children:[e.jsx("span",{className:"icon-tile-primary h-9 w-9 text-sm font-semibold","aria-hidden":!0,children:r+1}),e.jsxs("div",{children:[e.jsx("p",{className:"text-sm font-semibold",children:s.t}),e.jsx("p",{className:"text-xs text-muted",children:s.d})]})]},s.t))})]})]})}function Ne({r:n,onDone:s}){const r=n.provider==="checkout",o=re(n.url),[c,l]=m.useState(!1);return e.jsxs("section",{className:"card relative mb-6 overflow-hidden border-ok/30 p-6 animate-slide-up",children:[e.jsx("div",{className:"pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ok/10 blur-3xl","aria-hidden":!0}),e.jsxs("div",{className:"relative flex flex-wrap items-start justify-between gap-3",children:[e.jsxs("div",{className:"flex items-start gap-3",children:[e.jsx("span",{className:"flex h-10 w-10 items-center justify-center rounded-xl bg-ok/15 text-ok","aria-hidden":!0,children:e.jsx(V,{className:"h-5 w-5"})}),e.jsxs("div",{children:[e.jsx("h2",{className:"text-lg font-semibold",children:r?"Checkout próprio conectado":"Integração criada"}),e.jsx("p",{className:"text-sm text-muted",children:"Copie agora: o token não será exibido novamente."})]})]}),e.jsx(g,{size:"sm",onClick:s,children:"Concluído"})]}),r?e.jsxs("div",{className:"relative mt-6 grid gap-6 lg:grid-cols-2",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"rounded-2xl border border-primary/25 bg-primary/[0.06] p-5",children:[e.jsxs("p",{className:"flex items-center gap-2 text-sm font-semibold",children:[e.jsx(ae,{className:"h-4 w-4 text-primary","aria-hidden":!0}),"1. Baixe o paytracking.php já configurado"]}),e.jsxs("p",{className:"mt-1 text-xs text-muted",children:["Gerado no seu navegador com a URL, o token",n.secret?" e o segredo":""," desta integração. É um arquivo novo e independente: pode ficar ao lado do paytrack_dispatch.php antigo sem misturar nada. Guarde como um segredo."]}),e.jsx(g,{variant:"primary",className:"mt-4 w-full",icon:c?e.jsx(V,{className:"h-4 w-4"}):e.jsx(M,{className:"h-4 w-4"}),onClick:()=>{te("paytracking.php",ne({webhookUrl:o,token:n.token,secret:n.secret})),l(!0)},children:c?"Baixado — baixar de novo":"Baixar paytracking.php"}),!n.secret&&e.jsx("p",{className:"mt-3 text-xs text-warn",children:"Sem segredo: qualquer pessoa com o token consegue enviar vendas. Defina um segredo no cartão da integração e baixe o arquivo de novo."})]}),n.sendToMeta===!1&&e.jsx(Q,{tone:"info",title:"Modo sombra ligado",children:"As vendas serão registradas aqui, mas nada vai para a Meta enquanto o sistema antigo estiver ativo. Quando trocar, ligue “Enviar à Meta” no cartão da integração."}),e.jsx(N,{label:"URL (Authorization: Bearer)",code:o}),e.jsx(N,{label:"Token",code:n.token})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("p",{className:"text-sm font-semibold",children:"2. Suba na pasta dos webhooks e inclua no topo"}),e.jsx(N,{label:"webhook do gateway (EFI, Woovi…)",code:"require_once __DIR__ . '/paytracking.php';"}),e.jsx("p",{className:"text-sm font-semibold",children:"3. Chame nos momentos certos"}),e.jsx(N,{label:"PIX gerado · pago · estorno · expirado",code:["// PIX/boleto gerado → venda pendente (não vira Purchase)","\\PayTracking\\Checkout::pixGerado($transacao, 'efi');","","// PIX pago → venda aprovada → Purchase na Meta (com order bumps via $pdo)","\\PayTracking\\Checkout::pagamentoAprovado($transacao, $pdo, 'efi');","","// estorno do pagamento","\\PayTracking\\Checkout::reembolso($transacao, 'efi');","","// PIX expirado / pedido cancelado antes de pagar","\\PayTracking\\Checkout::cancelado($transacao, 'efi');"].join(`
`)}),e.jsxs("p",{className:"text-xs text-muted",children:["Nunca interrompe o seu checkout: retorna ",e.jsx("code",{className:"font-mono",children:"true"}),"/",e.jsx("code",{className:"font-mono",children:"false"})," e registra o motivo em ",e.jsx("code",{className:"font-mono",children:"logs/paytracking.log"}),". Pode manter as chamadas do arquivo antigo enquanto migra — o Purchase usa o mesmo event_id, então a Meta conta uma venda só."]})]})]}):e.jsx("div",{className:"relative mt-5 space-y-3",children:e.jsx(N,{label:"URL do webhook (cole no painel do gateway)",code:n.url})})]})}function Ce({initial:n,pixels:s,onClose:r,onCreated:o}){var p;const c=B(),l=A({queryKey:["providers"],queryFn:()=>L("/v1/integrations/providers")}),[i,v]=m.useState(n),[$,x]=m.useState(""),[_,y]=m.useState(""),[b,j]=m.useState("major"),[f,h]=m.useState(!0),[E,P]=m.useState(!1),k=((p=l.data)==null?void 0:p.providers)??[],d=k.find(t=>t.provider===i),a=i==="checkout";return e.jsx(Z,{open:!0,size:"lg",onClose:r,title:"Nova integração",description:"Escolha de onde vêm as vendas.",footer:e.jsxs(e.Fragment,{children:[e.jsx(g,{variant:"ghost",onClick:r,children:"Cancelar"}),e.jsx(g,{variant:"primary",loading:E,disabled:!!(d!=null&&d.requiresSecret)&&$.length<4,onClick:async()=>{P(!0);try{const t=await J("/v1/integrations",{provider:i,secret:$||void 0,defaultPixelId:_||void 0,amountUnit:b,sendToMeta:f});o({url:t.webhookUrl,token:t.token,provider:i,secret:$||void 0,sendToMeta:f})}catch(t){c.err(t)}finally{P(!1)}},children:"Criar integração"})]}),children:e.jsxs("div",{className:"space-y-5",children:[e.jsxs("fieldset",{children:[e.jsx("legend",{className:"label",children:"Origem das vendas"}),e.jsx("div",{role:"radiogroup","aria-label":"Origem das vendas",className:"grid grid-cols-2 gap-2 sm:grid-cols-4",children:(k.length?k:[{provider:"checkout",label:"Checkout próprio"}]).map(t=>e.jsxs("button",{type:"button",role:"radio","aria-checked":i===t.provider,onClick:()=>v(t.provider),className:C("flex flex-col items-center gap-2 rounded-2xl border p-3 text-center text-[13px] font-medium transition",i===t.provider?"border-primary bg-primary/[0.07] ring-2 ring-primary/25":"border-border hover:border-border-strong hover:bg-surface-2/60"),children:[e.jsx(se,{provider:t.provider,className:"h-9 w-9"}),t.label]},t.provider))})]}),e.jsxs("p",{className:"rounded-xl bg-surface-2/60 p-3 text-xs leading-relaxed text-muted",children:[e.jsx(be,{className:"mr-1 inline h-3.5 w-3.5","aria-hidden":!0}),oe[i]]}),e.jsx(R,{label:d!=null&&d.requiresSecret?"Segredo do webhook (obrigatório)":a?"Segredo de assinatura (recomendado)":"Segredo (opcional)",htmlFor:"sec",hint:a?"Vai junto no paytracking.php. Com ele, o PayTracking só aceita envios assinados com HMAC-SHA256.":d==null?void 0:d.authMethod,children:e.jsxs("div",{className:"flex gap-2",children:[e.jsx(ee,{id:"sec",type:"password",autoComplete:"off",value:$,onChange:t=>x(t.target.value)}),a&&e.jsx(g,{onClick:()=>x(`whsec_${Array.from(crypto.getRandomValues(new Uint8Array(24)),t=>t.toString(16).padStart(2,"0")).join("")}`),children:"Gerar"})]})}),e.jsxs("div",{className:"grid gap-4 sm:grid-cols-2",children:[e.jsx(R,{label:"Pixel padrão",htmlFor:"px",hint:"Usado quando o produto da venda não estiver em nenhum pixel.",children:e.jsxs(w,{id:"px",value:_,onChange:t=>y(t.target.value),children:[e.jsx("option",{value:"",children:"Somente por produto"}),s.map(t=>e.jsx("option",{value:t.id,children:t.name},t.id))]})}),(d==null?void 0:d.configurableAmountUnit)&&e.jsx(R,{label:"Unidade do valor enviado",htmlFor:"unit",hint:"O sistema não adivinha: confirme com um pagamento de teste.",children:e.jsxs(w,{id:"unit",value:b,onChange:t=>j(t.target.value),children:[e.jsx("option",{value:"major",children:"Reais (197.00)"}),e.jsx("option",{value:"minor",children:"Centavos (19700)"})]})})]}),e.jsxs("div",{className:C("flex items-start justify-between gap-4 rounded-2xl border p-4",f?"border-border":"border-info/30 bg-info/[0.06]"),children:[e.jsxs("div",{children:[e.jsx("p",{className:"text-sm font-semibold",children:"Enviar vendas à Meta (Conversions API)"}),e.jsx("p",{className:"mt-1 text-xs text-muted",children:f?"Desligue se outro sistema (ex.: o PayTracking antigo) ainda envia estas conversões: as vendas ficam registradas aqui em modo sombra, sem duplicar nada na Meta.":"Modo sombra: tudo é registrado e aparece no painel, mas nada vai para a Meta. Ligue quando o sistema antigo for desativado."})]}),e.jsx(U,{checked:f,label:"Enviar vendas à Meta",onChange:h})]}),a&&e.jsx(Q,{tone:"info",title:"Order bumps, UTMs e event_id já incluídos",children:"O paytracking.php lê os bumps da tabela transacoes_adicionais e reaproveita o purchase_event_id salvo pelo seu checkout, para a Meta deduplicar com o Pixel."})]})})}function Pe({integ:n,onClose:s,onSave:r}){const[o,c]=m.useState(""),[l,i]=m.useState(!1);return e.jsx(Z,{open:!0,onClose:s,title:`Segredo — ${n.name}`,description:n.authMethod,footer:e.jsxs(e.Fragment,{children:[!n.requiresSecret&&n.secretConfigured&&e.jsx(g,{variant:"ghost",onClick:async()=>{i(!0),await r(null).finally(()=>i(!1))},children:"Remover segredo"}),e.jsx(g,{variant:"primary",loading:l,disabled:o.length<4,onClick:async()=>{i(!0),await r(o).finally(()=>i(!1))},children:"Salvar"})]}),children:e.jsx(R,{label:"Novo segredo",htmlFor:"ns",hint:n.provider==="checkout"?"Depois de salvar, baixe o paytracking.php de novo (ou defina PAYTRACKING_SECRET com o mesmo valor). Armazenado criptografado.":"Armazenado criptografado. Nunca é exibido novamente.",children:e.jsx(ee,{id:"ns",type:"password",autoComplete:"off",value:o,onChange:v=>c(v.target.value)})})})}export{Le as default};
