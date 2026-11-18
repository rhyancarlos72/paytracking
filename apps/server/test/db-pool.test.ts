import { createPool } from '@pt/db';
import { describe, expect, it, vi } from 'vitest';
import { TEST_DB } from './helpers.js';

describe('pool do banco', () => {
  it('conexão ociosa encerrada pelo servidor (Neon suspendendo) não derruba o processo e a próxima consulta funciona', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pool = createPool(TEST_DB.replace(/\/[^/]+$/, '/postgres'), 1);
    const pid = (await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid; // fica ociosa no pool
    const admin = createPool(TEST_DB.replace(/\/[^/]+$/, '/postgres'), 1);
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await admin.end();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 5000 });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ level: 'warn', code: '57P01' });
    const again = (await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    expect(again).not.toBe(pid);
    await pool.end();
    warn.mockRestore();
  });
});

describe('motivo da queda do banco no /healthz', () => {
  it('classifica os erros comuns do Neon sem expor detalhes', async () => {
    const { dbFailureReason } = await import('../src/app.js');
    expect(dbFailureReason(new Error('Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.'))).toBe('neon_quota_exceeded');
    expect(dbFailureReason(Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' }))).toBe('auth_failed');
    expect(dbFailureReason(new Error('The endpoint has been disabled. Enable it using Neon API and retry.'))).toBe('neon_endpoint_disabled');
    expect(dbFailureReason(Object.assign(new Error('getaddrinfo ENOTFOUND ep-x.neon.tech'), { code: 'ENOTFOUND' }))).toBe('dns');
    expect(dbFailureReason(new Error('Connection terminated due to connection timeout'))).toBe('timeout');
    expect(dbFailureReason(Object.assign(new Error('sorry, too many clients already'), { code: '53300' }))).toBe('too_many_connections');
    expect(dbFailureReason(new Error('algo novo'))).toBe('unknown');
  });
});
