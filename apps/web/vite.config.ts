import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://localhost:8080', '/pixel.js': 'http://localhost:8080', '/checkout-loader.js': 'http://localhost:8080' },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Função (e não lista): com a lista, dependências pequenas COMPARTILHADAS (ex.: clsx, react-is) iam parar no
        // pacote dos gráficos e o arquivo inteiro do recharts (~115 KB gzip) era pré-carregado em todas as páginas,
        // inclusive login e página inicial. Agora só o código exclusivo dos gráficos fica nele.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // utilitários pequenos usados pelo app E pelos gráficos: ficam com o React (sempre carregado);
          // sem isso o Rollup os colocava no pacote dos gráficos e o app inteiro passava a depender dele
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|clsx|react-is|prop-types|tiny-invariant|@babel[\\/]runtime)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'query';
          if (/[\\/]node_modules[\\/](recharts|recharts-scale|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light|lodash|eventemitter3|fast-equals|react-smooth|@reduxjs|redux|immer|reselect|use-sync-external-store|es-toolkit)[\\/]/.test(id)) return 'charts';
          return undefined;
        },
      },
    },
  },
});
