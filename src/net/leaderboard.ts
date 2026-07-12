/**
 * Client for the global Survival leaderboard (/api/leaderboard, a Vercel
 * serverless function backed by Upstash Redis). Everything degrades
 * gracefully: without the backend (local dev, static hosting) calls
 * resolve to null and the UI shows an "unreachable" note — the game
 * itself never depends on the network.
 */

export interface LeaderboardEntry {
  name: string;
  score: number;
}

export interface SubmitResult {
  entries: LeaderboardEntry[];
  rank: number | null;
}

const API = 'api/leaderboard';
const TIMEOUT_MS = 5000;

async function call(init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(API, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[] | null> {
  const res = await call();
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { entries?: LeaderboardEntry[] };
    return Array.isArray(data.entries) ? data.entries : null;
  } catch {
    return null;
  }
}

export async function submitScore(name: string, score: number): Promise<SubmitResult | null> {
  const res = await call({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score }),
  });
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { entries?: LeaderboardEntry[]; rank?: number | null };
    return { entries: data.entries ?? [], rank: data.rank ?? null };
  } catch {
    return null;
  }
}
