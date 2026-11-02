import { Code2, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CodeBlock } from './ui';

/** Parâmetros de URL recomendados para os anúncios da Meta (nome|id de campanha, conjunto e anúncio). */
export const META_UTM =
  'utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}';

export function MetaUtmCard({ className }: { className?: string }) {
  return (
    <Card className={className} icon={<Link2 />} title="Parâmetros de URL nos anúncios da Meta"
      description="Cole em todos os anúncios para cada venda ser marcada com a campanha, o conjunto e o anúncio certos.">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <CodeBlock label="Parâmetros de URL" code={META_UTM} />
          <p className="text-xs text-muted">
            Nome <b>e</b> ID juntos (<code className="font-mono">nome|id</code>): mesmo que você renomeie uma campanha, a venda continua ligada a ela pelo ID.
          </p>
        </div>
        <ol className="space-y-2.5 text-sm">
          {[
            'No Gerenciador de Anúncios, abra o anúncio (ou selecione vários e clique em Editar).',
            'Desça até “Rastreamento” → “Parâmetros de URL”.',
            'Cole o texto ao lado, exatamente como está, e publique.',
            'Repita em todos os anúncios ativos (e nos novos) — anúncios sem parâmetros aparecem sem campanha.',
          ].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
          <li className="pl-9 text-xs text-muted">Resultado em <Link to="/campanhas" className="font-semibold text-primary hover:underline">Campanhas</Link> e <Link to="/atribuicao" className="font-semibold text-primary hover:underline">Atribuição</Link>.</li>
        </ol>
      </div>
    </Card>
  );
}

/** Script de UTMs para a página de vendas: repassa as UTMs do anúncio a todos os links (checkout incluso). */
export function utmScriptTag(origin = typeof location !== 'undefined' ? location.origin : '') {
  return `<script src="${origin}/utms.js" async defer></script>`;
}

export function UtmScriptCard({ className }: { className?: string }) {
  return (
    <Card className={className} icon={<Code2 />} title="Script de UTMs na página de vendas"
      description="Garante que as UTMs do anúncio cheguem ao checkout (Hotmart, Kiwify, Cakto, Kirvano…) e às próximas páginas.">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <CodeBlock label="Cole antes de </head> da página de vendas" code={utmScriptTag()} />
          <p className="text-xs text-muted">
            Leve (≈3 KB), sem cookies de terceiros. Funciona junto com o pixel do PayTracking: o pixel cuida do <code className="font-mono">xcod</code>/<code className="font-mono">sck</code> com o
            id do visitante (melhor para a Hotmart), e este script nunca troca o que o link já tem.
          </p>
        </div>
        <ol className="space-y-2.5 text-sm">
          {[
            'Cole o script em todas as páginas de vendas (e na página de obrigado/upsell, se houver).',
            'Ele guarda as UTMs da primeira página e as repassa para todos os links e botões — inclusive os que aparecem depois.',
            'Pronto: o checkout recebe utm_source, utm_campaign, utm_medium, utm_content, utm_term e fbclid.',
          ].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
          <li className="pl-9 text-xs text-muted">Opcional: <code className="font-mono">data-only="hotmart.com,kiwify.com.br"</code> para decorar só os links do checkout.</li>
        </ol>
      </div>
    </Card>
  );
}
