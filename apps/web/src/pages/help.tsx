import { PageHeader } from '../components/shell';
import { Card } from '../components/ui';

const SECTIONS: Array<{ q: string; a: string[] }> = [
  { q: 'Como uma venda vira Purchase na Meta?', a: [
    'O gateway envia o webhook → validamos a assinatura → registramos o pagamento → só quando o status real for APROVADO o Purchase entra na fila → o worker envia à Conversions API e marca "Enviado" apenas quando a Meta confirma o recebimento (events_received).',
    'PIX ou boleto gerado ficam como "Pendente" e nunca geram Purchase. Uma página de obrigado também não gera Purchase.',
  ] },
  { q: 'Por que a Meta mostra números diferentes dos meus?', a: [
    'A receita confirmada vem dos pagamentos aprovados pelos gateways. Os números da Meta usam a janela de atribuição dela e incluem os Purchases que enviamos. Por isso mostramos os dois lado a lado, sem somar.',
  ] },
  { q: 'Como evitar InitiateCheckout duplicado?', a: [
    'Escolha UM modo: no checkout (recomendado) ou no clique do botão da página de vendas. O pixel e a CAPI usam o mesmo event_id e a Meta deduplica o par automaticamente.',
  ] },
  { q: 'Como as moedas são tratadas?', a: [
    'Cada evento vai à Meta na moeda original da venda. Nos relatórios, tudo é convertido para a moeda da organização pela cotação do dia da venda (Banco Central Europeu). Sem cotação, a venda é marcada como "não convertida" — nunca estimamos.',
    'Orçamentos de campanha são exibidos e editados na moeda da conta de anúncios.',
  ] },
  { q: 'Um evento falhou. E agora?', a: [
    'Em Diagnóstico → Entrega CAPI você vê a mensagem exata da Meta. Corrija a causa (ex.: token expirado no pixel) e clique em "Reprocessar falhas" em Eventos. Reprocessar não duplica: o event_id é o mesmo.',
  ] },
  { q: 'Meu gateway reenviou o mesmo webhook. Vou contar duas vezes?', a: [
    'Não. Cada transação é única por gateway e o status só avança (pendente → aprovado → reembolsado). Reenvios aparecem como "Duplicado" em Diagnóstico → Webhooks.',
  ] },
  { q: 'Como testar a instalação do pixel?', a: [
    'Abra sua página com ?pt_test=1 no final da URL. Um painel mostra cada evento disparado e a resposta do servidor. Para validar no Gerenciador de Eventos, preencha o Test Event Code no pixel e remova depois.',
  ] },
  { q: 'Formato do webhook do checkout próprio', a: [
    'POST /v1/webhooks/checkout com Authorization: Bearer <token>. Corpo JSON: event (ex.: "paid", "pix_generated", "refunded"), transaction_id, value (reais), currency, customer { email, phone, name, document }, product_id e tracking { fbp, fbc, external_id, purchase_event_id, utm_* }.',
    'Com segredo configurado, envie X-Paytrack-Signature: sha256=<HMAC-SHA256 do corpo> e, para proteção contra replay, X-Paytrack-Timestamp (o HMAC passa a cobrir "<timestamp>.<corpo>").',
  ] },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Ajuda" description="Como o PayTracking funciona e como resolver os problemas mais comuns." />
      <div className="max-w-3xl space-y-3">
        {SECTIONS.map((s) => (
          <Card key={s.q} padded={false}>
            <details className="group">
              <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">
                <span className="flex items-center justify-between gap-4">{s.q}<span className="text-muted transition-transform group-open:rotate-45" aria-hidden>+</span></span>
              </summary>
              <div className="space-y-2 px-5 pb-5 text-sm leading-relaxed text-muted">{s.a.map((p) => <p key={p}>{p}</p>)}</div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
