# Métricas do painel — definições

Fonte da verdade: tabela `payments`, preenchida só por webhooks validados (assinatura/token) e
pela importação do legado. Nada vem do navegador: o pixel não consegue criar venda nem `Purchase`.
O código que implementa estas regras está em `apps/server/src/reports/dashboard.ts`.

## Período e fuso

- O período (Hoje, Ontem, 7/30/90 dias, Este mês, Personalizado) é calculado **no fuso da
  organização** (Configurações → Fuso horário; padrão `America/Sao_Paulo`). “Hoje” vai da meia-noite
  local até agora.
- A comparação usa a janela anterior de mesmo tamanho (ex.: últimos 7 dias × os 7 dias antes deles).
- Datas são gravadas em UTC (`timestamptz`); a conversão para o dia local é feita na consulta.

## Vendas e receita

| Métrica | Definição |
|---|---|
| **Vendas confirmadas** | Pagamentos cujo `approved_at` está no período **e** cujo status atual é `approved`. |
| **Receita confirmada** | Soma dos valores dessas vendas, convertida para a moeda de relatório. |
| **Reembolsos e chargebacks** | Pagamentos cujo `reversed_at` está no período, mostrados em separado (quantidade e valor). |
| **Pendentes** | Criados no período e ainda `pending` (PIX gerado, boleto emitido). **Nunca** contam como venda. |
| **Taxa de aprovação** | (aprovados + revertidos) ÷ todos os pagamentos criados no período. Revertidos entram porque foram aprovados antes. |
| **Ticket médio** | Receita confirmada ÷ vendas confirmadas. |

Como a receita só soma pagamentos cujo status **atual** é `approved`, uma venda reembolsada deixa
de contar na receita do dia em que foi aprovada (o legado continuava somando — P-08) e aparece
como reembolso no dia do estorno. O status de pagamento só avança por transições válidas
(`pending → approved → refunded/chargeback`); um webhook atrasado de “pendente” depois do “aprovado”
é registrado e ignorado.

### Status — o que conta como pago

A classificação é por token exato, nunca por “contém a palavra”. `paid`, `approved`, `completed`,
`order_approved` etc. são aprovados; `unpaid`, `not_paid`, `disapproved`, `waiting_payment`,
`pix_generated`, `billet_printed` **não** são. A lista completa por gateway está nos testes de
`packages/gateways/test` e `packages/domain/test`.

## Moeda

- Valores são guardados em **unidades menores** (`amount_minor`, `bigint`) junto da moeda ISO 4217 da venda.
  Exemplo: R$ 197,00 = `19700` BRL; ¥ 500 = `500` JPY (JPY não tem casas decimais).
- A unidade de cada integração é **declarada** (`major` = reais, `minor` = centavos). Kiwify envia centavos;
  Lowify/Wiapay são configuráveis na tela da integração. Não existe heurística.
- Conversão para a moeda de relatório usa a cotação **do dia da aprovação** (BCE via Frankfurter,
  com open.er-api como segunda fonte), cruzada pelo euro.
- Sem cotação para aquele dia/moeda, o valor **não é somado** e o painel mostra “N vendas sem
  conversão”. Nunca se usa 1:1 como substituto.

## Investimento e eficiência

| Métrica | Definição |
|---|---|
| **Investimento** | Gasto da conta de anúncios conectada (Meta Insights, nível conta), por dia, convertido pela cotação do dia. |
| **CPA** | Investimento ÷ vendas confirmadas. |
| **ROAS** | Receita confirmada ÷ investimento. |
| **Resultado** | Receita confirmada − investimento (não inclui taxas do gateway nem impostos). |
| **Taxa de conversão** | Vendas confirmadas ÷ PageViews recebidos no período. |

Sem conta de anúncios conectada, investimento/CPA/ROAS aparecem como “—”, não como zero.
Com filtro por pixel ou gateway, o investimento também fica “—”, porque o gasto da conta não pode
ser dividido por pixel sem inventar uma regra.

## Números da Meta (atribuídos)

“Compras” e “valor de conversão” **reportados pela Meta** aparecem em colunas separadas, rotuladas
como atribuição da Meta. Eles seguem a janela de atribuição da Meta e podem divergir das vendas
confirmadas. O sistema antigo usava o maior dos dois números; aqui eles **não se misturam**.

## Campanhas

Na tela de Campanhas, cada linha mostra lado a lado:
- **Rastreado**: vendas confirmadas cujo `utm_campaign` (ou `utm_id`) corresponde à campanha;
- **Meta**: gasto, compras e valor atribuídos pela Meta.

A correspondência olha `utm_campaign`, `utm_content`, `utm_term`, `utm_medium` e `utm_id` da venda:
casa quando algum deles é igual ao nome da campanha (sem diferenciar maiúsculas) ou contém o ID
da campanha (ex.: `{{campaign.id}}` nos parâmetros de URL do anúncio).

## Eventos e cobertura

| Métrica | Definição |
|---|---|
| **Eventos recebidos** | Linhas em `tracking_events` no período, por nome e origem (navegador/servidor). |
| **Enviados à Meta** | Itens da fila `capi_outbox` com status `sent` (resposta com `events_received ≥ 1`). |
| **Com falha** | Itens `dead`: erro definitivo ou tentativas esgotadas. Podem ser reprocessados. |
| **Cobertura de correspondência** | % de eventos enviados com cada chave (`em`, `ph`, `fbp`, `fbc`, `external_id`, IP, user agent). |

## Metas

Meta diária e mensal (em unidades menores da moeda de relatório) são comparadas à receita
confirmada de hoje e do mês corrente no fuso da organização.

## Dados de demonstração e históricos

- `provider = 'demo'`: criado por `seed:demo`; a organização se chama `[DEMONSTRAÇÃO] …`.
- `provider = 'legacy'`: vendas importadas do sistema antigo. Entram na receita como histórico, mas
  o PHP contava como pagos alguns status não pagos (P-03), então podem estar superestimadas.
  Compare com o relatório do gateway antes de usar para decisões.
