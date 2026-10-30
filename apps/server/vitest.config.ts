import { defineConfig } from 'vitest/config';

// Testes do servidor usam Postgres real e bcrypt com custo de produção (12): em máquinas de CI
// mais lentas, cenários como "10 logins errados" passam dos 5 s padrão do vitest.
export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 60_000 },
});
