// Simpele token-bucket rate limiter. KvK hanteert 100 requests/minuut
// voor Dataservice-abonnementen, en spreads requests om 429's te
// voorkomen. We mikken conservatief op 80 rpm zodat pieken niet tegen
// de harde limiet lopen.

type Bucket = {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerSecond: number;
};

const DEFAULT_RPM = 80;

const buckets = new Map<string, Bucket>();

function getBucket(key: string, rpm = DEFAULT_RPM): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      tokens: rpm,
      capacity: rpm,
      refillPerSecond: rpm / 60,
      lastRefill: Date.now(),
    };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket): void {
  const now = Date.now();
  const deltaSec = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + deltaSec * b.refillPerSecond);
  b.lastRefill = now;
}

// Wait until a token is available, then consume it. Returns once the
// caller may safely issue the request.
export async function acquireToken(
  key: string,
  opts: { rpm?: number; maxWaitMs?: number } = {},
): Promise<void> {
  const b = getBucket(key, opts.rpm);
  const maxWait = opts.maxWaitMs ?? 30_000;
  const start = Date.now();

  while (true) {
    refill(b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    if (Date.now() - start > maxWait) {
      throw new Error(
        `rate-limiter timeout voor ${key} na ${maxWait}ms wachten`,
      );
    }
    // Wait just long enough for one token to refill.
    const waitMs = Math.ceil((1 - b.tokens) / b.refillPerSecond * 1000);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 1_000)));
  }
}
