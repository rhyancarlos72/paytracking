import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Criptografia de segredos em repouso (tokens CAPI/Meta, segredos de gateway, corpos de
 * webhook). AES-256-GCM, formato "v1.<iv>.<tag>.<ciphertext>" em base64url.
 * Corrige P-17 (segredos em texto puro no banco legado).
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('Chave de criptografia deve ter 32 bytes');
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }
  decrypt(box: string): string {
    const [v, iv, tag, ct] = box.split('.');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Segredo cifrado em formato inválido');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }
  encryptNullable(v: string | null | undefined): string | null {
    return v ? this.encrypt(v) : null;
  }
  decryptNullable(v: string | null | undefined): string | null {
    return v ? this.decrypt(v) : null;
  }
}

export const sha256Hex = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
/** Token de integração no formato legado (itk_…), para manter as URLs de webhook compatíveis. */
export const integrationToken = (): string => 'itk_' + randomBytes(24).toString('hex');
export const publicKey = (): string => 'pt_px_' + randomBytes(10).toString('hex');
export const hint = (token: string): string => '…' + token.slice(-4);
