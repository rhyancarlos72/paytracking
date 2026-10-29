import { directDatabaseUrl } from '@pt/db';
import { describe, expect, it } from 'vitest';

describe('URL direta para migrações (Neon)', () => {
  const pooled = 'postgresql://u:p@ep-exemplo-a1b2c3-pooler.c-2.sa-east-1.aws.neon.tech/db?sslmode=require&channel_binding=require';
  it('usa DATABASE_URL_UNPOOLED quando existe', () => {
    expect(directDatabaseUrl(pooled, 'postgresql://u:p@direta/db')).toBe('postgresql://u:p@direta/db');
  });
  it('sem ela, tira o -pooler do host do Neon e mantém credenciais e parâmetros', () => {
    expect(directDatabaseUrl(pooled)).toBe('postgresql://u:p@ep-exemplo-a1b2c3.c-2.sa-east-1.aws.neon.tech/db?sslmode=require&channel_binding=require');
  });
  it('fora do Neon devolve a mesma URL', () => {
    expect(directDatabaseUrl('postgres://u:p@localhost:5432/db')).toBe('postgres://u:p@localhost:5432/db');
    expect(directDatabaseUrl('postgres://u:p@meu-pooler.exemplo.com/db')).toBe('postgres://u:p@meu-pooler.exemplo.com/db');
  });
});
