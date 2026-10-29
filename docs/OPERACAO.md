# Operação, observabilidade e alertas

## Sinais disponíveis

| Sinal | Onde |
|---|---|
| **Saúde** | `GET /healthz` → `200 {"ok":true}` com banco acessível, `503` sem banco (o processo não cai; o worker espera e tenta de novo). |
| **Logs** | JSON por linha no stdout, com `severity` (INFO/WARNING/ERROR) para o Cloud Logging. Cada requisição tem `reqId`. Webhooks devolvem `x-correlation-id`, gravado em `webhook_receipts` e `capi_outbox`: com ele dá para seguir uma venda do recebimento até a Meta. |
| **Alertas no painel** | Tabela `alerts`, exibidos no Diagnóstico, deduplicados por causa; os de envio à Meta se resolvem sozinhos quando um envio volta a dar certo. |
| **Conciliação** | Diagnóstico → Conciliação: aprovadas × Purchase enviado × na fila × falhou × sem pixel. |
| **Webhooks recebidos** | Diagnóstico → Webhooks: cada chamada com resultado e motivo, sem dados pessoais. |

### O que nunca aparece nos logs

Tokens (cabeçalhos `authorization`, `cookie`, `x-hotmart-hottok` e `security-token` são
mascarados), querystring (os tokens das URLs legadas vão nela), o segmento de token de
`/v1/webhooks/{gateway}/{token}`, corpo de webhook e dados pessoais. O corpo do webhook é guardado
**cifrado** por `WEBHOOK_BODY_RETENTION_DAYS` (padrão 30), só para reprocessamento.

## Alertas gerados pelo sistema

| Tipo | Quando | O que fazer |
|---|---|---|
| `capi_config` | Pixel inativo ou sem token da CAPI com eventos na fila | Ativar o pixel ou cadastrar o token; depois **Reprocessar** no Diagnóstico. |
| `capi_token` | A Meta recusou o token (código 190/200/10) | Gerar novo token no Gerenciador de Eventos (com permissão no pixel), salvar no pixel, reprocessar. |
| `capi_failing` | Falha definitiva ou tentativas esgotadas (`CAPI_MAX_ATTEMPTS`) | Ler a mensagem da Meta em Falhas recentes; corrigir; reprocessar. |
| `meta_token` / `meta_token_expiring` | Conexão com o Meta Ads expirou ou expira em 7 dias | Reconectar em Integrações → Meta Ads. |
| `sale_without_pixel` | Venda aprovada cujo produto não está em nenhum pixel e a integração não tem pixel padrão | Cadastrar o ID do produto no pixel ou definir pixel padrão. Vale para as próximas vendas: as já recebidas sem pixel **não** são reenviadas (limitação atual). |
| `purchase_without_value` | Gateway aprovou sem informar valor | O Purchase não é enviado (a Meta exige valor). Verificar a configuração do gateway. |

Reprocessar usa o **mesmo `event_id`**, então a Meta deduplica se o evento já tinha chegado.

## Alertas recomendados no Cloud Monitoring

Crie alertas baseados em log (Logging → Criar alerta baseado em log), com notificação por e-mail:

| Alerta | Filtro |
|---|---|
| Erro interno da API | `resource.type="cloud_run_revision" severity>=ERROR jsonPayload.msg="erro não tratado"` |
| Worker sem banco | `resource.type="cloud_run_revision" jsonPayload.msg="worker: erro no ciclo"` |
| Envio à Meta falhando | `resource.type="cloud_run_revision" jsonPayload.msg="capi dispatch" jsonPayload.dead>0` |
| Câmbio indisponível | `resource.type="cloud_run_revision" jsonPayload.msg="câmbio atualizado" jsonPayload.stored=0` |

E uma verificação de disponibilidade (Uptime check) em `https://SEU_DOMINIO/healthz` a cada 1 minuto.

## Consultas úteis (somente leitura)

Fila acumulada por organização:

```sql
SELECT org_id, status, count(*), min(created_at) AS mais_antigo
  FROM capi_outbox WHERE status IN ('pending', 'sending') GROUP BY 1, 2 ORDER BY 3 DESC;
```

Webhooks rejeitados nas últimas 24 h, por motivo:

```sql
SELECT provider, reason, count(*) FROM webhook_receipts
 WHERE outcome = 'rejected' AND received_at > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 3 DESC;
```

Seguir uma venda pelo `x-correlation-id`:

```sql
SELECT 'webhook' AS etapa, received_at AS em, outcome AS status, reason AS detalhe FROM webhook_receipts WHERE correlation_id = $1
UNION ALL
SELECT 'meta', created_at, status, coalesce(last_error, fbtrace_id) FROM capi_outbox WHERE correlation_id = $1
ORDER BY em;
```

## Retenção (executada pelo worker a cada hora)

| Dado | Prazo |
|---|---|
| Eventos de rastreamento (`tracking_events`) | `TRACKING_RETENTION_DAYS` (padrão 180) |
| Corpo cifrado dos webhooks | `WEBHOOK_BODY_RETENTION_DAYS` (padrão 30); o registro do recebimento fica |
| Identidades de visitante | 120 dias sem atividade |
| Sessões e tokens expirados | 7 dias e 1 dia após expirar |
| Cache da Meta | 2 dias |

Vendas (`payments`) e o histórico de transições **não** são apagados automaticamente.

## Incidentes comuns

**Vendas aprovadas não aparecem.** Diagnóstico → Webhooks: se não há chamada, o gateway não está
enviando (URL ou token errados no painel do gateway). Se há chamada `rejected`, o motivo diz se é
token, assinatura ou formato. Se é `ignored`, o status não era de pagamento aprovado.

**Purchase não chega à Meta.** Conciliação → “Na fila” crescendo: worker parado ou envio pausado
(`CAPI_DISPATCH=paused`, há um aviso no Diagnóstico). “Falhou”: ver alerta e mensagem.

**Banco fora do ar.** `/healthz` responde 503, webhooks recebem 5xx e os gateways reenviam
depois (todos fazem retentativa). Ao voltar, a idempotência garante que nada é contado duas vezes.

**Chave de criptografia.** Se `ENCRYPTION_KEY` for trocada, os tokens e segredos gravados ficam
ilegíveis. Não existe rotação automática: para trocar, é preciso recifrar com as duas chaves. Isso
ainda não está implementado. Guarde a chave com versões no Secret Manager.
