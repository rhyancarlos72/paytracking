import { createPool, migrate } from '@pt/db';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `${applied.length} migração(ões) aplicada(s)` : 'banco já está atualizado');
} finally {
  await pool.end();
}
