const { createClient } = require('redis');

const ENABLED = process.env.USE_CACHE !== '0';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  disableOfflineQueue: true,
  socket: { connectTimeout: 500, reconnectStrategy: (attempt) => Math.min(attempt * 200, 2000) },
});
client.on('error', () => {});
if (ENABLED) client.connect().catch(() => {});

const own = { hits: 0, misses: 0 };

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
        const expiresIn = await client.ttl(key).catch(() => null);
        if (expiresIn != null) own[expiresIn === -2 ? 'misses' : 'hits'] += 1;
        return { value: JSON.parse(hit), status: 'HIT', ms, key, expiresIn };
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

function infoField(text, name) {
  const match = text.match(new RegExp(`^${name}:(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

async function inspect({ limit = 200 } = {}) {
  const [stats, memory, size] = await Promise.all([client.info('stats'), client.info('memory'), client.dbSize()]);
  const keys = [];
  for await (const batch of client.scanIterator({ MATCH: '*', COUNT: 100 })) {
    keys.push(...[].concat(batch));
    if (keys.length >= limit) break;
  }
  const hits = Math.max(0, Number(infoField(stats, 'keyspace_hits')) - own.hits);
  const misses = Math.max(0, Number(infoField(stats, 'keyspace_misses')) - own.misses);
  const ttls = await Promise.all(keys.slice(0, limit).map((key) => client.ttl(key)));
  for (const ttl of ttls) own[ttl === -2 ? 'misses' : 'hits'] += 1;
  return {
    hits,
    misses,
    hitRatio: hits + misses ? hits / (hits + misses) : null,
    evicted: Number(infoField(stats, 'evicted_keys')),
    keyCount: size,
    memory: infoField(memory, 'used_memory_human'),
    keys: keys.slice(0, limit).map((key, i) => ({ key, ttl: ttls[i] })).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

async function clear() {
  await client.flushDb();
  await client.configResetStat();
  Object.assign(own, { hits: 0, misses: 0 });
}

module.exports = { cached, healthy, inspect, clear, ENABLED };
