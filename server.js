// Ponto de entrada na raiz para hospedagens por painel (detectam o projeto pelo package.json
// da raiz e carregam este arquivo com require()). É CommonJS de propósito: carrega o servidor
// real — o bundle ESM autossuficiente gerado por `pnpm run build` — com import() dinâmico,
// que funciona tanto com require() quanto com `node server.js`.
import('./apps/server/dist/server.js').catch((err) => {
  console.error('Não foi possível carregar apps/server/dist/server.js. Rode `pnpm run build`.', err);
  process.exit(1);
});
