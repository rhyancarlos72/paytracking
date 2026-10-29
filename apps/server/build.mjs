import { build } from 'esbuild';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
// Bundle autossuficiente: pacotes do workspace e dependências npm embutidos, para que a pasta
// dist rode sozinha (hospedagens por painel podem publicar só a pasta de saída, sem node_modules).
await build({
  entryPoints: { server: 'src/server.ts', worker: 'src/worker-main.ts', 'scripts/migrate': 'src/scripts/migrate.ts', 'scripts/import-legacy': 'src/scripts/import-legacy.ts' },
  outdir: 'dist', bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  // pg-native é opcional no pg (só carregado se pedido); cpu-features é opcional no ssh2/mysql2
  external: ['pg-native', 'cpu-features'], logLevel: 'info',
  plugins: [{
    name: 'workspace-inline',
    setup(b) { b.onResolve({ filter: /^@pt\// }, (a) => ({ path: new URL(`../../packages/${a.path.slice(4)}/src/index.ts`, import.meta.url).pathname })); },
  }],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
cpSync('../../packages/db/migrations', 'dist/migrations', { recursive: true });
// painel e pixel junto do servidor (o app procura primeiro em dist/web e dist/pixel)
for (const [from, to] of [['../web/dist', 'dist/web'], ['../../packages/pixel/dist', 'dist/pixel']]) {
  rmSync(to, { recursive: true, force: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
  else console.warn(`aviso: ${from} não existe — rode o build completo (pnpm run build) na raiz`);
}
// a pasta dist publicada sozinha continua ESM e com `npm start`
writeFileSync('dist/package.json', JSON.stringify({ name: 'paytracking-server', private: true, type: 'module', scripts: { start: 'node server.js' } }, null, 2) + '\n');
console.log('server: build ok');
