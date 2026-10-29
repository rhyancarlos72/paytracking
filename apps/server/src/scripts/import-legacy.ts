import { createPool } from '@pt/db';
import mysql from 'mysql2/promise';
import { importLegacy, type LegacySource } from '../legacy/import.js';
import { SecretBox } from '../lib/crypto.js';

/**
 * Uso (somente leitura no MySQL legado; escreve no Postgres novo):
 *   LEGACY_MYSQL_URL=mysql://usuario:senha@host/banco DATABASE_URL=... ENCRYPTION_KEY=... \
 *     pnpm --filter @pt/server import:legacy [--apply]
 * Sem --apply roda em modo simulação (tudo dentro de uma transação desfeita no fim).
 */
const apply = process.argv.includes('--apply');
const { LEGACY_MYSQL_URL, DATABASE_URL, ENCRYPTION_KEY } = process.env;
if (!LEGACY_MYSQL_URL || !DATABASE_URL || !ENCRYPTION_KEY) {
  console.error('Defina LEGACY_MYSQL_URL, DATABASE_URL e ENCRYPTION_KEY.');
  process.exit(1);
}

const my = await mysql.createConnection({ uri: LEGACY_MYSQL_URL, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false });
// a sessão é só leitura: o legado nunca é alterado por este script
await my.query('SET SESSION TRANSACTION READ ONLY');

async function rows<T>(sql: string): Promise<T[]> {
  try {
    const [r] = await my.query(sql);
    return r as T[];
  } catch (e) {
    // tabelas criadas sob demanda pelo PHP podem não existir em instalações antigas
    if ((e as { code?: string }).code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  }
}

const source: LegacySource = {
  users: () => rows('SELECT * FROM users ORDER BY id'),
  projects: () => rows('SELECT * FROM projects ORDER BY id'),
  sales: () => rows('SELECT * FROM sales ORDER BY id'),
  metaConnections: () => rows('SELECT * FROM meta_connections ORDER BY id'),
  pushSubscriptions: () => rows('SELECT * FROM push_subscriptions ORDER BY id'),
};

const pool = createPool(DATABASE_URL, 2);
try {
  const report = await importLegacy(pool, new SecretBox(ENCRYPTION_KEY), source, { dryRun: !apply });
  const { warnings, ...counts } = report;
  console.log(apply ? 'Importação aplicada.' : 'SIMULAÇÃO (nada gravado). Rode com --apply para gravar.');
  console.table(counts);
  if (warnings.length) {
    console.log(`\n${warnings.length} aviso(s):`);
    for (const w of warnings) console.log(' -', w);
  }
} finally {
  await my.end();
  await pool.end();
}
