/**
 * Developer debug panel (toggle with backquote `). Hidden by default and
 * entirely inert during ordinary play.
 */

export interface DebugInfo {
  fps: number;
  fixedDt: number;
  phase: string;
  ballV: [number, number];
  ballPos: [number, number];
  aiIntent: string;
  aiTarget: number;
  timeScale: number;
}

export class DebugPanel {
  visible = false;
  onResetRally: (() => void) | null = null;
  onSlowMo: ((on: boolean) => void) | null = null;
  private el: HTMLElement;
  private text: HTMLElement;
  private slowMo = false;
  private fpsEma = 60;

  constructor() {
    this.el = document.getElementById('debug-panel')!;
    this.text = document.createElement('div');
    this.el.appendChild(this.text);
    const controls = document.createElement('div');
    const mkBtn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      controls.appendChild(b);
    };
    mkBtn('Reset rally', () => this.onResetRally?.());
    mkBtn('Slow-mo', () => {
      this.slowMo = !this.slowMo;
      this.onSlowMo?.(this.slowMo);
    });
    this.el.appendChild(controls);
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.el.classList.toggle('visible', this.visible);
    return this.visible;
  }

  update(info: DebugInfo, frameDt: number): void {
    if (!this.visible) return;
    if (frameDt > 0) this.fpsEma += (1 / frameDt - this.fpsEma) * 0.05;
    this.text.textContent = [
      `fps        ${this.fpsEma.toFixed(0)}`,
      `fixed dt   ${(info.fixedDt * 1000).toFixed(2)} ms (${(1 / info.fixedDt).toFixed(0)} Hz)`,
      `time scale ${info.timeScale.toFixed(2)}`,
      `phase      ${info.phase}`,
      `ball pos   ${info.ballPos[0].toFixed(2)}, ${info.ballPos[1].toFixed(2)}`,
      `ball vel   ${info.ballV[0].toFixed(2)}, ${info.ballV[1].toFixed(2)} (${Math.hypot(...info.ballV).toFixed(1)})`,
      `ai intent  ${info.aiIntent}`,
      `ai target  ${info.aiTarget.toFixed(2)}`,
    ].join('\n');
  }
}
