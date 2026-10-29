<?php
// Harness de verificação: extrai funções puras do código original e as executa.
declare(strict_types=1);
$src = $argv[1];
function extract_fn(string $file, string $name): string {
    $code = file_get_contents($file);
    $t = token_get_all($code); $n = count($t);
    for ($i = 0; $i < $n; $i++) {
        if (is_array($t[$i]) && $t[$i][0] === T_FUNCTION) {
            $j = $i + 1; while (is_array($t[$j]) && $t[$j][0] === T_WHITESPACE) $j++;
            if (is_array($t[$j]) && $t[$j][1] === $name) {
                $out = ''; $depth = 0; $started = false;
                for ($k = $i; $k < $n; $k++) {
                    $s = is_array($t[$k]) ? $t[$k][1] : $t[$k];
                    $out .= $s;
                    if ($s === '{' || (is_array($t[$k]) && in_array($t[$k][0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) { $depth++; $started = true; }
                    if ($s === '}') { $depth--; if ($started && $depth === 0) return $out; }
                }
            }
        }
    }
    throw new RuntimeException("fn $name not found");
}
define('META_GRAPH_VERSION', 'v21.0'); define('META_TEST_EVENT_CODE', '');
require "$src/app/helpers.php";
require "$src/app/MetaCapi.php";
require "$src/app/gateway_adapters.php";
eval(extract_fn("$src/public/api/webhook.php", 'paytrack_purchase_is_paid'));
eval(extract_fn("$src/public/api/webhook.php", 'pt_parse_money'));

$cases = [
 'kiwify'  => ['order_status'=>'paid','order_id'=>'K1','Commissions'=>['charge_amount'=>19700,'currency'=>'BRL'],'Customer'=>['email'=>'a@b.com'],'Product'=>['product_id'=>'P1']],
 'cakto'   => ['event'=>'purchase_approved','data'=>['id'=>'C1','amount'=>197.00,'customer'=>['email'=>'a@b.com']]],
 'kirvano' => ['event'=>'SALE_APPROVED','sale_id'=>'KV1','total_price'=>'R$ 197,00','customer'=>['email'=>'a@b.com']],
 'lowify'  => ['event'=>'sale.paid','data'=>['id'=>'L1','amount'=>19700]],
 'wiapay'  => ['status'=>'approved','id'=>'W1','amount'=>97.0],
 'hotmart' => ['id'=>'evt1','event'=>'PURCHASE_APPROVED','data'=>['buyer'=>['email'=>'a@b.com'],'product'=>['id'=>'9'],'purchase'=>['transaction'=>'HP1','status'=>'APPROVED','approved_date'=>(int)(microtime(true)*1000),'price'=>['value'=>197,'currency_value'=>'BRL']]]],
];
echo "== 1) Compra aprovada de cada gateway: chega como Purchase no webhook interno?\n";
foreach ($cases as $gw => $p) {
    $norm = gateway_normalize_payload($gw, $p);
    $evt = (string)($norm['event'] ?? '');
    $mapped = MetaCapi::mapEventName($evt);
    $paid = $mapped === 'Purchase' ? paytrack_purchase_is_paid($norm, $evt) : null;
    printf("  %-8s normalized.event=%-10s value=%-8s mapped=%-9s is_paid=%s\n", $gw, $evt, var_export($norm['value'],true), var_export($mapped,true), var_export($paid,true));
}
echo "\n== 2) Heurística de centavos do adapter (\$money via normalize lowify, campo amount)\n";
foreach ([997, 1000, 1500, 19700, '1000', '49.90', 4990] as $v) {
    $n = gateway_normalize_payload('lowify', ['event'=>'paid','id'=>'x','amount'=>$v]);
    printf("  amount=%-7s -> value=%s\n", var_export($v,true), var_export($n['value'],true));
}
echo "\n== 3) pt_parse_money (webhook checkout próprio)\n";
foreach (['1.234,56','1,234.56','14,90','1,234','19700', 19700, '0,5'] as $v) printf("  %-10s -> %s\n", var_export($v,true), var_export(pt_parse_money($v),true));
echo "\n== 4) Status de pagamento ambíguos em paytrack_purchase_is_paid\n";
foreach ([['status'=>'disapproved'],['status'=>'not_paid'],['status'=>'unpaid'],['status'=>'paid_out'],['event'=>'purchase'],['status'=>'payment_success_pending']] as $b) printf("  %-40s -> %s\n", json_encode($b), var_export(paytrack_purchase_is_paid($b, (string)($b['event']??'purchase')),true));
echo "\n== 5) Eventos mapeados aceitos pelo endpoint do NAVEGADOR (track.php só bloqueia Purchase)\n";
foreach (['refund','lead','add_to_cart','canceled'] as $e) printf("  %-12s -> %s\n", $e, var_export(MetaCapi::mapEventName($e),true));
echo "\n== 6) 'canceled' em Lowify/Wiapay vira:\n";
$n = gateway_normalize_payload('wiapay', ['status'=>'canceled','id'=>'W2','amount'=>97]); echo "  event=", $n['event'], "\n";
