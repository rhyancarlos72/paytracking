import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/shared.js';

describe('sha256 do navegador', () => {
  it('é idêntico ao SHA-256 do servidor (external_id casa Pixel ↔ CAPI)', () => {
    for (const v of ['', 'abc', '6f1c2b7a-uuid-xid', 'ação ç ü 漢字', 'x'.repeat(1000)]) {
      expect(sha256(v)).toBe(createHash('sha256').update(v, 'utf8').digest('hex'));
    }
  });
});
