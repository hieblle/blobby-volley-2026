/**
 * Fixed-timestep game loop with render interpolation.
 *
 * The simulation always advances in SIM.dt increments; rendering happens
 * once per animation frame with an interpolation alpha. A cap on the
 * accumulator prevents a huge catch-up burst after the tab was hidden.
 * Only one loop can be running — `start()` while running is a no-op.
 */

import { SIM } from '../config';

export class GameLoop {
  /** Called 0..n times per frame with the fixed dt. */
  onUpdate: (dt: number) => void = () => {};
  /** Called once per frame with interpolation alpha and real frame dt. */
  onRender: (alpha: number, frameDt: number) => void = () => {};

  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  paused = false;
  /** Slow-motion factor for the debug panel (1 = normal). */
  timeScale = 1;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      let frame = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (frame > SIM.maxFrameTime) frame = SIM.maxFrameTime;
      if (!this.paused) {
        this.accumulator += frame * this.timeScale;
        let guard = 0;
        while (this.accumulator >= SIM.dt && guard < 40) {
          this.onUpdate(SIM.dt);
          this.accumulator -= SIM.dt;
          guard++;
        }
      }
      const alpha = this.paused ? 1 : this.accumulator / SIM.dt;
      this.onRender(Math.min(1, alpha), frame);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      // Drop any time that accrued while paused.
      this.lastTime = performance.now();
      this.accumulator = 0;
    }
  }
}
