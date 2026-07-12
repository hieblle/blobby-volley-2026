/**
 * Keyboard + gamepad input with remappable bindings.
 *
 * All gameplay reads go through `getPlayerInput(slot)` which returns the
 * same shape the AI produces, so humans and bots are interchangeable.
 * Keys are tracked by `KeyboardEvent.code` (layout-independent).
 */

export interface Bindings {
  p1Left: string[];
  p1Right: string[];
  p1Jump: string[];
  p2Left: string[];
  p2Right: string[];
  p2Jump: string[];
}

export const DEFAULT_BINDINGS: Bindings = {
  p1Left: ['KeyA'],
  p1Right: ['KeyD'],
  p1Jump: ['KeyW', 'Space'],
  p2Left: ['ArrowLeft'],
  p2Right: ['ArrowRight'],
  p2Jump: ['ArrowUp'],
};

export type BindingAction = keyof Bindings;

export const BINDING_LABELS: Record<BindingAction, string> = {
  p1Left: 'Player 1 — Move Left',
  p1Right: 'Player 1 — Move Right',
  p1Jump: 'Player 1 — Jump',
  p2Left: 'Player 2 — Move Left',
  p2Right: 'Player 2 — Move Right',
  p2Jump: 'Player 2 — Jump',
};

/** Codes the game consumes; their browser default is suppressed in play. */
const SWALLOWED = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab',
]);

export class InputSystem {
  bindings: Bindings;
  private down = new Set<string>();
  /** Set while a menu capture is waiting for the next key. */
  captureCallback: ((code: string) => void) | null = null;
  /** When true (during active play) we preventDefault on game keys. */
  swallowKeys = false;
  onPause: (() => void) | null = null;
  onDebugToggle: (() => void) | null = null;
  onAnyKey: (() => void) | null = null;

  constructor(bindings: Bindings) {
    this.bindings = bindings;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.clearAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAll();
    });
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.captureCallback) {
      e.preventDefault();
      if (e.code !== 'Escape') {
        const cb = this.captureCallback;
        this.captureCallback = null;
        cb(e.code);
      } else {
        this.captureCallback = null;
      }
      return;
    }
    if (e.code === 'Escape') {
      this.onPause?.();
      return;
    }
    if (e.code === 'Backquote') {
      this.onDebugToggle?.();
      return;
    }
    if (this.swallowKeys && (SWALLOWED.has(e.code) || this.isBound(e.code))) {
      e.preventDefault();
    }
    if (!e.repeat) this.onAnyKey?.();
    this.down.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private clearAll = (): void => {
    this.down.clear();
  };

  private isBound(code: string): boolean {
    for (const keys of Object.values(this.bindings)) {
      if (keys.includes(code)) return true;
    }
    return false;
  }

  private anyDown(codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Poll connected gamepads. Pad 0 drives slot 0, pad 1 drives slot 1. */
  private padInput(slot: 0 | 1): { left: boolean; right: boolean; jump: boolean } {
    const out = { left: false, right: false, jump: false };
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads[slot];
    if (!pad || !pad.connected) return out;
    const ax = pad.axes[0] ?? 0;
    out.left = ax < -0.35 || !!pad.buttons[14]?.pressed;
    out.right = ax > 0.35 || !!pad.buttons[15]?.pressed;
    out.jump = !!pad.buttons[0]?.pressed || !!pad.buttons[12]?.pressed;
    return out;
  }

  getPlayerInput(slot: 0 | 1): { left: boolean; right: boolean; jump: boolean } {
    const b = this.bindings;
    const kb = slot === 0
      ? {
          left: this.anyDown(b.p1Left),
          right: this.anyDown(b.p1Right),
          jump: this.anyDown(b.p1Jump),
        }
      : {
          left: this.anyDown(b.p2Left),
          right: this.anyDown(b.p2Right),
          jump: this.anyDown(b.p2Jump),
        };
    const pad = this.padInput(slot);
    return {
      left: kb.left || pad.left,
      right: kb.right || pad.right,
      jump: kb.jump || pad.jump,
    };
  }

  /** Begin listening for a single key press to rebind an action. */
  capture(action: BindingAction, done: () => void): void {
    this.captureCallback = (code) => {
      // A key may only serve one action — strip it everywhere else first.
      for (const a of Object.keys(this.bindings) as BindingAction[]) {
        this.bindings[a] = this.bindings[a].filter((c) => c !== code);
      }
      this.bindings[action] = [code];
      done();
    };
  }
}
