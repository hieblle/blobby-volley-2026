/**
 * Bounce Court AI.
 *
 * The AI is a virtual player: it emits the exact same {left,right,jump}
 * input a human produces and controls a character with identical stats.
 * It never reads human input, never mutates physics, and only "sees" the
 * public ball/player state plus trajectory samples obtained through the
 * same simulation rules as the real ball (simulateBall).
 *
 * Decision structure:
 *   perceive  — track trajectory-change events with a reaction delay
 *   predict   — simulate the ball, estimate landing + interception windows
 *   decide    — pick an intention (defend / attack / serve / hold center)
 *   act       — steer toward a contact offset, time jumps
 *
 * Difficulty comes exclusively from the AiParams knobs (reaction delay,
 * prediction error, aggression, ...) in config.ts.
 */

import { AiParams, BALL, COURT, PLAYER, RULES } from '../config';
import { BallSample, PlayerInput, World, simulateBall } from '../physics/world';
import { clamp, gaussian, makeRng } from '../util/math';

export type AiIntention =
  | 'holdCenter'
  | 'defend'
  | 'moveUnder'
  | 'attack'
  | 'serve'
  | 'safeReturn';

export class AiController {
  params: AiParams;
  private side: 0 | 1;
  private rng: () => number;

  // Perception
  private lastBallVx = 0;
  private lastBallVy = 0;
  private reactT = 0;
  private volleyError = 0;

  // Planning
  private decisionT = 0;
  intention: AiIntention = 'holdCenter';
  targetX = 0;
  private jumpHoldT = 0;
  private wantJump = false;
  private planContactT = 0;
  /** Tendency memory: where the opponent has been standing lately (0..1
   *  toward the wall). Used by 'rival' to target open space. */
  private oppNearNet = 0.5;

  constructor(side: 0 | 1, params: AiParams, seed = 1337) {
    this.side = side;
    this.params = params;
    this.rng = makeRng(seed + side * 7919);
    this.targetX = this.homeX();
    this.rollError();
  }

  private homeX(): number {
    return this.side === 0 ? -COURT.halfWidth * 0.48 : COURT.halfWidth * 0.48;
  }

  /** +1 when this AI attacks to the right, -1 to the left. */
  private dir(): number {
    return this.side === 0 ? 1 : -1;
  }

  private onMySide(x: number): boolean {
    return this.side === 0 ? x < 0 : x > 0;
  }

  private rollError(): void {
    this.volleyError = gaussian(this.rng) * this.params.predictionError;
  }

  update(world: World, dt: number): PlayerInput {
    const me = world.players[this.side];
    const opp = world.players[1 - this.side];
    const b = world.ball;
    const p = this.params;

    // --- perceive: detect trajectory changes (any hit/bounce) ------------
    const dvx = Math.abs(b.vx - this.lastBallVx);
    const dvy = Math.abs(b.vy - this.lastBallVy);
    // Gravity changes vy smoothly; a discontinuity marks a collision.
    if (dvx > 0.5 || dvy > 2.5) {
      this.reactT = p.reactionDelay;
      this.rollError();
    }
    this.lastBallVx = b.vx;
    // predict what gravity alone would do so free flight isn't a "change"
    this.lastBallVy = b.vy - BALL.gravity * dt;
    this.lastBallVy = b.vy;

    if (this.reactT > 0) this.reactT -= dt;

    // Track opponent tendencies (slow EMA of court position).
    const oppDepth = clamp(Math.abs(opp.x) / COURT.halfWidth, 0, 1);
    this.oppNearNet += (1 - oppDepth - this.oppNearNet) * 0.15 * dt;

    // --- decide ------------------------------------------------------------
    this.decisionT -= dt;
    if (this.decisionT <= 0 && this.reactT <= 0) {
      this.decisionT = p.decisionCooldown;
      this.plan(world);
      this.targetX = this.clampToMyHalf(this.targetX);
    }

    // --- act ---------------------------------------------------------------
    const out: PlayerInput = { left: false, right: false, jump: false };
    const dx = this.targetX - me.x;
    if (Math.abs(dx) > p.moveThreshold * 0.35) {
      if (dx > 0) out.right = true;
      else out.left = true;
    }

    if (this.wantJump) {
      this.wantJump = false;
      this.jumpHoldT = 0.32;
    }
    if (this.jumpHoldT > 0) {
      this.jumpHoldT -= dt;
      out.jump = true;
    }

    this.planContactT -= dt;
    return out;
  }

  private plan(world: World): void {
    const me = world.players[this.side];
    const b = world.ball;
    const p = this.params;
    const dir = this.dir();

    // Serve: ball hovering (or newly dropped) above our side.
    if (b.state === 'held' && this.onMySide(b.x)) {
      this.intention = 'serve';
      // Position for the serve angle: bigger offset = flatter serve.
      const aggressive = this.rng() < p.aggression;
      const offset = aggressive ? 0.62 : 0.34;
      this.targetX = b.x - dir * offset;
      return;
    }
    if (b.state !== 'live') {
      this.intention = 'holdCenter';
      this.targetX = this.homeX();
      return;
    }

    // Predict the ball with the shared simulation.
    const { samples, landing } = simulateBall(b.x, b.y, b.vx, b.vy, p.foresight, 3);

    // Where will it land? (with per-volley controlled error)
    const landX = landing ? landing.x + this.volleyError : b.x + this.volleyError;
    const landsOnMe = this.onMySide(landX);

    if (!landsOnMe && !this.onMySide(b.x)) {
      // Ball is the opponent's problem — recover toward a smart depth.
      this.intention = 'holdCenter';
      this.targetX = this.homeX();
      return;
    }

    // Find an interception sample: earliest point on my side at a good
    // contact height that I can actually reach in time.
    const reach = PLAYER.radius + BALL.radius;
    let contact: BallSample | null = null;
    let jumpContact: BallSample | null = null;
    for (const s of samples) {
      if (!this.onMySide(s.x)) continue;
      const travel = Math.abs(s.x - me.x) / PLAYER.maxSpeed;
      if (travel > s.t + 0.06) continue; // unreachable in time
      // Grounded contact: ball touchable while standing (center ~r).
      if (!contact && s.y <= PLAYER.radius + reach + 0.15 && s.y > BALL.radius + 0.05 && s.vy < 0) {
        contact = s;
      }
      // Jump contact: ball in the spike window (above net height).
      if (!jumpContact && s.vy < 1 && s.y > COURT.netHeight - 0.2 && s.y < COURT.netHeight + 2.4) {
        jumpContact = s;
      }
      if (contact && jumpContact) break;
    }

    const wantsAttack = this.rng() < p.aggression;

    // Aggressive aerial attack: meet the ball above the net and drive it
    // into open space. Only commit when the interception is actually
    // makeable — a whiffed jump usually loses the point outright.
    if (jumpContact && wantsAttack && this.rng() < p.jumpiness) {
      const rise = this.riseTimeTo(jumpContact.y - reach * 0.55);
      const err = (1 - p.placementSkill) * gaussian(this.rng) * 0.4;
      const deep = this.rng() < (p.targeting > 0 ? this.oppNearNet * p.targeting + 0.3 : 0.5);
      // Higher targeting skill widens the deep/short split, making attacks
      // harder to read and reach.
      const offset = deep ? 0.5 + p.targeting * 0.18 : 0.42 - p.targeting * 0.1;
      const tx = jumpContact.x - dir * (offset + err);
      const travelT = Math.abs(tx - me.x) / PLAYER.maxSpeed;
      const canPosition = rise !== null && travelT + rise <= jumpContact.t + 0.08;
      if (canPosition) {
        this.intention = 'attack';
        this.targetX = tx;
        // Trigger the jump only when in place and the timing window is now.
        const inPlace = Math.abs(tx - me.x) < 0.55;
        if (
          inPlace && me.grounded && rise !== null &&
          jumpContact.t <= rise + 0.08 && jumpContact.t >= rise - 0.1
        ) {
          this.wantJump = true;
        }
        this.planContactT = jumpContact.t;
        return;
      }
      // Not makeable — fall through to a grounded plan instead of whiffing.
    }

    if (contact) {
      // Grounded return. Choose shot shape by intention, but never chase a
      // contact spot we can't reach before the ball does.
      const err = (1 - p.placementSkill) * gaussian(this.rng) * 0.6;
      const attackTx = contact.x - dir * (0.52 + err);
      const safeTx = contact.x - dir * (0.3 + err);
      const reachable = (tx: number) =>
        Math.abs(tx - me.x) / PLAYER.maxSpeed <= contact!.t + 0.05;
      if (wantsAttack && Math.abs(contact.x) < COURT.halfWidth * 0.75 && reachable(attackTx)) {
        this.intention = 'attack';
        this.targetX = attackTx;
      } else {
        this.intention = 'safeReturn';
        this.targetX = safeTx;
      }
      this.planContactT = contact.t;
      return;
    }

    if (landsOnMe) {
      // Can't compute a clean contact — sprint under the landing point.
      this.intention = landing && landing.t < 0.65 ? 'defend' : 'moveUnder';
      this.targetX = landX - dir * 0.28;
      // Emergency leap: only when the ball is genuinely jump-reachable,
      // nearly overhead, and about to drop past us. A bad panic jump loses
      // the point, so the bar is high.
      const timeToFloor = landing ? landing.t : 99;
      if (
        me.grounded &&
        b.vy < -4 &&
        b.y > 2.4 && b.y < 4.6 &&
        Math.abs(b.x - me.x) < 0.9 &&
        timeToFloor < 0.42 &&
        this.rng() < p.jumpiness
      ) {
        this.wantJump = true;
      }
      return;
    }

    this.intention = 'holdCenter';
    this.targetX = this.homeX();
  }

  /** Time for a full jump to raise the body center to height h (or null). */
  private riseTimeTo(h: number): number | null {
    const v = PLAYER.jumpImpulse;
    const g = PLAYER.gravity;
    const dy = h - PLAYER.radius;
    if (dy <= 0) return 0;
    const disc = v * v - 2 * g * dy;
    if (disc < 0) return null; // can't jump that high
    return (v - Math.sqrt(disc)) / g;
  }

  /** Clamp a target to the AI's own half, away from walls/net. */
  private clampToMyHalf(x: number): number {
    const inner = COURT.netHalfWidth + PLAYER.radius + 0.15;
    const outer = COURT.halfWidth - PLAYER.radius - 0.1;
    return this.side === 0 ? clamp(x, -outer, -inner) : clamp(x, inner, outer);
  }
}
