import{b as oe,u as w,a as p,e as ie,j as e}from"./query-Cja5tRoQ.js";import{c as U}from"./charts-CR8FpLPf.js";import{c as E,d as ne,H as B,P as se,B as u,W as z,h as D,E as de,l as M,J as ce,_ as W,j as V,X as le,i as Y,v as pe,f as A,U as H,p as X,Y as ue,$ as me,a as F,R,M as G,F as P,I as J,C as _e,D as I}from"./index-C-RRGVLm.js";import{e as he}from"./react-VVgpSIX2.js";import{S as $e}from"./shield-check-BlGjBQHB.js";import{C as ge}from"./code-xml-CszQCyKg.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K=E("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q=E("FileCode2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m5 12-3 3 3 3",key:"oke12k"}],["path",{d:"m9 18 3-3-3-3",key:"112psh"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fe=E("KeyRound",[["path",{d:"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",key:"1s6t7t"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor",key:"w0ekpg"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xe=E("Webhook",[["path",{d:"M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2",key:"q3hayz"}],["path",{d:"m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06",key:"1go1hn"}],["path",{d:"m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8",key:"qlwsc0"}]]),ke=`<?php
/**
 * PAYTRACK DISPATCH — Drop-in para seu checkout próprio
 * ----------------------------------------------------------------------------
 * Envia eventos de venda do seu checkout (EFI Bank, Woovi, etc.) para o
 * PayTracking, que confirma o pagamento e repassa o Purchase para a Meta CAPI.
 *
 * Gerado pelo painel do PayTracking (Integrações → Checkout próprio) com a URL,
 * o token e o segredo desta integração já preenchidos. Guarde-o como segredo:
 * não versione em repositório público.
 *
 * Funciona EXATAMENTE igual ao lowtrack_dispatch.php: você chama
 *   paytrack_dispatch_sale($pdo, [ ...mesmos dados... ])
 * e pronto. A estrutura do array é idêntica à do LowTrack, então dá para
 * reaproveitar os blocos que você já tem.
 *
 * COMO USAR:
 *   1) Suba este arquivo na MESMA pasta dos seus webhooks (onde está o
 *      lowtrack_dispatch.php).
 *   2) As constantes abaixo já vêm preenchidas pelo painel (URL + token + segredo).
 *      O token identifica o pixel padrão. Se houver product_id/produto_id
 *      cadastrado em outro pixel, o painel roteia o Purchase automaticamente.
 *   3) Inclua no topo do webhook:
 *        if (file_exists(__DIR__ . '/paytrack_dispatch.php')) {
 *            require_once __DIR__ . '/paytrack_dispatch.php';
 *        }
 *   4) Copie seu bloco do LowTrack e troque lowtrack_dispatch_sale por
 *      paytrack_dispatch_sale (veja COMO-INTEGRAR.md).
 * ----------------------------------------------------------------------------
 */

declare(strict_types=1);

if (!defined('PAYTRACK_WEBHOOK_URL')) {
    // >>> EDITE AQUI <<<
    // URL do endpoint de webhook do seu painel (sem barra no final).
    // Ex.: https://seudominio.com/api/webhook.php
    define('PAYTRACK_WEBHOOK_URL', getenv('PAYTRACK_WEBHOOK_URL') ?: '__PAYTRACK_URL__');
}

if (!defined('PAYTRACK_TOKEN')) {
    // >>> EDITE AQUI <<<
    // Token de integração do projeto (gerado na aba "Pixels/Projetos" do painel).
    // Começa com "itk_".
    define('PAYTRACK_TOKEN', getenv('PAYTRACK_TOKEN') ?: '__PAYTRACK_TOKEN__');
}

if (!defined('PAYTRACK_SECRET')) {
    // >>> EDITE AQUI (opcional, mas recomendado) <<<
    // Segredo de assinatura do webhook (gerado na aba "Pixels" do painel, junto
    // ao pixel). Quando preenchido aqui E no painel, o checkout assina cada
    // requisição com HMAC-SHA256 e o painel só aceita requisições com a
    // assinatura correta — bloqueia POSTs forjados na URL do webhook.
    // Deixe vazio para manter apenas a autenticação por token.
    define('PAYTRACK_SECRET', getenv('PAYTRACK_SECRET') ?: '__PAYTRACK_SECRET__');
}



/**
 * >>> EDITE AQUI (IMPORTANTE para checkout com VÁRIOS produtos/pixels) <<<
 *
 * Mapa de roteamento: produto_id => token de integração (itk_...) do pixel
 * correspondente. Assim, cada Purchase é enviado para o PIXEL CERTO do produto
 * que foi vendido, em vez de cair sempre no pixel do PAYTRACK_TOKEN global.
 *
 * Exemplo:
 *   define('PAYTRACK_PRODUCT_TOKENS', [
 *       9452302 => 'itk_token_do_pixel_do_produto_A',
 *       1234567 => 'itk_token_do_pixel_do_produto_B',
 *   ]);
 *
 * Observação: se o produto não estiver no mapa e não houver correspondência no
 * painel, o Purchase usa o PAYTRACK_TOKEN global como fallback seguro.
 */
if (!defined('PAYTRACK_PRODUCT_TOKENS_JSON')) {
    // Permite configurar também por variável de ambiente em JSON: {"9452302":"itk_..."}
    define('PAYTRACK_PRODUCT_TOKENS_JSON', getenv('PAYTRACK_PRODUCT_TOKENS') ?: '');
}

if (!function_exists('paytrack_resolve_token')) {
    /**
     * Resolve o token de integração correto para a venda.
     * Ordem de prioridade:
     *   1) token explícito passado em $data['token'];
     *   2) mapa por produto (PAYTRACK_PRODUCT_TOKENS / *_JSON);
     *   3) PAYTRACK_TOKEN global como pixel padrão/fallback.
     */
    function paytrack_resolve_token(array $data): string
    {
        // 1) Override explícito por chamada.
        $explicit = trim((string) ($data['token'] ?? ''));
        if ($explicit !== '') {
            return $explicit;
        }

        // 2) Mapa por produto.
        $productId = (string) ($data['product_id'] ?? ($data['produto_id'] ?? ($data['product_sku'] ?? '')));
        if ($productId === '' && is_array($data['products'] ?? null) && isset($data['products'][0]['id'])) {
            $productId = (string) $data['products'][0]['id'];
        }
        if ($productId === '' && is_array($data['product'] ?? null) && isset($data['product']['id'])) {
            $productId = (string) $data['product']['id'];
        }

        if ($productId !== '') {
            $map = [];
            if (defined('PAYTRACK_PRODUCT_TOKENS') && is_array(PAYTRACK_PRODUCT_TOKENS)) {
                foreach (PAYTRACK_PRODUCT_TOKENS as $pid => $tok) {
                    $map[(string) $pid] = (string) $tok;
                }
            }
            if (PAYTRACK_PRODUCT_TOKENS_JSON !== '') {
                $decoded = json_decode(PAYTRACK_PRODUCT_TOKENS_JSON, true);
                if (is_array($decoded)) {
                    foreach ($decoded as $pid => $tok) {
                        $map[(string) $pid] = (string) $tok;
                    }
                }
            }
            if (isset($map[$productId]) && trim($map[$productId]) !== '') {
                return trim($map[$productId]);
            }
        }

        // 3) Token global do pixel padrão. O webhook do painel ainda pode
        // rotear por product_id se encontrar correspondência cadastrada.
        return PAYTRACK_TOKEN;
    }
}

if (!defined('PAYTRACK_TIMEOUT')) {
    // Timeout de leitura da resposta do painel. O painel agora envia à Meta de
    // forma sincrona no Purchase, entao damos folga suficiente (12s) para nao
    // abortar a chamada no meio — abortar aqui e o que fazia a venda cair no
    // cron e demorar. Para eventos nao criticos a resposta e imediata.
    define('PAYTRACK_TIMEOUT', 12);
}

if (!defined('PAYTRACK_CONNECT_TIMEOUT')) {
    // Conexao deve ser rapida: se o painel estiver fora, falha logo e loga.
    define('PAYTRACK_CONNECT_TIMEOUT', 4);
}

if (!defined('PAYTRACK_RETRIES')) {
    // Retentativa imediata em falha de rede/5xx — evita depender do cron.
    define('PAYTRACK_RETRIES', 2);
}

if (!function_exists('paytrack_log')) {
    function paytrack_log(string $message): void
    {
        // Mantém o mesmo padrão de logs por pasta /logs.
        $dir = __DIR__ . '/../logs';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        @file_put_contents(
            $dir . '/paytrack.log',
            '[' . date('Y-m-d H:i:s') . '] ' . $message . "\\n",
            FILE_APPEND
        );
    }
}

if (!function_exists('paytrack_first_filled')) {
    /** Retorna o primeiro valor não vazio de um array, aceitando vários aliases. */
    function paytrack_first_filled(array $source, array $keys, $default = null)
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $source) && $source[$key] !== null && $source[$key] !== '') {
                return $source[$key];
            }
        }
        return $default;
    }
}

if (!function_exists('paytrack_decode_tracking')) {
    /** tracking_parameters do checkout pode vir como JSON string ou array. */
    function paytrack_decode_tracking($tracking): array
    {
        if (is_array($tracking)) {
            return $tracking;
        }
        if (is_string($tracking) && trim($tracking) !== '') {
            $decoded = json_decode($tracking, true);
            return is_array($decoded) ? $decoded : [];
        }
        return [];
    }
}

if (!function_exists('paytrack_dispatch_checkout_purchase')) {
    /**
     * Mapeia a transação salva no SEU checkout para o payload PayTrack.
     *
     * Importante: aqui NÃO usamos o payload bruto da EFI/Woovi. O produto,
     * cliente e valor vêm da tabela transacoes do checkout; o payload PayTrack
     * é montado separadamente apenas para a plataforma de tracking.
     */
    function paytrack_dispatch_checkout_purchase($pdo, array $transacao, string $gateway = 'checkout'): bool
    {
        if (!function_exists('paytrack_dispatch_sale')) {
            paytrack_log('ERRO: paytrack_dispatch_sale indisponível.');
            return false;
        }

        $tracking = paytrack_decode_tracking($transacao['tracking_parameters'] ?? []);

        // Produtos adicionais/bumps também seguem no contents, sem substituir o
        // produto principal. Falha nessa consulta não bloqueia o Purchase.
        $products = [];
        $productId = (string) paytrack_first_filled($transacao, ['produto_id', 'product_id', 'produtoId'], '');
        $productName = (string) paytrack_first_filled($transacao, ['descricao', 'produto_nome', 'product_name', 'nome_produto'], '');
        $amount = round((float) paytrack_first_filled($transacao, ['valor', 'amount', 'value', 'total'], 0), 2);
        if ($productId !== '' || $productName !== '') {
            $products[] = [
                'id'       => $productId,
                'name'     => $productName,
                'quantity' => 1,
                'price'    => $amount,
            ];
        }

        try {
            if ($pdo instanceof PDO && !empty($transacao['id'])) {
                $stmt = $pdo->prepare('SELECT produto_id, nome, preco FROM transacoes_adicionais WHERE transacao_id = ?');
                $stmt->execute([$transacao['id']]);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $bump) {
                    $products[] = [
                        'id'       => (string) ($bump['produto_id'] ?? ''),
                        'name'     => (string) ($bump['nome'] ?? 'Bump'),
                        'quantity' => 1,
                        'price'    => isset($bump['preco']) ? round((float) $bump['preco'], 2) : null,
                    ];
                }
            }
        } catch (Throwable $e) {
            paytrack_log('AVISO: não foi possível carregar bumps da transação ' . (string)($transacao['id'] ?? '') . ': ' . $e->getMessage());
        }

        // Para Purchase, o ID correto é o purchase_event_id. Só usa event_id
        // genérico como fallback, pois ele pode ter sido usado no IC.
        $eventId = (string) paytrack_first_filled($tracking, [
            'purchase_event_id', 'purchaseEventId', 'meta_purchase_event_id',
            'meta_event_id', 'event_id'
        ], '');
        if ($eventId === '') {
            $eventId = 'purchase_' . (string) ($transacao['id'] ?? uniqid('', true));
        }

        $externalId = (string) paytrack_first_filled($tracking, ['external_id', 'pt_xid', 'xid'], '');
        $fbp = paytrack_first_filled($tracking, ['fbp', '_fbp', 'fb_fbp', 'fb-fbp'], $transacao['fbp'] ?? null);
        $fbc = paytrack_first_filled($tracking, ['fbc', '_fbc', 'fb_fbc', 'fb-fbc'], $transacao['fbc'] ?? null);
        $fbclid = paytrack_first_filled($tracking, ['fbclid', 'fb_click_id'], $transacao['fbclid'] ?? null);
        if ((empty($fbc) || !is_string($fbc)) && !empty($fbclid)) {
            $fbc = 'fb.1.' . (int) round(microtime(true) * 1000) . '.' . $fbclid;
        }

        $eventSourceUrl = (string) paytrack_first_filled($tracking, ['event_source_url', 'page_url', 'url'], '');
        if ($eventSourceUrl === '' && $productId !== '' && !empty($_SERVER['HTTP_HOST'])) {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $eventSourceUrl = $scheme . '://' . $_SERVER['HTTP_HOST'] . '/views/checkout.php?produto_id=' . rawurlencode($productId);
        }

        $transactionId = (string) paytrack_first_filled($transacao, ['id', 'transaction_id', 'pedido_id'], '');

        return paytrack_dispatch_sale($pdo, [
            'event'          => 'sale.approved',
            'status'         => 'paid',
            'payment_status' => 'paid',
            'transaction_id' => $transactionId,
            'amount'         => $amount,
            'currency'       => 'BRL',
            'payment_method' => 'pix',
            'gateway'        => $gateway,
            'event_source_url' => $eventSourceUrl,
            'product_id'     => $productId,
            'product_name'   => $productName,
            'products'       => $products,
            'customer' => [
                'first_name'  => $transacao['nome'] ?? null,
                'last_name'   => $transacao['sobrenome'] ?? null,
                'name'        => trim((string)($transacao['nome'] ?? '') . ' ' . (string)($transacao['sobrenome'] ?? '')),
                'email'       => $transacao['email'] ?? null,
                'phone'       => $transacao['telefone'] ?? null,
                'document'    => $transacao['cpf'] ?? null,
                'city'        => $transacao['cidade'] ?? null,
                'state'       => $transacao['estado'] ?? null,
                'zip'         => $transacao['cep'] ?? null,
                'country'     => 'BR',
                'external_id' => $externalId ?: null,
            ],
            'tracking' => [
                'event_id'     => $eventId,
                'external_id'  => $externalId ?: null,
                'pt_xid'       => $externalId ?: null,
                'fbp'          => $fbp ?: null,
                'fbc'          => $fbc ?: null,
                'fbclid'       => $fbclid ?: null,
                'utm_source'   => paytrack_first_filled($tracking, ['utm_source'], null),
                'utm_medium'   => paytrack_first_filled($tracking, ['utm_medium'], null),
                'utm_campaign' => paytrack_first_filled($tracking, ['utm_campaign'], null),
                'utm_content'  => paytrack_first_filled($tracking, ['utm_content'], null),
                'utm_term'     => paytrack_first_filled($tracking, ['utm_term'], null),
                'utm_id'       => paytrack_first_filled($tracking, ['utm_id', 'utmify_id'], null),
                'client_ip_address' => $transacao['device_ip'] ?? null,
                'client_user_agent' => $transacao['user_agent'] ?? null,
            ],
            'user_ip'    => $transacao['device_ip'] ?? null,
            'user_agent' => $transacao['user_agent'] ?? null,
            'metadata'   => ['gateway' => $gateway],
        ]);
    }
}

/**
 * Dispara um evento de venda para o php-tracker.
 *
 * Aceita a MESMA estrutura de dados do lowtrack_dispatch_sale:
 *   [
 *     'event'          => 'sale.approved' | 'sale.pending' | 'lead' | ...,
 *     'transaction_id' => '12345',
 *     'amount'         => 97.00,            // (ou 'value')
 *     'currency'       => 'BRL',
 *     'product_id'     => 1,
 *     'product_name'   => 'Produto X',
 *     'products'       => [['id'=>1,'name'=>'X','quantity'=>1,'price'=>97.0]],
 *     'customer'       => [
 *        'first_name','last_name','email','phone','document',
 *        'city','state','zip','country','gender','birthdate'
 *     ],
 *     'tracking'       => ['fbp'=>..., 'fbc'=>..., 'event_id'=>..., 'external_id'=>...(pt_xid), 'utm_source'=>...],
 *     'user_ip'        => '1.2.3.4',
 *     'user_agent'     => '...',
 *     'event_source_url' => 'https://...'
 *   ]
 *
 * @param mixed $pdo   Ignorado (mantido por compatibilidade com o LowTrack).
 * @param array $data  Dados do evento.
 * @return bool        true se o painel aceitou (enfileirou/duplicado), false em erro.
 */
function paytrack_dispatch_sale($pdo, array $data): bool
{
    // Resolve o token do PIXEL CERTO para este produto (corrige Purchase no pixel errado).
    $token = paytrack_resolve_token($data);
    if ($token === '' || strpos($token, 'itk_cole') === 0) {
        paytrack_log('ERRO: token de integração não configurado (produto_id=' . (string) ($data['product_id'] ?? '') . ').');
        return false;
    }

    $customer = is_array($data['customer'] ?? null) ? $data['customer'] : [];
    $payer = is_array($data['payer'] ?? null) ? $data['payer'] : [];
    $tracking = is_array($data['tracking'] ?? null) ? $data['tracking'] : [];
    if (is_array($data['tracking_parameters'] ?? null)) {
        $tracking = array_replace($data['tracking_parameters'], $tracking);
    }
    foreach (['fbp', 'fbc', 'fbclid', 'external_id', 'pt_xid', 'event_id', 'meta_event_id', 'initiate_checkout_event_id', 'purchase_event_id'] as $trackKey) {
        if (empty($tracking[$trackKey]) && !empty($data[$trackKey])) {
            $tracking[$trackKey] = $data[$trackKey];
        }
        if (empty($tracking[$trackKey]) && !empty($payer[$trackKey])) {
            $tracking[$trackKey] = $payer[$trackKey];
        }
    }
    if (empty($tracking['fbc']) && !empty($tracking['fbclid'])) {
        $tracking['fbc'] = 'fb.1.' . (int) round(microtime(true) * 1000) . '.' . $tracking['fbclid'];
    }

    // Normaliza produtos (aceita o formato simples [id,name] do LowTrack).
    $products = [];
    if (is_array($data['products'] ?? null)) {
        foreach ($data['products'] as $p) {
            if (!is_array($p)) {
                continue;
            }
            $products[] = [
                'id'       => (string) ($p['id'] ?? ($p['name'] ?? '')),
                'name'     => (string) ($p['name'] ?? ''),
                'quantity' => (int) ($p['quantity'] ?? 1),
                'price'    => isset($p['price']) ? round((float) $p['price'], 2) : null,
            ];
        }
    }
    if (!$products && is_array($data['product'] ?? null)) {
        $products[] = [
            'id'       => (string) ($data['product']['id'] ?? ($data['product_id'] ?? '')),
            'name'     => (string) ($data['product']['name'] ?? ($data['product']['title'] ?? ($data['product_name'] ?? ''))),
            'quantity' => (int) ($data['product']['quantity'] ?? 1),
            'price'    => isset($data['product']['price']) ? round((float) $data['product']['price'], 2) : (isset($data['amount']) ? round((float) $data['amount'], 2) : null),
        ];
    }
    if (!$products && !empty($data['product_id'])) {
        $products[] = [
            'id'       => (string) $data['product_id'],
            'name'     => (string) ($data['product_name'] ?? ''),
            'quantity' => 1,
            'price'    => isset($data['amount']) ? round((float) $data['amount'], 2) : null,
        ];
    }

    // Valor: aceita 'value' ou 'amount'.
    $value = $data['value'] ?? ($data['amount'] ?? ($data['product_price'] ?? null));

    // event_id: CIENTE DO TIPO DE EVENTO (dedup com o Pixel do navegador). O
    // checkout usa um id diferente por evento; para InitiateCheckout (PIX gerado)
    // o id certo é initiate_checkout_event_id, para Purchase é purchase_event_id.
    // Detecção local (sem depender do MetaCapi, que vive no app paytrack).
    $rawEvent = strtolower((string) ($data['event'] ?? ($data['status'] ?? '')));
    $isPurchase = (bool) preg_match('/(purchase|approv|aprovad|paid|pago|sale\\.?_?approved|order\\.?_?paid)/', $rawEvent);
    if ($isPurchase) {
        $eventIdKeys = ['purchase_event_id', 'purchaseEventId', 'meta_purchase_event_id', 'event_id', 'meta_event_id'];
    } else {
        // pending / pix gerado / checkout => InitiateCheckout
        $eventIdKeys = ['initiate_checkout_event_id', 'initiateCheckoutEventId', 'ic_event_id', 'event_id', 'meta_event_id'];
    }
    $eventId = '';
    foreach ($eventIdKeys as $k) {
        $candidate = trim((string) ($tracking[$k] ?? ($data[$k] ?? '')));
        if ($candidate !== '') { $eventId = $candidate; break; }
    }
    if ($eventId === '') {
        $eventId = (string) ($data['transaction_id'] ?? '');
    }



    $phone = $customer['phone'] ?? $customer['telefone'] ?? $payer['phone'] ?? null;
    if (is_array($phone)) {
        $phone = trim((string) ($phone['area_code'] ?? '')) . trim((string) ($phone['number'] ?? ''));
    }
    $firstName = $customer['first_name'] ?? $payer['first_name'] ?? null;
    $lastName = $customer['last_name'] ?? $payer['last_name'] ?? null;
    $fullName = trim((string) ($customer['name'] ?? $payer['full_name'] ?? $payer['name'] ?? ''));
    if ((!$firstName || !$lastName) && $fullName !== '') {
        $parts = preg_split('/\\s+/', $fullName) ?: [];
        $firstName = $firstName ?: ($parts[0] ?? null);
        $lastName = $lastName ?: (count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null);
    }

    $payload = [
        'event'            => (string) ($data['event'] ?? 'sale.approved'),
        'status'           => $data['status'] ?? null,
        'payment_status'   => $data['payment_status'] ?? null,
        'payment_method'   => $data['payment_method'] ?? null,
        'gateway'          => $data['gateway'] ?? ($data['metadata']['gateway'] ?? null),
        'transaction_id'   => (string) ($data['transaction_id'] ?? ''),
        'value'            => $value !== null ? round((float) $value, 2) : null,
        'currency'         => strtoupper((string) ($data['currency'] ?? 'BRL')),
        'event_source_url' => (string) ($data['event_source_url'] ?? ''),
        'product_id'       => (string) ($data['product_id'] ?? ($data['produto_id'] ?? ($data['product_sku'] ?? ($products[0]['id'] ?? '')))),
        'product_name'     => (string) ($data['product_name'] ?? ($data['produto_nome'] ?? ($data['description'] ?? ($products[0]['name'] ?? '')))),
        'customer'         => [
            'first_name' => $firstName,
            'last_name'  => $lastName,
            'email'      => $customer['email'] ?? $payer['email'] ?? ($data['payer_email'] ?? null),
            'phone'      => $phone,
            'document'   => $customer['document'] ?? $customer['cpf'] ?? ($payer['identification']['number'] ?? null),
            'city'       => $customer['city'] ?? $customer['cidade'] ?? null,
            'state'      => $customer['state'] ?? $customer['estado'] ?? null,
            'zip'        => $customer['zip'] ?? $customer['cep'] ?? null,
            'country'    => $customer['country'] ?? 'BR',
            'gender'     => $customer['gender'] ?? null,
            'birthdate'  => $customer['birthdate'] ?? null,
            // external_id anônimo do navegador (pt_xid) p/ casar PageView->IC->Purchase.
            // Aceita em customer.external_id OU em tracking.external_id/pt_xid.
            'external_id' => $customer['external_id']
                ?? $tracking['external_id']
                ?? $tracking['pt_xid']
                ?? null,
        ],
        'tracking'         => [
            'event_id'           => $eventId,
            'fbp'                => $tracking['fbp'] ?? null,
            'fbc'                => $tracking['fbc'] ?? null,
            'fbclid'             => $tracking['fbclid'] ?? null,
            'external_id'        => $tracking['external_id'] ?? $tracking['pt_xid'] ?? ($customer['external_id'] ?? null),
            'client_ip_address'  => $data['user_ip'] ?? ($tracking['client_ip_address'] ?? null),
            'client_user_agent'  => $data['user_agent'] ?? ($tracking['client_user_agent'] ?? null),
            'utm_source'         => $tracking['utm_source'] ?? null,
            'utm_medium'         => $tracking['utm_medium'] ?? null,
            'utm_campaign'       => $tracking['utm_campaign'] ?? null,
            'utm_content'        => $tracking['utm_content'] ?? null,
            'utm_term'           => $tracking['utm_term'] ?? null,
            'utm_id'             => $tracking['utm_id'] ?? null,
        ],
        'products'         => $products,
    ];

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $headers = [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $token,
    ];
    // Assinatura HMAC-SHA256 sobre o corpo cru — só quando há segredo configurado.
    if (defined('PAYTRACK_SECRET') && PAYTRACK_SECRET !== '') {
        $headers[] = 'X-Paytrack-Signature: sha256=' . hash_hmac('sha256', $body, PAYTRACK_SECRET);
    }

    // Desliga o "Expect: 100-continue" do cURL: ele adiciona ~1s de latencia
    // em payloads grandes e e a causa classica de venda "demorando a marcar".
    $headers[] = 'Expect:';

    $attempts = max(1, (int) PAYTRACK_RETRIES);
    $resp = false;
    $http = 0;
    $err  = '';

    for ($try = 1; $try <= $attempts; $try++) {
        $ch = curl_init(PAYTRACK_WEBHOOK_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => PAYTRACK_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => PAYTRACK_CONNECT_TIMEOUT,
            CURLOPT_TCP_NODELAY    => true,   // sem atraso de Nagle
            CURLOPT_FORBID_REUSE   => true,   // conexao limpa a cada envio
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
            CURLOPT_ENCODING       => '',
        ]);
        $resp = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        // Sucesso ou erro definitivo do cliente (4xx): nao adianta repetir.
        if ($resp !== false && ($http < 500)) {
            break;
        }
        if ($try < $attempts) {
            paytrack_log("RETRY {$try}/{$attempts} ({$payload['event']} / tx {$payload['transaction_id']}) http={$http} err={$err}");
            usleep(300000); // 300ms
        }
    }

    if ($resp === false) {
        paytrack_log("FALHA cURL ({$payload['event']} / tx {$payload['transaction_id']}): {$err}");
        return false;
    }


    $ok = $http >= 200 && $http < 300;
    $tokenTag = substr($token, 0, 12) . '…'; // não loga o token inteiro
    paytrack_log(
        ($ok ? 'OK' : 'ERRO HTTP ' . $http)
        . " {$payload['event']} tx={$payload['transaction_id']} prod=" . (string) ($data['product_id'] ?? '')
        . " token={$tokenTag} eid={$eventId} resp=" . substr((string) $resp, 0, 300)
    );
    return $ok;
}
`,S=t=>t.replace(/\\/g,"\\\\").replace(/'/g,"\\'");function Z(t){return ke.split("__PAYTRACK_URL__").join(S(t.webhookUrl)).split("__PAYTRACK_TOKEN__").join(S(t.token||"itk_cole_seu_token_aqui")).split("__PAYTRACK_SECRET__").join(S(t.secret||""))}function ee(t,i,r="application/x-php"){const o=URL.createObjectURL(new Blob([i],{type:`${r};charset=utf-8`})),s=document.createElement("a");s.href=o,s.download=t,document.body.appendChild(s),s.click(),s.remove(),setTimeout(()=>URL.revokeObjectURL(o),1e3)}const ae=t=>`${new URL(t).origin}/api/webhook.php`,te={checkout:"Use o paytrack_dispatch.php gerado aqui: ele envia o PIX gerado e o pagamento aprovado com o token (Bearer) e assina o corpo com HMAC-SHA256 quando há segredo.",kiwify:'Kiwify → Apps → Webhooks → Adicionar. Cole a URL e copie o "Token" do webhook para o campo segredo.',cakto:'Cakto → Integrações → Webhooks. Cole a URL e use o mesmo "secret" aqui.',kirvano:"Kirvano → Integrações → Webhooks. Cole a URL e use o mesmo token (enviado em security-token).",hotmart:"Hotmart → Ferramentas → Webhook (versão 2.0). Selecione compra aprovada, completa, reembolso, chargeback e cancelamento. Cole o Hottok no segredo.",lowify:"Lowify → Integrações → Webhooks. A URL já autentica. Confira a unidade do valor (reais ou centavos) com um pagamento de teste.",wiapay:"Wiapay → Configurações → Webhooks. A URL já autentica. Confira a unidade do valor com um pagamento de teste."},ve={checkout:{letter:"",cls:"bg-gradient-to-br from-[#7653ff] to-[#4f39e6]"},kiwify:{letter:"K",cls:"bg-gradient-to-br from-emerald-600 to-emerald-800"},hotmart:{letter:"H",cls:"bg-gradient-to-br from-orange-600 to-red-700"},cakto:{letter:"C",cls:"bg-gradient-to-br from-sky-600 to-blue-800"},kirvano:{letter:"Kv",cls:"bg-gradient-to-br from-violet-600 to-purple-800"},lowify:{letter:"L",cls:"bg-gradient-to-br from-teal-600 to-cyan-800"},wiapay:{letter:"W",cls:"bg-gradient-to-br from-pink-600 to-rose-800"}};function re({provider:t,className:i}){var o;const r=ve[t]??{letter:((o=t[0])==null?void 0:o.toUpperCase())??"?",cls:"bg-surface-3"};return e.jsx("span",{"aria-hidden":!0,className:U("flex shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm ring-1 ring-inset ring-white/10",r.cls,i??"h-11 w-11"),children:t==="checkout"?e.jsx(ge,{className:"h-5 w-5"}):r.letter})}function Se(){var $,T;const t=ne(),i=oe(),r=B(),[o,s]=he(),d=w({queryKey:["integrations"],queryFn:()=>I("/v1/integrations")}),n=w({queryKey:["pixels"],queryFn:()=>I("/v1/pixels")}),[g,m]=p.useState(null),[f,x]=p.useState(null),[y,k]=p.useState(null),b=()=>i.invalidateQueries({queryKey:["integrations"]}),v=ie({mutationFn:({id:a,body:h})=>me(`/v1/integrations/${a}`,h),onSuccess:()=>{r.ok("Integração atualizada"),b()},onError:a=>r.err(a)}),_=t.can("admin"),C=a=>{var h,j;return(j=(((h=n.data)==null?void 0:h.pixels)??[]).find(N=>N.id===a))==null?void 0:j.name},c=((($=d.data)==null?void 0:$.integrations)??[]).some(a=>a.provider==="checkout");return p.useEffect(()=>{const a=o.get("nova");if(a&&_){m(a==="1"?"hotmart":a);const h=new URLSearchParams(o);h.delete("nova"),s(h,{replace:!0})}},[o,_,s]),e.jsxs(e.Fragment,{children:[e.jsx(se,{title:"Integrações",eyebrow:"Configuração",description:"Gateways de pagamento e checkout próprio. Cada integração tem uma URL de webhook exclusiva e só confirma venda com pagamento aprovado.",actions:_&&e.jsx(u,{variant:"primary",icon:e.jsx(z,{className:"h-4 w-4"}),onClick:()=>m("hotmart"),children:"Nova integração"})}),f&&e.jsx(be,{r:f,onDone:()=>x(null)}),!c&&d.data&&!f&&_&&e.jsx(ye,{onStart:()=>m("checkout")}),d.isError?e.jsx(D,{children:e.jsx(de,{error:d.error,onRetry:()=>d.refetch()})}):d.data?d.data.integrations.length===0?e.jsx(D,{children:e.jsx(ce,{icon:e.jsx(W,{}),title:"Nenhuma integração",description:"Conecte Kiwify, Cakto, Kirvano, Hotmart, Lowify, Wiapay ou o seu checkout próprio para registrar as vendas reais.",action:_&&e.jsx(u,{variant:"primary",onClick:()=>m("hotmart"),children:"Adicionar integração"})})}):e.jsx("div",{className:"grid gap-5 xl:grid-cols-2",children:d.data.integrations.map(a=>{var N,L,q;const h=a.requiresSecret&&!a.secretConfigured,j=((N=a.stats)==null?void 0:N.rejected)??0;return e.jsxs("article",{className:"card card-interactive p-5",children:[e.jsxs("div",{className:"flex items-start justify-between gap-3",children:[e.jsxs("div",{className:"flex min-w-0 items-center gap-3",children:[e.jsx(re,{provider:a.provider}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("h2",{className:"truncate font-semibold",children:a.name}),e.jsxs("p",{className:"truncate text-xs text-muted",children:[a.providerLabel," · ",a.authMethod]})]})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(V,{tone:a.active?h?"warn":"ok":"neutral",dot:!0,children:a.active?h?"Falta segredo":"Ativa":"Pausada"}),_&&e.jsx(le,{checked:a.active,label:`Ativar ${a.name}`,onChange:l=>v.mutate({id:a.id,body:{active:l}})})]})]}),e.jsxs("div",{className:"mt-5 grid grid-cols-3 gap-2",children:[e.jsx(O,{label:"Processados (7 dias)",value:Y(((L=a.stats)==null?void 0:L.processed)??0)}),e.jsx(O,{label:"Rejeitados",value:Y(j),tone:j>0?"err":void 0}),e.jsx(O,{label:"Último webhook",value:pe(a.lastReceivedAt),small:!0})]}),e.jsxs("dl",{className:"mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]",children:[e.jsx("dt",{className:"text-muted",children:"Token"}),e.jsx("dd",{className:"font-mono",children:a.tokenHint}),e.jsx("dt",{className:"text-muted",children:"Segredo"}),e.jsx("dd",{children:a.secretConfigured?e.jsxs("span",{className:"inline-flex items-center gap-1 text-ok",children:[e.jsx($e,{className:"h-3.5 w-3.5","aria-hidden":!0}),"configurado"]}):a.requiresSecret?e.jsx("span",{className:"text-err",children:"obrigatório"}):"opcional"}),e.jsx("dt",{className:"text-muted",children:"Pixel padrão"}),e.jsx("dd",{className:"truncate",children:C(a.defaultPixelId)??"por produto"}),a.configurableAmountUnit&&e.jsxs(e.Fragment,{children:[e.jsx("dt",{className:"text-muted",children:"Unidade do valor"}),e.jsx("dd",{children:a.amountUnit==="minor"?"centavos":"reais"})]})]}),e.jsx("p",{className:"mt-3 text-xs leading-relaxed text-muted",children:te[a.provider]}),_&&e.jsxs("div",{className:"mt-4 flex flex-wrap gap-2 border-t border-border pt-4",children:[a.provider==="checkout"&&e.jsx(u,{size:"sm",icon:e.jsx(K,{className:"h-4 w-4"}),title:"O token só aparece na criação: o arquivo vem com PAYTRACK_TOKEN para você colar. Para um arquivo completo, use “Novo token”.",onClick:()=>ee("paytrack_dispatch.php",Z({webhookUrl:ae(location.origin),token:null})),children:"Baixar PHP (sem token)"}),e.jsx(u,{size:"sm",icon:e.jsx(fe,{className:"h-4 w-4"}),onClick:()=>k(a),children:a.secretConfigured?"Trocar segredo":"Definir segredo"}),e.jsxs(A,{"aria-label":"Pixel padrão",className:"h-8 w-[180px] rounded-lg text-[13px]",value:a.defaultPixelId??"",onChange:l=>v.mutate({id:a.id,body:{defaultPixelId:l.target.value||null}}),children:[e.jsx("option",{value:"",children:"Pixel: por produto"}),(((q=n.data)==null?void 0:q.pixels)??[]).map(l=>e.jsx("option",{value:l.id,children:l.name},l.id))]}),a.configurableAmountUnit&&e.jsxs(A,{"aria-label":"Unidade do valor",className:"h-8 w-[150px] rounded-lg text-[13px]",value:a.amountUnit,onChange:l=>v.mutate({id:a.id,body:{amountUnit:l.target.value}}),children:[e.jsx("option",{value:"major",children:"Valor em reais"}),e.jsx("option",{value:"minor",children:"Valor em centavos"})]}),e.jsx(H,{size:"sm",title:"Gerar nova URL e token?",description:"A URL e o token atuais deixam de funcionar imediatamente. Atualize no gateway (ou baixe o PHP de novo).",confirmLabel:"Gerar",onConfirm:async()=>{const l=await X(`/v1/integrations/${a.id}/rotate-token`);x({url:l.webhookUrl,token:l.token,provider:a.provider})},children:"Novo token"}),e.jsx(H,{size:"sm",variant:"ghost",danger:!0,title:`Excluir ${a.name}?`,description:"Webhooks enviados para esta URL passam a ser recusados.",confirmLabel:"Excluir",onConfirm:async()=>{await ue(`/v1/integrations/${a.id}`),await b()},children:"Excluir"})]})]},a.id)})}):e.jsxs("div",{className:"grid gap-4 xl:grid-cols-2",children:[e.jsx(M,{className:"h-64"}),e.jsx(M,{className:"h-64"})]}),g&&e.jsx(Ce,{initial:g,pixels:((T=n.data)==null?void 0:T.pixels)??[],onClose:()=>m(null),onCreated:a=>{m(null),x(a),b()}}),y&&e.jsx(Te,{integ:y,onClose:()=>k(null),onSave:async a=>{await v.mutateAsync({id:y.id,body:{secret:a}}),k(null)}})]})}function O({label:t,value:i,tone:r,small:o}){return e.jsxs("div",{className:"rounded-xl border border-border bg-surface-2/50 px-3 py-2.5",children:[e.jsx("p",{className:"truncate text-[11px] text-muted",children:t}),e.jsx("p",{className:U("num mt-0.5 truncate font-semibold",o?"text-[13px]":"text-lg",r==="err"&&"text-err"),children:i})]})}function ye({onStart:t}){return e.jsxs("section",{className:"card relative mb-6 overflow-hidden p-6 lg:p-8",children:[e.jsx("div",{className:"pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/20 blur-3xl","aria-hidden":!0}),e.jsx("div",{className:"pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-accent/10 blur-3xl","aria-hidden":!0}),e.jsxs("div",{className:"relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center",children:[e.jsxs("div",{children:[e.jsx(V,{tone:"primary",children:"Checkout próprio"}),e.jsx("h2",{className:"mt-3 text-2xl font-semibold",children:"Conecte o seu checkout em 3 passos"}),e.jsxs("p",{className:"mt-2 text-sm text-muted",children:["Geramos o ",e.jsx("code",{className:"rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]",children:"paytrack_dispatch.php"})," já configurado. Ele envia o PIX gerado e o pagamento aprovado, com order bumps, UTMs e o mesmo event_id do Pixel — e cada envio é assinado."]}),e.jsx(u,{variant:"primary",size:"lg",className:"mt-6",icon:e.jsx(z,{className:"h-4 w-4"}),onClick:t,children:"Criar integração do checkout"})]}),e.jsx("ol",{className:"space-y-3",children:[{icon:e.jsx(W,{}),t:"Crie a integração",d:"Defina um segredo para bloquear envios forjados."},{icon:e.jsx(K,{}),t:"Baixe o paytrack_dispatch.php",d:"URL, token e segredo já vêm preenchidos."},{icon:e.jsx(Q,{}),t:"Chame no webhook do gateway",d:"Uma linha quando o PIX for pago."}].map((i,r)=>e.jsxs("li",{className:"flex items-start gap-3 rounded-2xl border border-border bg-surface/70 p-4",children:[e.jsx("span",{className:"icon-tile-primary h-9 w-9 text-sm font-semibold","aria-hidden":!0,children:r+1}),e.jsxs("div",{children:[e.jsx("p",{className:"text-sm font-semibold",children:i.t}),e.jsx("p",{className:"text-xs text-muted",children:i.d})]})]},i.t))})]})]})}function be({r:t,onDone:i}){const r=t.provider==="checkout",o=ae(t.url),[s,d]=p.useState(!1);return e.jsxs("section",{className:"card relative mb-6 overflow-hidden border-ok/30 p-6 animate-slide-up",children:[e.jsx("div",{className:"pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ok/10 blur-3xl","aria-hidden":!0}),e.jsxs("div",{className:"relative flex flex-wrap items-start justify-between gap-3",children:[e.jsxs("div",{className:"flex items-start gap-3",children:[e.jsx("span",{className:"flex h-10 w-10 items-center justify-center rounded-xl bg-ok/15 text-ok","aria-hidden":!0,children:e.jsx(F,{className:"h-5 w-5"})}),e.jsxs("div",{children:[e.jsx("h2",{className:"text-lg font-semibold",children:r?"Checkout próprio conectado":"Integração criada"}),e.jsx("p",{className:"text-sm text-muted",children:"Copie agora: o token não será exibido novamente."})]})]}),e.jsx(u,{size:"sm",onClick:i,children:"Concluído"})]}),r?e.jsxs("div",{className:"relative mt-6 grid gap-6 lg:grid-cols-2",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"rounded-2xl border border-primary/25 bg-primary/[0.06] p-5",children:[e.jsxs("p",{className:"flex items-center gap-2 text-sm font-semibold",children:[e.jsx(Q,{className:"h-4 w-4 text-primary","aria-hidden":!0}),"1. Baixe o arquivo já configurado"]}),e.jsxs("p",{className:"mt-1 text-xs text-muted",children:["Gerado no seu navegador com a URL, o token",t.secret?" e o segredo":""," desta integração. Guarde como um segredo."]}),e.jsx(u,{variant:"primary",className:"mt-4 w-full",icon:s?e.jsx(F,{className:"h-4 w-4"}):e.jsx(K,{className:"h-4 w-4"}),onClick:()=>{ee("paytrack_dispatch.php",Z({webhookUrl:o,token:t.token,secret:t.secret})),d(!0)},children:s?"Baixado — baixar de novo":"Baixar paytrack_dispatch.php"}),!t.secret&&e.jsx("p",{className:"mt-3 text-xs text-warn",children:"Sem segredo: qualquer pessoa com o token consegue enviar vendas. Defina um segredo no cartão da integração e baixe o arquivo de novo."})]}),e.jsx(R,{label:"URL (Authorization: Bearer)",code:o}),e.jsx(R,{label:"Token",code:t.token})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("p",{className:"text-sm font-semibold",children:"2. Suba na pasta dos webhooks e inclua no topo"}),e.jsx(R,{label:"webhook do gateway (EFI, Woovi…)",code:`if (file_exists(__DIR__ . '/paytrack_dispatch.php')) {
    require_once __DIR__ . '/paytrack_dispatch.php';
}`}),e.jsx("p",{className:"text-sm font-semibold",children:"3. Quando o PIX for pago, chame"}),e.jsx(R,{label:"pagamento aprovado",code:`// $transacao = linha da tabela transacoes (com tracking_parameters)
paytrack_dispatch_checkout_purchase($pdo, $transacao, 'efi');`}),e.jsxs("p",{className:"text-xs text-muted",children:["Para o PIX gerado use ",e.jsx("code",{className:"font-mono",children:"paytrack_dispatch_sale($pdo, ['event' => 'sale.pending', …])"}),": a venda entra como pendente e não vira Purchase até o pagamento."]})]})]}):e.jsx("div",{className:"relative mt-5 space-y-3",children:e.jsx(R,{label:"URL do webhook (cole no painel do gateway)",code:t.url})})]})}function Ce({initial:t,pixels:i,onClose:r,onCreated:o}){var T;const s=B(),d=w({queryKey:["providers"],queryFn:()=>I("/v1/integrations/providers")}),[n,g]=p.useState(t),[m,f]=p.useState(""),[x,y]=p.useState(""),[k,b]=p.useState("major"),[v,_]=p.useState(!1),C=((T=d.data)==null?void 0:T.providers)??[],c=C.find(a=>a.provider===n),$=n==="checkout";return e.jsx(G,{open:!0,size:"lg",onClose:r,title:"Nova integração",description:"Escolha de onde vêm as vendas.",footer:e.jsxs(e.Fragment,{children:[e.jsx(u,{variant:"ghost",onClick:r,children:"Cancelar"}),e.jsx(u,{variant:"primary",loading:v,disabled:!!(c!=null&&c.requiresSecret)&&m.length<4,onClick:async()=>{_(!0);try{const a=await X("/v1/integrations",{provider:n,secret:m||void 0,defaultPixelId:x||void 0,amountUnit:k});o({url:a.webhookUrl,token:a.token,provider:n,secret:m||void 0})}catch(a){s.err(a)}finally{_(!1)}},children:"Criar integração"})]}),children:e.jsxs("div",{className:"space-y-5",children:[e.jsxs("fieldset",{children:[e.jsx("legend",{className:"label",children:"Origem das vendas"}),e.jsx("div",{role:"radiogroup","aria-label":"Origem das vendas",className:"grid grid-cols-2 gap-2 sm:grid-cols-4",children:(C.length?C:[{provider:"checkout",label:"Checkout próprio"}]).map(a=>e.jsxs("button",{type:"button",role:"radio","aria-checked":n===a.provider,onClick:()=>g(a.provider),className:U("flex flex-col items-center gap-2 rounded-2xl border p-3 text-center text-[13px] font-medium transition",n===a.provider?"border-primary bg-primary/[0.07] ring-2 ring-primary/25":"border-border hover:border-border-strong hover:bg-surface-2/60"),children:[e.jsx(re,{provider:a.provider,className:"h-9 w-9"}),a.label]},a.provider))})]}),e.jsxs("p",{className:"rounded-xl bg-surface-2/60 p-3 text-xs leading-relaxed text-muted",children:[e.jsx(xe,{className:"mr-1 inline h-3.5 w-3.5","aria-hidden":!0}),te[n]]}),e.jsx(P,{label:c!=null&&c.requiresSecret?"Segredo do webhook (obrigatório)":$?"Segredo de assinatura (recomendado)":"Segredo (opcional)",htmlFor:"sec",hint:$?"Vai junto no paytrack_dispatch.php. Com ele, o PayTracking só aceita envios assinados com HMAC-SHA256.":c==null?void 0:c.authMethod,children:e.jsxs("div",{className:"flex gap-2",children:[e.jsx(J,{id:"sec",type:"password",autoComplete:"off",value:m,onChange:a=>f(a.target.value)}),$&&e.jsx(u,{onClick:()=>f(`whsec_${Array.from(crypto.getRandomValues(new Uint8Array(24)),a=>a.toString(16).padStart(2,"0")).join("")}`),children:"Gerar"})]})}),e.jsxs("div",{className:"grid gap-4 sm:grid-cols-2",children:[e.jsx(P,{label:"Pixel padrão",htmlFor:"px",hint:"Usado quando o produto da venda não estiver em nenhum pixel.",children:e.jsxs(A,{id:"px",value:x,onChange:a=>y(a.target.value),children:[e.jsx("option",{value:"",children:"Somente por produto"}),i.map(a=>e.jsx("option",{value:a.id,children:a.name},a.id))]})}),(c==null?void 0:c.configurableAmountUnit)&&e.jsx(P,{label:"Unidade do valor enviado",htmlFor:"unit",hint:"O sistema não adivinha: confirme com um pagamento de teste.",children:e.jsxs(A,{id:"unit",value:k,onChange:a=>b(a.target.value),children:[e.jsx("option",{value:"major",children:"Reais (197.00)"}),e.jsx("option",{value:"minor",children:"Centavos (19700)"})]})})]}),$&&e.jsx(_e,{tone:"info",title:"Order bumps, UTMs e event_id já incluídos",children:"O arquivo lê os bumps da tabela transacoes_adicionais e reaproveita o purchase_event_id salvo pelo seu checkout, para a Meta deduplicar com o Pixel."})]})})}function Te({integ:t,onClose:i,onSave:r}){const[o,s]=p.useState(""),[d,n]=p.useState(!1);return e.jsx(G,{open:!0,onClose:i,title:`Segredo — ${t.name}`,description:t.authMethod,footer:e.jsxs(e.Fragment,{children:[!t.requiresSecret&&t.secretConfigured&&e.jsx(u,{variant:"ghost",onClick:async()=>{n(!0),await r(null).finally(()=>n(!1))},children:"Remover segredo"}),e.jsx(u,{variant:"primary",loading:d,disabled:o.length<4,onClick:async()=>{n(!0),await r(o).finally(()=>n(!1))},children:"Salvar"})]}),children:e.jsx(P,{label:"Novo segredo",htmlFor:"ns",hint:t.provider==="checkout"?"Use o mesmo valor em PAYTRACK_SECRET no paytrack_dispatch.php. Armazenado criptografado.":"Armazenado criptografado. Nunca é exibido novamente.",children:e.jsx(J,{id:"ns",type:"password",autoComplete:"off",value:o,onChange:g=>s(g.target.value)})})})}export{Se as default};
