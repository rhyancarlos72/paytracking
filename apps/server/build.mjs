import { build } from 'esbuild';
import { cpSync } from 'node:fs';
// Bundle do servidor e do worker (pacotes do workspace embutidos; dependências npm externas).
await build({
  entryPoints: ['src/server.ts', 'src/worker.ts', 'src/scripts/migrate.ts', 'src/scripts/import-legacy.ts'],
  outdir: 'dist', bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: true,
  packages: 'external', external: ['@pt/*'], logLevel: 'info',
  plugins: [{
    name: 'workspace-inline',
    setup(b) { b.onResolve({ filter: /^@pt\// }, (a) => ({ path: new URL(`../../packages/${a.path.slice(4)}/src/index.ts`, import.meta.url).pathname })); },
  }],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
cpSync('../../packages/db/migrations', 'dist/migrations', { recursive: true });
console.log('server: build ok');
