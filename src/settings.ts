/**
 * Persistent settings + progression (localStorage).
 * Everything is cosmetic/UX — nothing here may alter physics or fairness.
 */

import { Bindings, DEFAULT_BINDINGS } from './input/input';
import { RULES } from './config';

export type Quality = 'low' | 'medium' | 'high';
export type Difficulty = 'relaxed' | 'standard' | 'skilled' | 'rival';
export type ArenaId = 'sunset' | 'neon' | 'garden';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  quality: Quality;
  reducedMotion: boolean;
  ballOutline: boolean;
  highContrastCourt: boolean;
  backgroundAnimation: boolean;
  cameraImpulse: boolean;
  bindings: Bindings;
  // Last used match setup (Quick Match reuses this).
  arena: ArenaId;
  difficulty: Difficulty;
  targetScore: number;
  winByTwo: boolean;
  p1Style: number;
  p2Style: number;
  /** Display name for the global leaderboard (empty = not set yet). */
  playerName: string;
}

export interface Progress {
  matchWins: number;
  bestSurvivalRound: number;
  longestRallyEver: number;
  fastestShotEver: number;
}

const SETTINGS_KEY = 'bounceCourt.settings.v1';
const PROGRESS_KEY = 'bounceCourt.progress.v1';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
  muted: false,
  quality: 'medium',
  reducedMotion: false,
  ballOutline: false,
  highContrastCourt: false,
  backgroundAnimation: true,
  cameraImpulse: true,
  bindings: structuredClone(DEFAULT_BINDINGS),
  arena: 'sunset',
  difficulty: 'standard',
  targetScore: RULES.defaultTarget,
  winByTwo: RULES.winByTwoDefault,
  p1Style: 0,
  p2Style: 1,
  playerName: '',
};

function safeParse<T>(raw: string | null): Partial<T> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const stored = safeParse<Settings>(localStorage.getItem(SETTINGS_KEY));
  const merged: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...stored };
  merged.bindings = { ...structuredClone(DEFAULT_BINDINGS), ...(stored?.bindings ?? {}) };
  return merged;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable (private mode) — play on without persistence */
  }
}

export function loadProgress(): Progress {
  const stored = safeParse<Progress>(localStorage.getItem(PROGRESS_KEY));
  return {
    matchWins: 0,
    bestSurvivalRound: 0,
    longestRallyEver: 0,
    fastestShotEver: 0,
    ...stored,
  };
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Cosmetic styles unlock at these total-match-win counts. */
export const STYLE_UNLOCK_WINS = [0, 0, 1, 3, 5, 8, 12, 18];

export function unlockedStyles(progress: Progress): boolean[] {
  return STYLE_UNLOCK_WINS.map((w) => progress.matchWins >= w);
}
