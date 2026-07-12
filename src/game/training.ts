/**
 * Training Lab — scripted exercises on a private court.
 *
 * The human controls the left Bouncer; the right side stays empty (the
 * second body is parked by the far wall as a passive dummy). Each
 * exercise feeds balls with preset trajectories and detects success.
 * Trajectory preview + landing markers are training-only features.
 */

import { BALL, COURT, RULES } from '../config';
import { World, resetPlayer, simulateBall } from '../physics/world';
import { makeRng } from '../util/math';

export interface TrainingState {
  title: string;
  desc: string;
  progressText: string;
  /** Points for the renderer's trajectory preview (null → hidden). */
  trajectory: { x: number; y: number }[] | null;
  landingX: number | null;
  successFlash: boolean;
}

export class TrainingSession {
  world: World;
  id: string;
  private rng = makeRng(42);
  private feedTimer = 1.2;
  private successes = 0;
  private attempts = 0;
  private state: TrainingState;
  private ballWasLive = false;
  private crossedNet = false;
  private lastCrossSpeedY = 0;

  constructor(world: World, id: string, title: string, desc: string) {
    this.world = world;
    this.id = id;
    resetPlayer(world.players[0]);
    resetPlayer(world.players[1]);
    // Park the dummy by the wall so it rarely interferes.
    world.players[1].x = COURT.halfWidth - 1.1;
    world.players[1].prevX = world.players[1].x;
    world.ball.state = 'dead';
    world.ball.y = -10;
    world.ball.prevY = -10;
    this.state = {
      title,
      desc,
      progressText: '',
      trajectory: null,
      landingX: null,
      successFlash: false,
    };
  }

  /** Called every fixed step AFTER world.step(). */
  update(dt: number): TrainingState {
    const b = this.world.ball;
    this.state.successFlash = false;

    // Detect net crossings for attack/serve goals.
    if (b.state === 'live') {
      if (!this.crossedNet && b.prevX < 0 && b.x >= 0) {
        this.crossedNet = true;
        this.lastCrossSpeedY = b.vy;
      }
    }

    // Ball died (hit the ground) → evaluate the attempt.
    if (this.ballWasLive && b.state === 'dead') {
      this.evaluate(b.x);
      this.crossedNet = false;
    }
    this.ballWasLive = b.state === 'live';

    // Feed logic.
    if (b.state === 'dead') {
      this.feedTimer -= dt;
      if (this.feedTimer <= 0) this.feed();
    }

    // Trajectory preview while the ball flies (training-only aid).
    if (b.state === 'live' || b.state === 'held') {
      const sim = simulateBall(b.x, b.y, b.vx, b.vy, 2.6, 4);
      this.state.trajectory = sim.samples;
      this.state.landingX = sim.landing ? sim.landing.x : null;
    } else {
      this.state.trajectory = null;
      this.state.landingX = null;
    }

    this.state.progressText =
      this.id === 'movement' || this.id === 'free'
        ? ''
        : `Success: ${this.successes} / ${this.attempts}`;
    return this.state;
  }

  private launch(x: number, y: number, vx: number, vy: number): void {
    const b = this.world.ball;
    b.x = x; b.y = y; b.prevX = x; b.prevY = y;
    b.vx = vx; b.vy = vy; b.spin = 0;
    b.state = 'live';
  }

  private hold(x: number): void {
    const b = this.world.ball;
    b.x = x;
    b.y = RULES.serveDropHeight;
    b.prevX = x; b.prevY = b.y;
    b.vx = 0; b.vy = 0; b.spin = 0;
    b.state = 'live'; // drops immediately in training
  }

  private feed(): void {
    const r = this.rng;
    this.feedTimer = 1.3;
    switch (this.id) {
      case 'movement':
        this.feedTimer = 3; // no balls — pure movement warm-up
        break;
      case 'jump':
        this.launch(-9 + r() * 7, 12, 0, 0);
        break;
      case 'serve':
      case 'free':
        this.hold(-RULES.serveOffsetX);
        break;
      case 'clears':
        this.launch(10, 3 + r() * 2, -(11 + r() * 5), 2 + r() * 2);
        break;
      case 'angles':
        this.launch(-6 + r() * 4, 11, (r() - 0.5) * 3, 0);
        break;
      case 'attack':
        // A friendly lob to spike: rises near the net on the player side.
        this.launch(-4.5 - r() * 2, 5, 2 + r() * 1.5, 6 + r() * 2);
        break;
      case 'wall':
        this.launch(6, 4.5, -(16 + r() * 5), 3);
        break;
      case 'net':
        this.launch(4, 8, -3.4 - r() * 0.8, 1);
        break;
    }
    if (this.id !== 'movement') this.attempts++;
  }

  private evaluate(landX: number): void {
    // Success = the ball landed on the opponent side (for return drills)
    // with drill-specific extras.
    let ok = landX > 0;
    if (this.id === 'attack') ok = ok && this.crossedNet && this.lastCrossSpeedY < -2;
    if (this.id === 'jump' || this.id === 'angles') ok = landX > 0;
    if (this.id === 'movement' || this.id === 'free') ok = false;
    if (ok) {
      this.successes++;
      this.state.successFlash = true;
    }
    this.feedTimer = 0.9;
  }
}

export const TRAINING_META: Record<string, { hint: string }> = {
  movement: { hint: 'Run wall to net and back. Short hops, full jumps — get a feel for the spring.' },
  jump: { hint: 'Meet the falling ball at the top of your jump and knock it over the net.' },
  serve: { hint: 'The ball drops over you. Position under it to shape your serve across the net.' },
  clears: { hint: 'Balls come in hot. Get under them and pop them high and deep over the net.' },
  angles: { hint: 'Let the ball strike the SIDE of your body to steer it — off-center contact = angle.' },
  attack: { hint: 'Jump into the lob and contact it high, slightly in front — drive it down over the net.' },
  wall: { hint: 'The ball ricochets off your back wall. Read the rebound and save it across.' },
  net: { hint: 'Balls drop just behind the tape. Nudge them up with the net-side of your body.' },
  free: { hint: 'Endless serve feed. Watch the predicted arc and experiment freely.' },
};
