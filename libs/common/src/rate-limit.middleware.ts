import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { createHash } from 'crypto';

const client = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
const policies = [
  { prefix: '/api/auth', limit: 5, windowMs: 60_000 },
  { prefix: '/api/', limit: 100, windowMs: 60_000 },
];
const identity = (request: Request) => {
  const key = request.header('x-api-key') ?? request.header('authorization') ?? request.ip;
  return createHash('sha256').update(key).digest('hex');
};

/** Atomic Redis fixed-window limiter. Health and metrics are intentionally excluded. */
export async function rateLimit(request: Request, response: Response, next: NextFunction) {
  if (request.path === '/api/health' || request.path === '/api/health/ready' || request.path === '/api/metrics') return next();
  const policy = policies.find((candidate) => request.path.startsWith(candidate.prefix));
  if (!policy) return next();
  const bucket = Math.floor(Date.now() / policy.windowMs);
  try {
    const key = `rate:${policy.prefix}:${identity(request)}:${bucket}`;
    const count = await client.incr(key);
    if (count === 1) await client.pexpire(key, policy.windowMs);
    const remaining = Math.max(0, policy.limit - count);
    response.setHeader('RateLimit-Limit', policy.limit);
    response.setHeader('RateLimit-Remaining', remaining);
    response.setHeader('RateLimit-Reset', Math.ceil((bucket + 1) * policy.windowMs / 1000));
    if (count > policy.limit) return response.status(429).type('application/problem+json').send({ type: 'https://httpstatuses.com/429', title: 'Too Many Requests', status: 429, detail: 'Rate limit exceeded.', requestId: (request as Request & { requestId?: string }).requestId });
    return next();
  } catch {
    // Authentication endpoints fail closed; normal API traffic remains available during a cache outage.
    if (request.path.startsWith('/api/auth')) return response.status(503).type('application/problem+json').send({ type: 'https://httpstatuses.com/503', title: 'Rate limiter unavailable', status: 503 });
    return next();
  }
}
