import { createHash } from 'crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';

export const idempotencyKey = (value: string) => createHash('sha256').update(value).digest('hex');
export const requestFingerprint = (method: string, route: string, body: unknown) => idempotencyKey(`${method}:${route}:${JSON.stringify(body)}`);

/** Locks and replays a completed request inside the same transaction as the domain write. */
export async function beginIdempotent<T>(client: PoolClient, key: string | undefined, fingerprint: string): Promise<T | undefined> {
  if (!key || key.length < 16 || key.length > 255) throw new BadRequestException('A 16–255 character Idempotency-Key is required.');
  const created = await client.query('INSERT INTO idempotency_keys (key, fingerprint) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [key, fingerprint]);
  if (created.rowCount) return undefined;
  const existing = await client.query<{ fingerprint: string; response: T | null }>('SELECT fingerprint, response FROM idempotency_keys WHERE key = $1 FOR UPDATE', [key]);
  if (existing.rows[0].fingerprint !== fingerprint) throw new ConflictException('Idempotency-Key was already used for a different request.');
  if (existing.rows[0].response === null) throw new ConflictException('Request is already being processed.');
  return existing.rows[0].response;
}

export async function completeIdempotent<T>(client: PoolClient, key: string, response: T) {
  await client.query('UPDATE idempotency_keys SET response = $2, completed_at = NOW() WHERE key = $1', [key, response]);
}
