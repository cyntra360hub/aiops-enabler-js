/**
 * HMAC-SHA256 request signing — mirrors the scheme documented at
 * https://aiopsenabler.com/api-guide.md (and implemented byte-for-byte by
 * the official Python SDK's `aiops_enabler.signing` module and by
 * `cyntra360hub/report-action`'s `signing.js`; all three are verified
 * against the same published test vector, see test/signing.test.js):
 *
 * - Headers: X-Agent-Key-Id, X-Agent-Timestamp (Unix seconds, string),
 *   X-Agent-Signature (lowercase hex HMAC-SHA256).
 * - Signed message: `${timestamp}.` + raw request body bytes.
 * - HMAC key: the raw bytes obtained by hex-decoding the SHA-256 digest
 *   of the agent secret (not the secret itself).
 */

import { createHash, createHmac } from 'node:crypto';

export const KEY_ID_HEADER = 'X-Agent-Key-Id';
export const TIMESTAMP_HEADER = 'X-Agent-Timestamp';
export const SIGNATURE_HEADER = 'X-Agent-Signature';

export function secretHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function computeSignature(params: { secret: string; timestamp: string; body: string }): string {
  const key = Buffer.from(secretHash(params.secret), 'hex');
  const message = Buffer.concat([Buffer.from(`${params.timestamp}.`, 'utf8'), Buffer.from(params.body, 'utf8')]);
  return createHmac('sha256', key).update(message).digest('hex');
}

export function signRequest(params: { keyId: string; secret: string; body: string }): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature({ secret: params.secret, timestamp, body: params.body });
  return {
    [KEY_ID_HEADER]: params.keyId,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signature,
    'Content-Type': 'application/json',
  };
}
