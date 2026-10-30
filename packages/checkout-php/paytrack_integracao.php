<?php
/**
 * PayTracking — integração para painéis de checkout com a tabela `paytrack_config`
 * (ex.: Sales Studio Pro: app.php / app-api.php)
 * ============================================================================
 * Usa o paytracking.php (mesma pasta) para o envio. Cada linha de `paytrack_config`
 * (webhook_url, api_token, secret, produto_id, eventos, ativo) é uma integração.
 *
 * NO WEBHOOK DO SEU GATEWAY (EFI, Woovi…), depois de atualizar a transação:
 *
 *   require_once __DIR__ . '/paytrack_integracao.php';
 *   paytrack_integracao_enviar_todas($pdo, [
 *       'status'         => 'approved',            // ou 'pix_gerado', 'reembolso', 'expirado'…
 *       'transaction_id' => $transacao['id'],
 *       'value'          => $transacao['valor'],   // em reais (197.00 ou "197,00")
 *       'product_id'     => $transacao['produto_id'],
 *       'product_name'   => $transacao['descricao'],
 *       'customer'       => ['name' => …, 'email' => …, 'phone' => …, 'city' => …, 'state' => …, 'zip' => …],
 *       'tracking'       => json_decode($transacao['tracking_parameters'], true) ?: [],
 *       'ip'             => $transacao['device_ip'],   // IP do COMPRADOR (salvo no checkout)
 *       'user_agent'     => $transacao['user_agent'],  // navegador do COMPRADOR
 *   ]);
 *
 * REGRAS (o código antigo enviava dados inventados — aqui não):
 *   - Status desconhecido NÃO vira compra: é registrado no log e nada é enviado.
 *   - IP e navegador só do comprador. Nunca o IP do servidor do gateway, nunca
 *     "127.0.0.1"/"Mozilla/5.0" de enfeite, nunca cookies de quem está no painel.
 *   - Sem UTM "direct"/"none" e sem produto "PROD-01" quando a informação não existe.
 *   - O event_id do Purchase segue o mesmo padrão do código antigo (purchase_<id>):
 *     se os dois enviarem, a Meta conta uma venda só.
 * ============================================================================
 */

declare(strict_types=1);

require_once __DIR__ . '/paytracking.php';

use PayTracking\Checkout;

if (!function_exists('paytrack_integracao_status')) {

    /**
     * Status do checkout → evento do PayTracking. null = não enviar.
     *
     * @return array{tipo: string, event: string, status: string}|null
     */
    function paytrack_integracao_status(string $raw): ?array
    {
        $k = trim(preg_replace('/[\s.\-]+/', '_', strtolower($raw)) ?? '', '_');
        $map = [
            'aprovado' => ['approved', 'aprovado', 'aprovada', 'paid', 'pago', 'paga', 'sale_approved', 'purchase', 'venda_aprovada',
                'completed', 'compra_aprovada', 'pix_pago', 'pagamento_aprovado', 'order_paid'],
            'pendente' => ['pending', 'pendente', 'pix_gerado', 'gerado', 'waiting_payment', 'aguardando_pagamento', 'initiate_checkout',
                'boleto_gerado', 'sale_pending', 'pix_created'],
            'reembolso' => ['refunded', 'refund', 'reembolso', 'reembolsado', 'reembolsada', 'estorno', 'estornado', 'estornada', 'sale_refunded'],
            'chargeback' => ['chargeback', 'contestacao', 'contestado', 'sale_chargeback'],
            'cancelado' => ['canceled', 'cancelled', 'cancelado', 'cancelada', 'expired', 'expirado', 'expirada', 'pix_expirado', 'sale_canceled'],
            'recusado' => ['failed', 'refused', 'recusado', 'recusada', 'compra_recusada', 'pagamento_recusado', 'sale_failed'],
            'lead' => ['lead', 'lead_gerado'],
        ];
        $out = [
            'aprovado' => ['event' => 'sale.approved', 'status' => 'paid'],
            'pendente' => ['event' => 'sale.pending', 'status' => 'pending'],
            'reembolso' => ['event' => 'sale.refunded', 'status' => 'refunded'],
            'chargeback' => ['event' => 'sale.chargeback', 'status' => 'chargeback'],
            'cancelado' => ['event' => 'sale.canceled', 'status' => 'canceled'],
            'recusado' => ['event' => 'sale.failed', 'status' => 'failed'],
            'lead' => ['event' => 'lead', 'status' => ''],
        ];
        foreach ($map as $tipo => $aliases) {
            if (in_array($k, $aliases, true)) {
                return ['tipo' => $tipo] + $out[$tipo];
            }
        }
        return null;
    }

    /** O filtro "Eventos a enviar" da integração deixa passar este tipo? */
    function paytrack_integracao_filtro_eventos(string $eventos, string $tipo): bool
    {
        switch ($eventos) {
            case 'venda_aprovada': return $tipo === 'aprovado';
            case 'pix_gerado': return $tipo === 'pendente';
            case 'reembolso': return in_array($tipo, ['reembolso', 'chargeback'], true);
            default: return true; // 'todos'
        }
    }

    /** @return mixed primeiro valor não vazio */
    function paytrack_integracao_first(array $src, array $keys, $default = null)
    {
        foreach ($keys as $k) {
            if (array_key_exists($k, $src) && $src[$k] !== null && $src[$k] !== '') {
                return $src[$k];
            }
        }
        return $default;
    }

    function paytrack_integracao_money($v): ?float
    {
        if ($v === null || $v === '') return null;
        if (is_string($v)) {
            $v = trim($v);
            if (preg_match('/^\d{1,3}(\.\d{3})+,\d+$/', $v)) $v = str_replace(['.', ','], ['', '.'], $v);
            elseif (strpos($v, ',') !== false && strpos($v, '.') === false) $v = str_replace(',', '.', $v);
        }
        return is_numeric($v) ? round((float) $v, 2) : null;
    }

    /**
     * Monta o corpo no formato do webhook de checkout próprio do PayTracking.
     * Retorna null quando o status não é reconhecido (nada deve ser enviado).
     */
    function paytrack_integracao_payload(array $data): ?array
    {
        $st = paytrack_integracao_status((string) paytrack_integracao_first($data, ['status', 'event', 'evento'], ''));
        if ($st === null) return null;

        $customer = is_array($data['customer'] ?? null) ? $data['customer'] : [];
        $tracking = $data['tracking'] ?? ($data['tracking_parameters'] ?? []);
        if (is_string($tracking)) $tracking = json_decode($tracking, true) ?: [];
        $tracking = is_array($tracking) ? $tracking : [];

        $tx = trim((string) paytrack_integracao_first($data, ['transaction_id', 'order_id', 'pedido_id', 'id'], ''));
        $value = paytrack_integracao_money(paytrack_integracao_first($data, ['value', 'amount', 'valor', 'total']));
        $productId = (string) paytrack_integracao_first($data, ['product_id', 'produto_id'], '');
        $productName = (string) paytrack_integracao_first($data, ['product_name', 'produto_nome', 'descricao'], '');

        $products = [];
        foreach ((is_array($data['products'] ?? null) ? $data['products'] : []) as $p) {
            if (!is_array($p)) continue;
            $id = (string) paytrack_integracao_first($p, ['id', 'produto_id', 'product_id'], '');
            $name = (string) paytrack_integracao_first($p, ['name', 'nome'], '');
            if ($id === '' && $name === '') continue;
            $products[] = ['id' => $id, 'name' => $name, 'quantity' => (int) paytrack_integracao_first($p, ['quantity', 'quantidade'], 1),
                'price' => paytrack_integracao_money(paytrack_integracao_first($p, ['price', 'preco', 'item_price']))];
        }
        if (!$products && ($productId !== '' || $productName !== '')) {
            $products[] = ['id' => $productId, 'name' => $productName, 'quantity' => 1, 'price' => $value];
        }
        if ($productId === '' && isset($products[0])) $productId = (string) $products[0]['id'];

        // event_id: o salvo pelo checkout (o mesmo do Pixel); senão o padrão do código antigo
        if ($st['tipo'] === 'aprovado') {
            $eventId = (string) paytrack_integracao_first($tracking, ['purchase_event_id', 'purchaseEventId', 'meta_purchase_event_id', 'event_id'], 'purchase_' . $tx);
        } elseif ($st['tipo'] === 'pendente') {
            $eventId = (string) paytrack_integracao_first($tracking, ['initiate_checkout_event_id', 'initiateCheckoutEventId', 'event_id'], 'ic_' . $tx);
        } elseif ($st['tipo'] === 'lead') {
            $eventId = (string) paytrack_integracao_first($tracking, ['lead_event_id', 'event_id'], 'lead_' . $tx);
        } else {
            $eventId = '';
        }

        $fbc = paytrack_integracao_first($tracking, ['fbc', '_fbc']);
        $fbclid = paytrack_integracao_first($tracking, ['fbclid']);
        if (!$fbc && $fbclid) {
            $created = isset($data['created_at']) ? strtotime((string) $data['created_at']) : false;
            $fbc = 'fb.1.' . (($created ?: time()) * 1000) . '.' . $fbclid;
        }
        $externalId = paytrack_integracao_first($tracking, ['external_id', 'pt_xid', 'xid']);
        $utm = function (string $k) use ($data, $tracking) {
            $v = paytrack_integracao_first($data, [$k]) ?? paytrack_integracao_first($tracking, [$k]);
            // valores de enfeite do código antigo não são campanhas reais
            return in_array($v, ['direct', 'none', ''], true) ? null : $v;
        };

        $name = (string) paytrack_integracao_first($data, ['name', 'nome'], (string) paytrack_integracao_first($customer, ['name', 'nome'], ''));
        $first = paytrack_integracao_first($customer, ['first_name']);
        $last = paytrack_integracao_first($customer, ['last_name']);
        if ((!$first || !$last) && trim($name) !== '') {
            $parts = preg_split('/\s+/', trim($name)) ?: [];
            $first = $first ?: ($parts[0] ?? null);
            $last = $last ?: (count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null);
        }

        return [
            'event' => $st['event'],
            'status' => $st['status'],
            'payment_status' => $st['status'],
            'payment_method' => (string) paytrack_integracao_first($data, ['payment_method', 'metodo_pagamento'], 'pix'),
            'transaction_id' => $tx,
            'value' => $value,
            'currency' => strtoupper((string) paytrack_integracao_first($data, ['currency', 'moeda'], 'BRL')),
            'event_source_url' => paytrack_integracao_first($data, ['event_source_url']) ?? paytrack_integracao_first($tracking, ['event_source_url', 'page_url']),
            'product_id' => $productId,
            'product_name' => $productName !== '' ? $productName : ($products[0]['name'] ?? ''),
            'products' => $products,
            'customer' => [
                'name' => trim($name) !== '' ? trim($name) : null,
                'first_name' => $first,
                'last_name' => $last,
                'email' => paytrack_integracao_first($data, ['email']) ?? paytrack_integracao_first($customer, ['email']),
                'phone' => paytrack_integracao_first($data, ['phone', 'telefone']) ?? paytrack_integracao_first($customer, ['phone', 'telefone']),
                'document' => paytrack_integracao_first($data, ['document', 'cpf']) ?? paytrack_integracao_first($customer, ['document', 'cpf']),
                'city' => paytrack_integracao_first($customer, ['city', 'cidade']) ?? paytrack_integracao_first($data, ['city', 'cidade']),
                'state' => paytrack_integracao_first($customer, ['state', 'estado']) ?? paytrack_integracao_first($data, ['state', 'estado']),
                'zip' => paytrack_integracao_first($customer, ['zip', 'cep']) ?? paytrack_integracao_first($data, ['zip', 'cep']),
                'country' => paytrack_integracao_first($customer, ['country'], 'BR'),
                'external_id' => $externalId,
            ],
            'tracking' => [
                'event_id' => $eventId !== '' ? $eventId : null,
                'purchase_event_id' => $st['tipo'] === 'aprovado' ? $eventId : null,
                'external_id' => $externalId,
                'fbp' => paytrack_integracao_first($tracking, ['fbp', '_fbp']),
                'fbc' => $fbc ?: null,
                'fbclid' => $fbclid,
                // só o IP/navegador do COMPRADOR — nunca $_SERVER (no webhook seria o servidor do gateway)
                'client_ip_address' => paytrack_integracao_first($tracking, ['client_ip_address']) ?? paytrack_integracao_first($data, ['ip', 'device_ip', 'user_ip']),
                'client_user_agent' => paytrack_integracao_first($tracking, ['client_user_agent']) ?? paytrack_integracao_first($data, ['user_agent']),
                'utm_source' => $utm('utm_source'),
                'utm_medium' => $utm('utm_medium'),
                'utm_campaign' => $utm('utm_campaign'),
                'utm_content' => $utm('utm_content'),
                'utm_term' => $utm('utm_term'),
                'utm_id' => $utm('utm_id'),
            ],
        ];
    }

    /** Aponta o paytracking.php para esta integração (URL, token e segredo da linha). */
    function paytrack_integracao_configurar(array $cfg): void
    {
        Checkout::configurar(array_filter([
            'url' => trim((string) ($cfg['webhook_url'] ?? '')),
            'token' => trim((string) ($cfg['api_token'] ?? '')),
            'secret' => trim((string) ($cfg['secret'] ?? '')),
            'log_dir' => $cfg['log_dir'] ?? null,
        ], function ($v) { return $v !== null; }));
    }

    /**
     * Envia um evento para UMA integração (linha de paytrack_config), respeitando os filtros.
     *
     * @return array{success: bool, skipped: bool, http_code: int, response: mixed, error: ?string, payload: ?array}
     */
    function paytrack_integracao_enviar(array $cfg, array $data): array
    {
        $result = ['success' => false, 'skipped' => false, 'http_code' => 0, 'response' => null, 'error' => null, 'payload' => null];
        try {
            if (trim((string) ($cfg['webhook_url'] ?? '')) === '' || trim((string) ($cfg['api_token'] ?? '')) === '') {
                return ['error' => 'URL e Token são necessários'] + $result;
            }
            if (isset($cfg['ativo']) && (int) $cfg['ativo'] === 0) {
                return ['success' => true, 'skipped' => true, 'error' => 'Integração inativa'] + $result;
            }
            $payload = paytrack_integracao_payload($data);
            if ($payload === null) {
                return ['success' => true, 'skipped' => true, 'error' => 'Status não reconhecido — nada enviado (não vira compra)'] + $result;
            }
            $st = paytrack_integracao_status((string) paytrack_integracao_first($data, ['status', 'event', 'evento'], ''));
            if (!paytrack_integracao_filtro_eventos((string) ($cfg['eventos'] ?? 'todos'), $st['tipo'] ?? '')) {
                return ['success' => true, 'skipped' => true, 'error' => 'Evento fora do filtro desta integração', 'payload' => $payload] + $result;
            }
            $onlyProduct = trim((string) ($cfg['produto_id'] ?? ''));
            if ($onlyProduct !== '') {
                $ids = array_map('strval', array_column($payload['products'], 'id'));
                $ids[] = (string) $payload['product_id'];
                if (!in_array($onlyProduct, $ids, true)) {
                    return ['success' => true, 'skipped' => true, 'error' => 'Produto diferente do configurado nesta integração', 'payload' => $payload] + $result;
                }
            }
            paytrack_integracao_configurar($cfg);
            $ok = Checkout::enviar($payload);
            $last = Checkout::ultimoResultado();
            return [
                'success' => $ok,
                'skipped' => false,
                'http_code' => (int) ($last['http'] ?? 0),
                'response' => $last['resposta'] ?? null,
                'error' => $ok ? null : (($last['resposta']['error'] ?? null) ?: ($last['erro'] ?? 'Falha no envio')) . (isset($last['resposta']['reason']) ? ' (' . $last['resposta']['reason'] . ')' : ''),
                'payload' => $payload,
            ];
        } catch (\Throwable $e) {
            return ['error' => 'Erro interno: ' . $e->getMessage()] + $result;
        }
    }

    /**
     * Envia para TODAS as integrações ativas de paytrack_config (cada uma com seus filtros).
     *
     * @return array<int, array> resultado por integração (id => resultado)
     */
    function paytrack_integracao_enviar_todas($pdo, array $data): array
    {
        $out = [];
        try {
            $rows = $pdo->query('SELECT * FROM paytrack_config WHERE ativo = 1')->fetchAll(\PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {
            error_log('paytrack_integracao_enviar_todas: ' . $e->getMessage());
            return $out;
        }
        foreach ($rows as $cfg) {
            $out[(int) $cfg['id']] = paytrack_integracao_enviar($cfg, $data);
        }
        return $out;
    }

    /**
     * Teste de conexão: confere URL, token e segredo SEM registrar venda nem enviar à Meta.
     *
     * @return array{success: bool, http_code: int, message: string}
     */
    function paytrack_integracao_testar(array $cfg): array
    {
        if (trim((string) ($cfg['webhook_url'] ?? '')) === '' || trim((string) ($cfg['api_token'] ?? '')) === '') {
            return ['success' => false, 'http_code' => 0, 'message' => 'URL e Token são necessários'];
        }
        paytrack_integracao_configurar($cfg);
        $r = Checkout::testarConexao();
        return ['success' => $r['ok'], 'http_code' => $r['http'], 'message' => $r['mensagem']];
    }
}
