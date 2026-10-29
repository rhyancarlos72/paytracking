# Plano de migração do PHP para o novo PayTracking

Objetivo: trocar de sistema **sem reconfigurar gateways, sem trocar o snippet nas páginas de
vendas e sem perder venda**, com um caminho de volta em cada etapa. O sistema antigo não é
alterado nem apagado; ele fica parado, mas pronto para voltar, por 30 dias.

## O que garante a troca transparente

| Item | Como continua funcionando |
|---|---|
| URLs de webhook nos gateways | O novo servidor atende `/api/webhook.php` e `/api/webhook_gateway.php?gateway=&token=`. A importação copia o **mesmo hash SHA-256** dos tokens (por projeto e por usuário). |
| Segredos dos gateways | Importados de `gateway_secrets` (usuário e projeto) e passam a ser cifrados. Gateway que tinha segredo continua exigindo assinatura. |
| Snippet nas páginas | `/pixel.js`, `/api/track.php`, `/api/pixel-config.php` e `/checkout-loader-ic-only.js` existem no novo servidor; a `public_key` de cada pixel é mantida. |
| Login | O hash bcrypt `$2y$` do PHP é aceito e regravado no primeiro login. Ninguém precisa trocar senha. |
| Deduplicação na Meta | O `event_id` do Purchase segue a mesma regra do PHP (teste `legacy-capi-parity`), então um evento enviado pelos dois sistemas é deduplicado pela Meta. |

Não é importado: a fila `events` do PHP (reenviar eventos antigos duplicaria conversões) e as
tabelas de deduplicação de webhook (o novo sistema tem a sua).

## Etapas

### 0. Contenção (no sistema atual, já)

1. **Rotacionar todos os segredos que estavam nos ZIPs** (relatório P-01): senha do MySQL,
   `META_APP_SECRET`, credenciais da Woovi, `APP_SECRET` (era um valor de 8 dígitos sequenciais),
   chave VAPID. Os tokens CAPI dos clientes e os tokens de webhook não estavam nos ZIPs.
2. Levantar no painel de cada gateway as vendas aprovadas dos últimos 30 dias, para comparar depois
   (o PHP descartava as compras de Kiwify, Cakto, Kirvano, Lowify e Wiapay — P-02).

### 1. Provisionar (sem tráfego)

Siga `docs/DEPLOY.md` com `CAPI_DISPATCH=paused` e um domínio temporário (ex.: `novo.seudominio.com.br`).
Com o envio pausado, o novo sistema grava tudo e enfileira os eventos, mas **não envia nada à Meta**.

### 2. Importação

Use uma réplica ou cópia do MySQL, ou um usuário só com `SELECT`. O script também abre a sessão
como somente leitura.

Simulação (grava tudo dentro de uma transação e desfaz no fim; mostra contagens e avisos):

```bash
LEGACY_MYSQL_URL='mysql://leitor:SENHA@host/banco' DATABASE_URL='postgres://…' ENCRYPTION_KEY='…' node dist/scripts/import-legacy.js
```

Leia os avisos: hashes de senha inválidos, pixels com ID inválido, produtos cadastrados em dois
pixels, projetos sem token da CAPI. Corrija no PHP ou aceite. Depois aplique:

```bash
LEGACY_MYSQL_URL='mysql://leitor:SENHA@host/banco' DATABASE_URL='postgres://…' ENCRYPTION_KEY='…' node dist/scripts/import-legacy.js --apply
```

A importação é **idempotente**: pode ser repetida (e será, no corte) sem duplicar nada.

Depois de importar, revise em cada integração Lowify/Wiapay a **unidade do valor** (reais ou
centavos). O PHP adivinhava (P-07); aqui é declarado, e o padrão é reais.

### 3. Modo sombra (1 a 2 semanas)

O PHP continua sendo o sistema oficial. O novo recebe uma **cópia** dos webhooks:

- nos gateways que aceitam mais de um webhook, adicione a URL do domínio temporário com o **mesmo
  token** (`https://novo.seudominio.com.br/api/webhook_gateway.php?gateway=kiwify&token=…`);
- nos que aceitam só um, não mexa: eles entram direto no corte.

Compare diariamente, para o mesmo período, três números: vendas aprovadas no **painel do gateway**,
no **PHP** e no **novo** (Vendas e Diagnóstico → Conciliação). Diferenças esperadas, e por quê:

| Diferença | Causa |
|---|---|
| Novo tem vendas de Kiwify/Cakto/Kirvano/Lowify/Wiapay que o PHP não tem | PHP descartava (P-02) |
| PHP tem vendas que o gateway mostra como não pagas | PHP contava `unpaid`/`not_paid`/`disapproved` como pagos (P-03) |
| Valor ×100 ou ÷100 entre PHP e novo | heurística de centavos do PHP (P-07) |
| Reembolso some da receita no novo, não no PHP | P-08 |

Qualquer diferença fora dessas categorias é bug: investigue antes do corte. O histórico de cada
webhook (aceito, duplicado, ignorado, rejeitado e o motivo) fica em Diagnóstico → Webhooks recebidos.

### 4. Corte (janela curta, de preferência de madrugada)

1. 24 h antes: baixe o TTL do DNS do domínio antigo para 300 s.
2. Pare o cron de envio do PHP (`dispatch.php`), para que só um sistema envie dali em diante.
3. Rode a importação de novo (`--apply`), para trazer contas, pixels e vendas criados durante a sombra.
4. Descarte a fila da sombra **com mais de 48 h**. A Meta só deduplica dentro de 48 h, e esses
   eventos o PHP já enviou ou nunca enviaria. Os mais recentes ficam e saem no passo 6: os que o
   PHP também enviou são deduplicados pela Meta pelo mesmo `event_id`.

   ```sql
   UPDATE capi_outbox SET status = 'dead', last_error = 'Descartado no corte: gerado em modo sombra'
    WHERE status = 'pending' AND created_at < now() - interval '48 hours';
   ```
5. Aponte o domínio antigo para o novo serviço (mapeamento de domínio no Cloud Run) e espere o certificado.
6. Troque `CAPI_DISPATCH` para `enabled` (novo deploy da mesma imagem).
7. Mude os webhooks do domínio temporário para o definitivo (ou remova as cópias da sombra).

### 5. Acompanhamento (primeiras 48 h)

- Diagnóstico → Conciliação: aprovadas = Purchase enviado (exceto vendas sem valor ou sem pixel).
- Alertas abertos (falha de envio, token inválido) devem ser zero ou ter causa conhecida.
- Gerenciador de Eventos da Meta: volume de Purchase e qualidade de correspondência por pixel.
- Uma venda de teste real em cada gateway, aprovada e depois reembolsada.

## Rollback

| Momento | Como voltar | Efeito |
|---|---|---|
| Etapas 1–3 | Nada a fazer: o PHP é o oficial. Remova as URLs de sombra dos gateways. | Nenhum |
| Etapa 4 ou depois | Aponte o DNS de volta para o servidor antigo e religue o cron do PHP. | As vendas recebidas pelo novo durante o período ficam só no novo. Exporte-as em Vendas e confira no gateway. Nada se perde: o novo continua com tudo gravado. |

O servidor antigo e o banco MySQL **não são apagados**. Depois de 30 dias estáveis: faça um dump
final do MySQL, guarde-o cifrado, revogue as credenciais antigas e desligue o servidor.

## Correção mínima opcional no PHP (só se o corte demorar)

Se o modo sombra precisar durar mais de algumas semanas, dá para corrigir no PHP os três problemas
que mais distorcem os números (P-02, P-03, P-07). Esse patch **não foi aplicado** e exige sua
autorização, porque altera o sistema em produção. Ele não é necessário se o corte acontecer logo.
