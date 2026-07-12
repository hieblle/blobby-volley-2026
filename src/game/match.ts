/**
 * Match state machine: serve → rally → point freeze → celebrate → reset.
 * Rally scoring; the point winner serves next. Handles the touch limit,
 * win-by-two, the hard score cap, and per-match statistics.
 */

import { RULES, STATS } from '../config';
import { PhysicsEvent, World, resetPlayer } from '../physics/world';

export type MatchPhase = 'countdown' | 'serving' | 'rally' | 'freeze' | 'celebrate' | 'over';

export interface MatchConfig {
  targetScore: number;
  winByTwo: boolean;
}

export interface MatchStats {
  longestRally: number; // touches
  fastestShot: number; // cu/s
  saves: [number, number];
  totalRallies: number;
}

export interface MatchCallbacks {
  onPoint?: (scorer: 0 | 1, landX: number, faultType: 'ground' | 'touches') => void;
  onServeStart?: (server: 0 | 1) => void;
  onMatchOver?: (winner: 0 | 1) => void;
  onTouch?: (side: 0 | 1, touches: number) => void;
}

export class Match {
  world: World;
  config: MatchConfig;
  cb: MatchCallbacks;

  phase: MatchPhase = 'countdown';
  score: [number, number] = [0, 0];
  server: 0 | 1 = 0;
  winner: 0 | 1 | null = null;
  /** Consecutive touches by the side currently in possession. */
  touches = 0;
  touchSide: 0 | 1 | null = null;
  phaseT = 0;
  /** Where the deciding ball landed (for the impact marker). */
  lastLandX = 0;
  lastScorer: 0 | 1 | null = null;

  rallyTouches = 0;
  stats: MatchStats = { longestRally: 0, fastestShot: 0, saves: [0, 0], totalRallies: 0 };

  constructor(world: World, config: MatchConfig, cb: MatchCallbacks = {}) {
    this.world = world;
    this.config = config;
    this.cb = cb;
    this.beginServe(this.server, true);
  }

  isMatchPoint(): 0 | 1 | null {
    for (const side of [0, 1] as const) {
      const s = this.score[side];
      const o = this.score[1 - side];
      const target = this.config.targetScore;
      const reached =
        (s >= target - 1 && (!this.config.winByTwo || s - o >= 1)) || s === RULES.hardCap - 1;
      if (reached && this.phase !== 'over') return side;
    }
    return null;
  }

  private hasWon(side: 0 | 1): boolean {
    const s = this.score[side];
    const o = this.score[1 - side];
    if (s >= RULES.hardCap) return true;
    if (s < this.config.targetScore) return false;
    return this.config.winByTwo ? s - o >= 2 : true;
  }

  beginServe(server: 0 | 1, resetPlayers: boolean): void {
    this.server = server;
    this.phase = 'countdown';
    this.phaseT = RULES.serveCountdown;
    this.touches = 0;
    this.touchSide = null;
    this.rallyTouches = 0;
    if (resetPlayers) {
      resetPlayer(this.world.players[0]);
      resetPlayer(this.world.players[1]);
    }
    const b = this.world.ball;
    b.x = server === 0 ? -RULES.serveOffsetX : RULES.serveOffsetX;
    b.y = RULES.serveDropHeight;
    b.prevX = b.x;
    b.prevY = b.y;
    b.vx = 0;
    b.vy = 0;
    b.spin = 0;
    b.state = 'held';
    this.cb.onServeStart?.(server);
  }

  /** Advance match logic one fixed step; call after world.step(). */
  update(dt: number): void {
    switch (this.phase) {
      case 'countdown':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.world.ball.state = 'live';
          this.phase = 'serving';
        }
        break;
      case 'serving':
      case 'rally':
        this.processEvents();
        break;
      case 'freeze':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.phase = 'celebrate';
          this.phaseT = RULES.pointResetDelay;
        }
        break;
      case 'celebrate':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.lastScorer !== null && this.hasWon(this.lastScorer)) {
            this.winner = this.lastScorer;
            this.phase = 'over';
            this.cb.onMatchOver?.(this.winner);
          } else {
            this.beginServe(this.lastScorer ?? this.server, true);
          }
        }
        break;
      case 'over':
        break;
    }
  }

  /** The sim should freeze bodies during the post-point freeze frames. */
  get simFrozen(): boolean {
    return this.phase === 'freeze';
  }

  private processEvents(): void {
    for (const e of this.world.events) {
      if (e.type === 'playerHit') {
        if (this.phase === 'serving') this.phase = 'rally';
        if (this.touchSide === e.side) {
          this.touches++;
        } else {
          this.touchSide = e.side;
          this.touches = 1;
        }
        this.rallyTouches++;
        if (e.speed > this.stats.fastestShot) this.stats.fastestShot = e.speed;
        // Save detection: contacted a fast-dropping ball near the floor.
        const b = this.world.ball;
        if (e.y < STATS.saveHeight && b.vy > 0 && e.speed > STATS.saveFallSpeed) {
          this.stats.saves[e.side]++;
        }
        this.cb.onTouch?.(e.side, this.touches);
        if (this.touches > RULES.maxTouches) {
          this.awardPoint((1 - e.side) as 0 | 1, e.x, 'touches');
          return;
        }
      } else if (e.type === 'ground') {
        this.awardPoint((1 - e.side) as 0 | 1, e.x, 'ground');
        return;
      }
    }
  }

  private awardPoint(scorer: 0 | 1, landX: number, fault: 'ground' | 'touches'): void {
    this.score[scorer]++;
    this.lastScorer = scorer;
    this.lastLandX = landX;
    this.stats.totalRallies++;
    if (this.rallyTouches > this.stats.longestRally) {
      this.stats.longestRally = this.rallyTouches;
    }
    this.world.ball.state = 'dead';
    this.phase = 'freeze';
    this.phaseT = RULES.pointFreeze;
    this.cb.onPoint?.(scorer, landX, fault);
  }
}
