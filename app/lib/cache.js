const { createClient } = require('redis');

const ENABLED = process.env.USE_CACHE !== '0';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  disableOfflineQueue: true,
  socket: { connectTimeout: 500, reconnectStrategy: (attempt) => Math.min(attempt * 200, 2000) },
});
client.on('error', () => {});
if (ENABLED) client.connect().catch(() => {});

function stopwatch() {
  const started = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - started) / 1e6;
}

async function cached(key, ttl, load, { bypass = false } = {}) {
  const elapsed = stopwatch();
  let status = ENABLED && !bypass ? 'MISS' : 'OFF';

  if (status === 'MISS') {
    try {
      const hit = await client.get(key);
      if (hit !== null) {
        const ms = elapsed();
        return { value: JSON.parse(hit), status: 'HIT', ms, key, expiresIn: await client.ttl(key).catch(() => null) };
      }
    } catch {
      status = 'BYPASS';
    }
  }

  const value = await load();
  const ms = elapsed();

  if (status === 'MISS') {
    try {
      await client.set(key, JSON.stringify(value), { EX: ttl });
    } catch {
      status = 'BYPASS';
    }
  }

  return { value, status, ms, key, expiresIn: status === 'MISS' ? ttl : null };
}

async function healthy() {
  if (!ENABLED) return 'off';
  try {
    return (await client.ping()) === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

module.exports = { cached, healthy, ENABLED };
