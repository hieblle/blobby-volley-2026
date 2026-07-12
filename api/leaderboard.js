/**
 * Vercel serverless function: global Survival leaderboard.
 *
 * Storage: Upstash Redis (add it in Vercel → Storage → Upstash for Redis;
 * the integration injects the env vars used below). A sorted set keeps one
 * entry per name, and ZADD GT ensures only improvements are stored.
 *
 *   GET  /api/leaderboard          → { entries: [{ name, score }] } (top 20)
 *   POST /api/leaderboard          → body { name, score }, returns updated top
 */

const KEY = 'bounce:survival:v1';
const TOP_N = 20;
const MAX_SCORE = 500;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cfg, command) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

/** Displayable name: letters/digits/space/_-. only, ≤16 chars. */
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return name.length >= 2 ? name : null;
}

async function topEntries(cfg) {
  const flat = await redis(cfg, ['ZRANGE', KEY, '0', String(TOP_N - 1), 'REV', 'WITHSCORES']);
  const entries = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    entries.push({ name: flat[i], score: Math.round(Number(flat[i + 1])) });
  }
  return entries;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = redisConfig();
  if (!cfg) {
    res.status(503).json({
      error: 'Leaderboard storage is not configured. Add "Upstash for Redis" to this Vercel project (Storage tab).',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json({ entries: await topEntries(cfg) });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const name = sanitizeName(body.name);
      const score = Math.floor(Number(body.score));
      if (!name) {
        res.status(400).json({ error: 'Name must be 2–16 printable characters.' });
        return;
      }
      if (!Number.isFinite(score) || score < 1 || score > MAX_SCORE) {
        res.status(400).json({ error: 'Score out of range.' });
        return;
      }
      // GT: only ever raise a player's best score.
      await redis(cfg, ['ZADD', KEY, 'GT', String(score), name]);
      const entries = await topEntries(cfg);
      const rank = await redis(cfg, ['ZREVRANK', KEY, name]);
      res.status(200).json({ ok: true, entries, rank: rank === null ? null : rank + 1 });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(502).json({ error: 'Leaderboard storage unreachable.' });
  }
}
