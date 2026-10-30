# Design system do painel

Implementação: tokens em `apps/web/src/styles/index.css` (variáveis CSS, RGB para o Tailwind
aplicar opacidade), mapeados em `apps/web/tailwind.config.js`. Componentes em
`apps/web/src/components/ui.tsx`. O tema escuro é a classe `.dark` no `<html>`: segue o sistema
operacional até a pessoa escolher no botão do topo (a escolha fica em `localStorage`), e é
aplicado antes do primeiro desenho (`public/theme.js`), sem piscar.

## Cores

Todo token usado como **texto** tem contraste ≥ 4,5:1 (WCAG AA) sobre `bg` e `surface`, nos dois
temas. Contrastes calculados sobre `surface` (claro `#ffffff`, escuro `rgb(13 14 20)`), não estimados:

| Token | Uso | Claro | Contraste | Escuro | Contraste |
|---|---|---|---|---|---|
| `fg` | texto principal | `rgb(11 13 26)` | 19,3 | `rgb(237 238 245)` | 16,7 |
| `muted` | texto secundário, rótulos | `rgb(93 99 120)` | 6,0 | `rgb(152 158 178)` | 7,2 |
| `subtle` | títulos de grupo, placeholder | `rgb(100 106 127)` | 5,4 | `rgb(124 130 152)` | 5,1 |
| `primary` | links, item ativo, anéis | `rgb(103 68 245)` | 5,6 | `rgb(156 136 255)` | 6,8 |
| `ok` | aprovado, sucesso | `rgb(4 120 87)` | 5,5 | `rgb(52 211 153)` | 10,0 |
| `warn` | pendente, atenção | `rgb(170 78 8)` | 5,5 | `rgb(251 191 36)` | 11,5 |
| `err` | erro, reembolso | `rgb(200 30 30)` | 5,7 | `rgb(248 113 113)` | 7,0 |
| `info` | informação | `rgb(29 78 216)` | 6,7 | `rgb(96 165 250)` | 7,6 |
| `err-fg` | texto sobre botão de perigo | branco (5,7) | | `rgb(10 11 15)` (7,1) | |

**Botão principal** (`.btn-primary`): gradiente `#7653ff → #6d4aff → #5b37f0` com texto branco nos dois
temas — o pior ponto (`#6d4aff`) dá 5,15:1. **Avatares e marcas de gateway**: letras brancas sobre tons
`-600/-700` (≥ 5:1); são decorativos (`aria-hidden`), o nome sempre aparece em texto ao lado.

Superfícies: `bg`, `surface` (cartões), `surface-2` (cabeçalho de tabela, hover), `surface-3` (trilhos de
progresso), `border` e `border-strong` (hover). No escuro os cartões são translúcidos com desfoque e um
brilho interno de 1 px; profundidade vem de superfícies mais claras, não de sombra. O fundo "aurora"
(dois brilhos radiais no topo) é decorativo e fica atrás do conteúdo.

**Status nunca só por cor:** todo `Badge` de status traz o texto (“Aprovado”, “Pendente”,
“Reembolsado”), e alertas trazem ícone e título.

## Gráficos

Uma série = uma cor, em ordem fixa (a cor segue a métrica, não a posição):

| Série | Claro | Escuro |
|---|---|---|
| 1 — receita confirmada | `#6d4aff` | `#8b70ff` |
| 2 — investimento | `#0d9488` | `#0f9e8e` |

Revalidadas contra as superfícies atuais (claro `#ffffff`, escuro `#0d0e14`): todos os checks passam
(CVD ΔE ≥ 19, visão normal ΔE ≥ 25, contraste ≥ 3:1). Mini-gráficos (sparklines) usam a série 1.

Validadas com o verificador de paleta (faixa de luminosidade, croma, separação para daltonismo
nos três tipos, contraste com a superfície do gráfico) nos dois temas. Regras:
- **um eixo só**: receita e investimento estão na mesma moeda; nunca dois eixos Y;
- linhas de 2 px, grade discreta (`--grid`), legenda sempre presente com 2 séries;
- tooltip com os valores formatados na moeda de relatório e o dia;
- valores sem conversão de moeda não são desenhados como zero: o cartão avisa quantos ficaram de fora.

## Tipografia

Inter Variable (servida pelo próprio app, sem Google Fonts), 15 px no corpo, números com
`tabular-nums` (classe `.num`) para alinharem em tabelas e KPIs. Títulos de página 22–24 px semibold.

## Movimento

Entrada de página (`slide-up`), modais (`scale-in`), números que contam até o valor final
(`useCountUp`), carregamento com brilho deslizante (`.skeleton`) e cartões que sobem 2 px no hover.
Tudo é desligado com `prefers-reduced-motion` (o número aparece direto no valor final).

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
| `Callout` | avisos de contexto (ex.: e-mail não confirmado, envio pausado), com faixa colorida à esquerda |
| `ProgressRing` | metas e ROAS; `role="progressbar"` com o valor |
| `Avatar` | iniciais com cor estável por nome (só letras e números) |
| `IconTile` | ícone em ladrilho (neutro ou com gradiente) |
| `CommandPalette` | ⌘K / Ctrl K: páginas e ações; `combobox` + `listbox`, setas, Enter, Esc |

## Acessibilidade e responsividade

- Link “Pular para o conteúdo” como primeiro item do Tab (testado no E2E); foco visível em tudo.
- Navegação lateral vira gaveta abaixo de 1024 px; nenhuma tela tem rolagem horizontal em 390 px
  (testado no E2E); tabelas largas rolam dentro do próprio cartão.
- `prefers-reduced-motion` desliga animações.
- Ícones decorativos ficam fora da leitura; botões só com ícone têm `aria-label`.
