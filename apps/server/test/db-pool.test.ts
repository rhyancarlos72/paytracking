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
