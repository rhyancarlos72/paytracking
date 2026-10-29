# Design system do painel

Implementação: tokens em `apps/web/src/styles/index.css` (variáveis CSS, RGB para o Tailwind
aplicar opacidade), mapeados em `apps/web/tailwind.config.js`. Componentes em
`apps/web/src/components/ui.tsx`. O tema escuro é a classe `.dark` no `<html>`: segue o sistema
operacional até a pessoa escolher no botão do topo (a escolha fica em `localStorage`), e é
aplicado antes do primeiro desenho (`public/theme.js`), sem piscar.

## Cores

Todo token usado como **texto** tem contraste ≥ 4,5:1 (WCAG AA) sobre `bg` e `surface`, nos dois
temas. Contrastes calculados, não estimados:

| Token | Uso | Claro | Contraste | Escuro | Contraste |
|---|---|---|---|---|---|
| `fg` | texto principal | `rgb(16 24 40)` | 17,8 | `rgb(236 238 243)` | 16,0 |
| `muted` | texto secundário, rótulos | `rgb(102 112 133)` | 5,0 | `rgb(154 160 173)` | 7,1 |
| `subtle` | títulos de grupo, placeholder | `rgb(110 119 138)` | 4,5 | `rgb(108 114 128)` | 3,9* |
| `primary` | links, item ativo, botão | `rgb(109 74 255)` | 5,2 | `rgb(139 112 255)` | 5,2 |
| `primary-fg` | texto sobre botão primário | branco | 5,2 | `rgb(10 11 15)` | 5,5 |
| `ok` | aprovado, sucesso | `rgb(6 118 71)` | 5,7 | `rgb(50 213 131)` | 9,7 |
| `warn` | pendente, atenção | `rgb(181 71 8)` | 5,4 | `rgb(253 176 34)` | 10,1 |
| `err` | erro, reembolso | `rgb(217 45 32)` | 4,8 | `rgb(249 112 102)` | 6,7 |
| `err-fg` | texto sobre botão de perigo | branco | 4,8 | `rgb(10 11 15)` | 7,1 |
| `info` | informação | `rgb(23 92 211)` | 6,0 | `rgb(83 177 253)` | 8,0 |

\* `subtle` no escuro fica abaixo de 4,5 sobre `surface`. Use-o só em texto grande (títulos de
grupo em caixa alta) ou decorativo, nunca em conteúdo.

Superfícies: `bg` (fundo da página), `surface` (cartões), `surface-2` (cabeçalho de tabela, hover),
`border`. No escuro, profundidade vem de superfícies mais claras, não de sombra.

**Status nunca só por cor:** todo `Badge` de status traz o texto (“Aprovado”, “Pendente”,
“Reembolsado”), e alertas trazem ícone e título.

## Gráficos

Uma série = uma cor, em ordem fixa (a cor segue a métrica, não a posição):

| Série | Claro | Escuro |
|---|---|---|
| 1 — receita confirmada | `#6d4aff` | `#8b70ff` |
| 2 — investimento | `#0d9488` | `#0f9e8e` |

Validadas com o verificador de paleta (faixa de luminosidade, croma, separação para daltonismo
nos três tipos, contraste com a superfície do gráfico) nos dois temas. Regras:
- **um eixo só**: receita e investimento estão na mesma moeda; nunca dois eixos Y;
- linhas de 2 px, grade discreta (`--grid`), legenda sempre presente com 2 séries;
- tooltip com os valores formatados na moeda de relatório e o dia;
- valores sem conversão de moeda não são desenhados como zero: o cartão avisa quantos ficaram de fora.

## Tipografia

Inter Variable (servida pelo próprio app, sem Google Fonts), 15 px no corpo, números com
`tabular-nums` (classe `.num`) para alinharem em tabelas e KPIs. Títulos de página 22–24 px semibold.

## Componentes

| Componente | Notas |
|---|---|
| `Button` | variantes primary / secondary / ghost / danger; `loading` desabilita e mostra spinner |
| `Field` + `Input`/`Select`/`Textarea` | rótulo ligado ao campo, dica e erro com `aria-describedby` |
| `Card` | título, descrição e ações; `padded={false}` para tabelas |
| `Badge` + `STATUS_TONE` | cor por status, sempre com texto |
| `Modal` | foco preso dentro, `Esc` fecha, título como `aria-labelledby` |
| `ConfirmButton` | ações destrutivas pedem confirmação explícita |
| `EmptyState` / `ErrorState` / `Skeleton` | toda tela tem os três estados: vazio, erro, carregando |
| `CopyButton` / `CodeBlock` | snippets e URLs de webhook |
| `Tabs` / `Segmented` / `Pager` | navegação dentro da página |
| `Callout` | avisos de contexto (ex.: e-mail não confirmado, envio pausado) |

## Acessibilidade e responsividade

- Link “Pular para o conteúdo” como primeiro item do Tab (testado no E2E); foco visível em tudo.
- Navegação lateral vira gaveta abaixo de 1024 px; nenhuma tela tem rolagem horizontal em 390 px
  (testado no E2E); tabelas largas rolam dentro do próprio cartão.
- `prefers-reduced-motion` desliga animações.
- Ícones decorativos ficam fora da leitura; botões só com ícone têm `aria-label`.
