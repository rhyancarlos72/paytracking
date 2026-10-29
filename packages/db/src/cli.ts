import { createPool, migrate } from './index.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}
const pool = createPool(url, 1);
migrate(pool)
  .then((a) => console.log(a.length ? `${a.length} migração(ões) aplicada(s)` : 'banco já está atualizado'))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
