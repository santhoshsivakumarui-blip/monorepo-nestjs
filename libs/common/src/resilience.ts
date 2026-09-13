export async function withRetry<T>(operation: () => Promise<T>, options = { attempts: 3, baseDelayMs: 100 }): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try { return await operation(); } catch (error) { last = error; await new Promise((r) => setTimeout(r, options.baseDelayMs * 2 ** attempt)); }
  }
  throw last;
}

export async function withTimeout<T>(operation: Promise<T>, timeoutMs = 5000): Promise<T> {
  return Promise.race([operation, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('operation timed out')), timeoutMs))]);
}
