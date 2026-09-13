import Redis from 'ioredis';

/** Cache-aside helper. Invalidate via domain events after writes. */
export async function cacheAside<T>(redis: Redis, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as T;
  const value = await load(); await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); return value;
}
