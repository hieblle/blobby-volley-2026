/**
 * Deterministic 2D physics for Bounce Court.
 *
 * Everything gameplay-relevant happens on the x/y plane. The world is
 * stepped at a fixed dt (SIM.dt); at 120 Hz the fastest legal ball moves
 * well under one ball radius per step, so discrete stepping plus
 * separation correction cannot tunnel. The net top is a capsule cap so
 * balls roll off it smoothly instead of jittering.
 */

import { BALL, COURT, HIT, PLAYER, SIM } from '../config';
import { clamp, len, sign } from '../util/math';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface PlayerBody {
  /** 0 = left court, 1 = right court. */
  side: 0 | 1;
  x: number;
  y: number; // center height; grounded when y === PLAYER.radius
  vx: number;
  vy: number;
  grounded: boolean;
  prevX: number;
  prevY: number;
  jumpBufferT: number;
  coyoteT: number;
  jumpHeld: boolean;
  /** True while the ball overlaps this body (re-hit lockout). */
  touchingBall: boolean;
}

export interface BallBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  /** Visual spin (rad/s), driven by tangential contact slip. */
  spin: number;
  angle: number;
  /** 'held' = hovering pre-serve, 'live' = in play, 'dead' = decorative. */
  state: 'held' | 'live' | 'dead';
}

export type PhysicsEvent =
  | { type: 'playerHit'; side: 0 | 1; speed: number; x: number; y: number }
  | { type: 'net'; speed: number; x: number; y: number }
  | { type: 'wall'; speed: number; x: number; y: number }
  | { type: 'ground'; speed: number; x: number; side: 0 | 1 }
  | { type: 'jump'; side: 0 | 1 }
  | { type: 'land'; side: 0 | 1; impact: number };

export function createPlayer(side: 0 | 1): PlayerBody {
  const x = side === 0 ? -6 : 6;
  return {
    side,
    x,
    y: PLAYER.radius,
    vx: 0,
    vy: 0,
    grounded: true,
    prevX: x,
    prevY: PLAYER.radius,
    jumpBufferT: 0,
    coyoteT: 0,
    jumpHeld: false,
    touchingBall: false,
  };
}

export function createBall(): BallBody {
  return {
    x: 0,
    y: 6,
    vx: 0,
    vy: 0,
    prevX: 0,
    prevY: 6,
    spin: 0,
    angle: 0,
    state: 'dead',
  };
}

export function resetPlayer(p: PlayerBody): void {
  p.x = p.side === 0 ? -6 : 6;
  p.y = PLAYER.radius;
  p.vx = 0;
  p.vy = 0;
  p.grounded = true;
  p.prevX = p.x;
  p.prevY = p.y;
  p.jumpBufferT = 0;
  p.coyoteT = 0;
  p.touchingBall = false;
}

export class World {
  players: [PlayerBody, PlayerBody] = [createPlayer(0), createPlayer(1)];
  ball: BallBody = createBall();
  events: PhysicsEvent[] = [];

  /** Advance one fixed step. `inputs` are per-player virtual controls. */
  step(inputs: [PlayerInput, PlayerInput]): void {
    this.events.length = 0;
    const dt = SIM.dt;
    this.stepPlayer(this.players[0], inputs[0], dt);
    this.stepPlayer(this.players[1], inputs[1], dt);
    this.stepBall(dt);
  }

  private stepPlayer(p: PlayerBody, input: PlayerInput, dt: number): void {
    p.prevX = p.x;
    p.prevY = p.y;

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const accel = p.grounded ? PLAYER.groundAccel : PLAYER.airAccel;

    if (dir !== 0) {
      p.vx += dir * accel * dt;
    } else if (p.grounded) {
      const dec = PLAYER.groundDecel * dt;
      p.vx = Math.abs(p.vx) <= dec ? 0 : p.vx - sign(p.vx) * dec;
    }
    p.vx = clamp(p.vx, -PLAYER.maxSpeed, PLAYER.maxSpeed);

    // Jump buffering + coyote time.
    if (input.jump && !p.jumpHeld) p.jumpBufferT = PLAYER.jumpBuffer;
    p.jumpHeld = input.jump;
    if (p.grounded) p.coyoteT = PLAYER.coyoteTime;
    else p.coyoteT = Math.max(0, p.coyoteT - dt);
    p.jumpBufferT = Math.max(0, p.jumpBufferT - dt);

    if (p.jumpBufferT > 0 && (p.grounded || p.coyoteT > 0)) {
      p.vy = PLAYER.jumpImpulse;
      p.grounded = false;
      p.jumpBufferT = 0;
      p.coyoteT = 0;
      this.events.push({ type: 'jump', side: p.side });
    }

    if (!p.grounded) {
      // Variable jump height: releasing jump while rising cuts the arc.
      const g =
        p.vy > 0 && !input.jump ? PLAYER.gravity * PLAYER.jumpCutMultiplier : PLAYER.gravity;
      p.vy -= g * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Floor.
    if (p.y <= PLAYER.radius) {
      if (!p.grounded && p.vy < -2) {
        this.events.push({ type: 'land', side: p.side, impact: -p.vy });
      }
      p.y = PLAYER.radius;
      p.vy = 0;
      p.grounded = true;
    }

    // Court walls and the net form hard horizontal bounds per side.
    const inner = COURT.netHalfWidth + PLAYER.radius;
    const outer = COURT.halfWidth - PLAYER.radius;
    if (p.side === 0) {
      if (p.x < -outer) { p.x = -outer; p.vx = Math.max(0, p.vx); }
      if (p.x > -inner) { p.x = -inner; p.vx = Math.min(0, p.vx); }
    } else {
      if (p.x > outer) { p.x = outer; p.vx = Math.min(0, p.vx); }
      if (p.x < inner) { p.x = inner; p.vx = Math.max(0, p.vx); }
    }
  }

  private stepBall(dt: number): void {
    const b = this.ball;
    b.prevX = b.x;
    b.prevY = b.y;
    if (b.state === 'held') return;

    b.vy -= BALL.gravity * dt;

    // Global speed clamp — no interaction may add unbounded energy.
    const sp = len(b.vx, b.vy);
    if (sp > BALL.maxSpeed) {
      const k = BALL.maxSpeed / sp;
      b.vx *= k;
      b.vy *= k;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += b.spin * dt;
    b.spin *= 0.999;

    this.collideWalls(b);
    this.collideNet(b);
    if (b.state === 'live') {
      this.collidePlayer(this.players[0], b);
      this.collidePlayer(this.players[1], b);
      // A body push can nudge the ball into a wall/net; re-separate so it
      // never renders (or rests) embedded.
      this.collideWalls(b);
      this.collideNet(b);
    }
    this.collideGround(b);
  }

  private collideWalls(b: BallBody): void {
    const limit = COURT.halfWidth - BALL.radius;
    if (b.x < -limit) {
      b.x = -limit;
      if (b.vx < 0) {
        const speed = Math.abs(b.vx);
        b.vx = -b.vx * BALL.wallRestitution;
        b.spin = -b.vy * BALL.spinFactor;
        if (speed > 1.5) this.events.push({ type: 'wall', speed, x: b.x, y: b.y });
      }
    } else if (b.x > limit) {
      b.x = limit;
      if (b.vx > 0) {
        const speed = Math.abs(b.vx);
        b.vx = -b.vx * BALL.wallRestitution;
        b.spin = b.vy * BALL.spinFactor;
        if (speed > 1.5) this.events.push({ type: 'wall', speed, x: b.x, y: b.y });
      }
    }
    if (b.y > COURT.softCeiling) {
      b.y = COURT.softCeiling;
      if (b.vy > 0) b.vy = 0;
    }
  }

  private collideNet(b: BallBody): void {
    const nw = COURT.netHalfWidth;
    const nh = COURT.netHeight;
    // Closest point on the net segment (a vertical capsule from y=0 to nh).
    const cx = clamp(b.x, -nw, nw);
    const cy = clamp(b.y, 0, nh);
    // For the vertical faces, closest x is the face; capsule treatment:
    let px: number, py: number;
    if (b.y >= nh) {
      // Near the rounded tape at the top.
      px = clamp(b.x, -nw, nw) === b.x ? 0 : clamp(b.x, -nw, nw);
      px = 0; // capsule spine is the segment x=0; use spine for the cap
      py = nh;
    } else {
      px = 0;
      py = cy;
    }
    const coreR = nw; // capsule radius around the spine
    let dx = b.x - px;
    let dy = b.y - py;
    let d = len(dx, dy);
    const minD = coreR + BALL.radius;
    if (d >= minD) return;
    if (d < 1e-6) {
      dx = b.prevX >= 0 ? 1 : -1;
      dy = 0;
      d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    // Push out of the net first (separation correction).
    b.x = px + nx * minD;
    b.y = py + ny * minD;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const speed = -vn;
      // Reflect the normal component, damp the tangential one slightly so
      // the ball can't buzz against the tape forever.
      const tvx = b.vx - vn * nx;
      const tvy = b.vy - vn * ny;
      b.vx = tvx * BALL.netTangentDamping - vn * nx * BALL.netRestitution;
      b.vy = tvy * BALL.netTangentDamping - vn * ny * BALL.netRestitution;
      b.spin = (tvx * ny - tvy * nx) * BALL.spinFactor;
      if (speed > 1.2) this.events.push({ type: 'net', speed, x: b.x, y: b.y });
    }
  }

  private collidePlayer(p: PlayerBody, b: BallBody): void {
    const dxr = b.x - p.x;
    const dyr = b.y - p.y;
    const rSum = PLAYER.radius + BALL.radius;
    const d = len(dxr, dyr);

    if (d >= rSum * HIT.separationFactor) {
      p.touchingBall = false;
      return;
    }
    if (d >= rSum) return; // inside the lockout ring but not overlapping

    const nx = d > 1e-6 ? dxr / d : 0;
    const ny = d > 1e-6 ? dyr / d : 1;

    // Positional correction — never let the ball embed in a body.
    b.x = p.x + nx * rSum;
    b.y = p.y + ny * rSum;

    if (p.touchingBall) {
      // Continuous contact: keep the ball sliding off without re-impulsing.
      const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
      if (vn < 0) {
        b.vx -= vn * nx;
        b.vy -= vn * ny;
      }
      return;
    }
    p.touchingBall = true;

    // Relative velocity split into normal / tangential parts.
    const rvx = b.vx - p.vx;
    const rvy = b.vy - p.vy;
    const vn = rvx * nx + rvy * ny;
    const tvx = rvx - vn * nx;
    const tvy = rvy - vn * ny;

    // Outgoing normal speed: reflected approach + a tuned flat impulse.
    let outN = Math.max(0, -vn) * HIT.restitution + HIT.baseImpulse;
    outN = Math.max(outN, HIT.minNormalSpeed);

    b.vx = p.vx * HIT.momentumTransfer + tvx * HIT.tangentKeep + nx * outN;
    b.vy = p.vy * HIT.momentumTransfer + tvy * HIT.tangentKeep + ny * outN;

    // Visible spin from tangential slip at the contact point.
    b.spin = (tvx * ny - tvy * nx) * BALL.spinFactor;

    const speed = len(b.vx, b.vy);
    if (speed > BALL.maxSpeed) {
      const k = BALL.maxSpeed / speed;
      b.vx *= k;
      b.vy *= k;
    }

    this.events.push({
      type: 'playerHit',
      side: p.side,
      speed: len(b.vx, b.vy),
      x: b.x - nx * BALL.radius,
      y: b.y - ny * BALL.radius,
    });
  }

  private collideGround(b: BallBody): void {
    if (b.y > BALL.radius) return;
    b.y = BALL.radius;
    if (b.vy < 0) {
      const speed = -b.vy;
      if (b.state === 'live') {
        // The rally-deciding touch. Match logic reacts to this event; the
        // ball switches to decorative bouncing.
        this.events.push({ type: 'ground', speed, x: b.x, side: b.x < 0 ? 0 : 1 });
        b.state = 'dead';
      }
      b.vy = speed * BALL.floorRestitution;
      b.vx *= 0.92;
      b.spin = b.vx * BALL.spinFactor * 1.4;
      if (b.vy < 0.8) b.vy = 0;
    }
  }
}

/**
 * Simulate only the ball forward from an arbitrary state. Used by the AI
 * for landing prediction and by training mode for trajectory display.
 * Mirrors stepBall's wall/net/gravity behavior but ignores characters.
 */
export interface BallSample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function simulateBall(
  x: number,
  y: number,
  vx: number,
  vy: number,
  maxTime: number,
  sampleEvery = 2,
): { samples: BallSample[]; landing: BallSample | null } {
  const dt = SIM.dt;
  const steps = Math.ceil(maxTime / dt);
  const samples: BallSample[] = [];
  let landing: BallSample | null = null;
  const nw = COURT.netHalfWidth;
  const nh = COURT.netHeight;

  for (let i = 0; i < steps; i++) {
    vy -= BALL.gravity * dt;
    const sp = len(vx, vy);
    if (sp > BALL.maxSpeed) {
      const k = BALL.maxSpeed / sp;
      vx *= k;
      vy *= k;
    }
    x += vx * dt;
    y += vy * dt;

    const limit = COURT.halfWidth - BALL.radius;
    if (x < -limit) { x = -limit; if (vx < 0) vx = -vx * BALL.wallRestitution; }
    else if (x > limit) { x = limit; if (vx > 0) vx = -vx * BALL.wallRestitution; }
    if (y > COURT.softCeiling) { y = COURT.softCeiling; if (vy > 0) vy = 0; }

    // Net capsule.
    const py = y >= nh ? nh : clamp(y, 0, nh);
    let dx = x - 0;
    let dy = y - py;
    let d = len(dx, dy);
    const minD = nw + BALL.radius;
    if (d < minD) {
      if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
      const nx2 = dx / d;
      const ny2 = dy / d;
      x = nx2 * minD;
      y = py + ny2 * minD;
      const vn = vx * nx2 + vy * ny2;
      if (vn < 0) {
        const tvx = vx - vn * nx2;
        const tvy = vy - vn * ny2;
        vx = tvx - vn * nx2 * BALL.netRestitution;
        vy = tvy - vn * ny2 * BALL.netRestitution;
      }
    }

    const t = (i + 1) * dt;
    if (y <= BALL.radius) {
      landing = { t, x, y: BALL.radius, vx, vy };
      samples.push(landing);
      break;
    }
    if (i % sampleEvery === 0) samples.push({ t, x, y, vx, vy });
  }
  return { samples, landing };
}
