/**
 * DOM interface: menus, HUD, pause, results, settings, training picker.
 * The UI never touches physics — it emits intents through UiCallbacks.
 */

import { RULES } from '../config';
import { BINDING_LABELS, BindingAction, DEFAULT_BINDINGS, InputSystem } from '../input/input';
import { ARENA_INFO } from '../render/arenas';
import { BOUNCER_STYLES } from '../render/styles';
import {
  ArenaId, Difficulty, Progress, Settings, STYLE_UNLOCK_WINS, unlockedStyles,
} from '../settings';
import type { MatchStats } from '../game/match';
import { fetchLeaderboard } from '../net/leaderboard';

export interface MatchSetup {
  mode: 'ai' | 'versus';
  difficulty: Difficulty;
  arena: ArenaId;
  targetScore: number;
  winByTwo: boolean;
  p1Style: number;
  p2Style: number;
}

export interface ResultsData {
  winnerName: string;
  winnerSide: 0 | 1;
  score: [number, number];
  stats: MatchStats;
  mode: 'ai' | 'versus' | 'survival';
  survivalRounds?: number;
}

export interface UiCallbacks {
  onQuickMatch(): void;
  onStartMatch(setup: MatchSetup): void;
  onStartTraining(id: string): void;
  onStartSurvival(): void;
  onResume(): void;
  onRestart(): void;
  onQuitToMenu(): void;
  onRematch(): void;
  onChangeMode(): void;
  onSettingsChanged(): void;
  onMenuSound(kind: 'move' | 'select'): void;
  /** Submit a Survival score (rounds cleared) to the global leaderboard. */
  onSubmitScore(rounds: number): void;
}

export const TRAINING_EXERCISES: { id: string; name: string; desc: string }[] = [
  { id: 'movement', name: 'Basic Movement', desc: 'Warm up: run wall to wall and hop over the marker rings.' },
  { id: 'jump', name: 'Jump Timing', desc: 'Meet the dropped balls at the top of your jump.' },
  { id: 'serve', name: 'Serving', desc: 'Serve into the highlighted target zones across the net.' },
  { id: 'clears', name: 'High Defensive Returns', desc: 'Send incoming balls up and deep — buy yourself time.' },
  { id: 'angles', name: 'Angled Contacts', desc: 'Return feeds using the sides of your body to steer shots.' },
  { id: 'attack', name: 'Fast Attacks', desc: 'Jump and drive lobbed balls down across the net.' },
  { id: 'wall', name: 'Wall Saves', desc: 'Rescue balls rebounding off your back wall.' },
  { id: 'net', name: 'Net Play', desc: 'Handle balls dropping just behind the net tape.' },
  { id: 'free', name: 'Free Practice', desc: 'Endless ball feed with trajectory and landing preview.' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', Enter: 'Enter',
  };
  return map[code] ?? code;
}

type ScreenName =
  | 'title' | 'play' | 'settings' | 'training' | 'pause' | 'results'
  | 'howto' | 'leaderboard' | 'none';

export class UI {
  private root: HTMLElement;
  private screens = new Map<ScreenName, HTMLElement>();
  private cb: UiCallbacks;
  private settings: Settings;
  private progress: Progress;
  private input: InputSystem;

  // HUD elements
  private hud: HTMLElement;
  private scoreboardEl: HTMLElement | null = null;
  private scoreEls: [HTMLElement, HTMLElement];
  private serveDots: [HTMLElement, HTMLElement];
  private nameEls: [HTMLElement, HTMLElement];
  private matchPointEl: HTMLElement;
  private bannerEl: HTMLElement;
  private hintEl: HTMLElement;
  private trainingPanel: HTMLElement;
  private ballMarker!: HTMLElement;
  private bannerTimer = 0;

  // Play screen state
  private setup: MatchSetup;
  private playModeButtons: HTMLButtonElement[] = [];
  private refreshPlayScreen: () => void = () => {};
  private settingsRefreshers: (() => void)[] = [];
  currentScreen: ScreenName = 'title';

  constructor(settings: Settings, progress: Progress, input: InputSystem, cb: UiCallbacks) {
    this.settings = settings;
    this.progress = progress;
    this.input = input;
    this.cb = cb;
    this.setup = {
      mode: 'ai',
      difficulty: settings.difficulty,
      arena: settings.arena,
      targetScore: settings.targetScore,
      winByTwo: settings.winByTwo,
      p1Style: settings.p1Style,
      p2Style: settings.p2Style,
    };

    this.root = document.getElementById('ui')!;
    this.hud = document.getElementById('hud')!;

    // --- HUD skeleton -----------------------------------------------------
    const sb = el('div', 'scoreboard');
    const left = el('div', 'opt-group');
    const right = el('div', 'opt-group');
    const s1 = el('div', 'score p1', '0');
    const s2 = el('div', 'score p2', '0');
    const n1 = el('div', 'names', 'Player 1');
    const n2 = el('div', 'names', 'Player 2');
    const d1 = el('div', 'serve-dot');
    const d2 = el('div', 'serve-dot');
    d1.setAttribute('aria-label', 'Player 1 serving');
    d2.setAttribute('aria-label', 'Player 2 serving');
    left.append(s1, n1);
    right.append(s2, n2);
    sb.append(d1, left, el('div', '', ':'), right, d2);
    this.scoreboardEl = sb;
    this.scoreEls = [s1, s2];
    this.serveDots = [d1, d2];
    this.nameEls = [n1, n2];
    this.matchPointEl = el('div', 'matchpoint', 'MATCH POINT');
    this.bannerEl = el('div', 'banner');
    this.bannerEl.setAttribute('role', 'status');
    this.hintEl = el('div', 'hint-bar');
    this.trainingPanel = el('div', 'training-panel');
    this.trainingPanel.style.display = 'none';
    // Off-screen ball indicator: shows where the ball is while it flies
    // above the visible area.
    this.ballMarker = el('div', 'ball-marker');
    this.ballMarker.setAttribute('aria-hidden', 'true');
    this.ballMarker.append(el('div', 'arrow'), el('div', 'dot'));
    this.hud.append(sb, this.matchPointEl, this.bannerEl, this.hintEl, this.trainingPanel, this.ballMarker);

    this.buildTitle();
    this.buildPlay();
    this.buildSettings();
    this.buildTraining();
    this.buildPause();
    this.buildResults();
    this.buildHowTo();
    this.buildLeaderboard();
    this.show('title');
  }

  // -------------------------------------------------------------------------

  private addScreen(name: ScreenName, node: HTMLElement): void {
    node.classList.add('screen');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', name);
    this.screens.set(name, node);
    this.root.appendChild(node);
  }

  show(name: ScreenName): void {
    this.currentScreen = name;
    for (const [n, s] of this.screens) s.classList.toggle('visible', n === name);
    if (name === 'play') this.refreshPlayScreen();
    if (name === 'settings') for (const r of this.settingsRefreshers) r();
    if (name === 'leaderboard') this.refreshLeaderboard();
  }

  setHudVisible(v: boolean): void {
    this.hud.classList.toggle('visible', v);
  }

  /** Position (screen px) of the above-view ball marker; null hides it. */
  setBallMarker(screenX: number | null): void {
    if (screenX === null) {
      this.ballMarker.classList.remove('visible');
    } else {
      this.ballMarker.classList.add('visible');
      this.ballMarker.style.left = `${screenX.toFixed(0)}px`;
    }
  }

  setScoreboardVisible(v: boolean): void {
    if (this.scoreboardEl) this.scoreboardEl.style.display = v ? 'flex' : 'none';
    if (!v) this.matchPointEl.classList.remove('visible');
  }

  updateScore(s0: number, s1: number, server: 0 | 1 | null, matchPoint: 0 | 1 | null): void {
    this.scoreEls[0].textContent = String(s0);
    this.scoreEls[1].textContent = String(s1);
    this.serveDots[0].classList.toggle('on', server === 0);
    this.serveDots[1].classList.toggle('on', server === 1);
    this.matchPointEl.classList.toggle('visible', matchPoint !== null);
    if (matchPoint !== null) {
      this.matchPointEl.textContent = `MATCH POINT — ${this.nameEls[matchPoint].textContent}`;
    }
  }

  setNames(n0: string, n1: string): void {
    this.nameEls[0].textContent = n0;
    this.nameEls[1].textContent = n1;
  }

  banner(text: string, duration = 1.2): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('visible');
    this.bannerTimer = duration;
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.style.display = text ? 'block' : 'none';
  }

  setTrainingPanel(title: string | null, desc = '', extra = ''): void {
    if (!title) {
      this.trainingPanel.style.display = 'none';
      return;
    }
    this.trainingPanel.style.display = 'block';
    this.trainingPanel.innerHTML = '';
    this.trainingPanel.append(el('h4', '', title), el('div', '', desc));
    if (extra) this.trainingPanel.append(el('div', '', extra));
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('visible');
    }
  }

  // --- screens ---------------------------------------------------------------

  private buildTitle(): void {
    const s = el('section');
    const h = el('h1', 'title', 'BOUNCE COURT');
    const sub = el('div', 'subtitle', 'Three buttons. Bottomless physics.');
    const col = el('div', 'menu-col');
    col.append(
      btn('⚡ Quick Match', 'primary', () => { this.cb.onMenuSound('select'); this.cb.onQuickMatch(); }),
      btn('Play', '', () => { this.cb.onMenuSound('select'); this.show('play'); }),
      btn('Training Lab', '', () => { this.cb.onMenuSound('select'); this.show('training'); }),
      btn('Survival', '', () => { this.cb.onMenuSound('select'); this.cb.onStartSurvival(); }),
      btn('Leaderboard', '', () => { this.cb.onMenuSound('select'); this.show('leaderboard'); }),
      btn('Settings', '', () => { this.cb.onMenuSound('select'); this.show('settings'); }),
      btn('How to Play', '', () => { this.cb.onMenuSound('select'); this.show('howto'); }),
    );
    const wins = el('div', 'subtitle');
    wins.id = 'title-wins';
    s.append(h, sub, col, wins);
    this.addScreen('title', s);
    this.refreshTitle();
  }

  refreshTitle(): void {
    const winsEl = document.getElementById('title-wins');
    if (winsEl) {
      const unlocked = unlockedStyles(this.progress).filter(Boolean).length;
      winsEl.textContent = `Match wins: ${this.progress.matchWins} · Bouncers unlocked: ${unlocked}/${BOUNCER_STYLES.length}`;
    }
  }

  private optionRow<T>(
    label: string,
    options: { value: T; label: string }[],
    get: () => T,
    set: (v: T) => void,
  ): { node: HTMLElement; refresh: () => void } {
    const group = el('div', 'opt-group');
    group.append(el('h3', '', label));
    const row = el('div', 'row');
    const buttons: [HTMLButtonElement, T][] = [];
    for (const o of options) {
      const b = btn(o.label, 'small', () => {
        set(o.value);
        this.cb.onMenuSound('move');
        refresh();
      });
      buttons.push([b, o.value]);
      row.append(b);
    }
    const refresh = () => {
      for (const [b, v] of buttons) b.classList.toggle('selected', v === get());
    };
    refresh();
    group.append(row);
    return { node: group, refresh };
  }

  private styleGrid(
    label: string,
    get: () => number,
    set: (v: number) => void,
  ): { node: HTMLElement; refresh: () => void } {
    const group = el('div', 'opt-group');
    group.append(el('h3', '', label));
    const grid = el('div', 'style-grid');
    const cells: HTMLButtonElement[] = [];
    BOUNCER_STYLES.forEach((st, i) => {
      const cell = el('button', 'style-cell') as HTMLButtonElement;
      cell.title = st.blurb;
      const sw = el('div', 'swatch');
      sw.style.background = `#${st.color.toString(16).padStart(6, '0')}`;
      cell.append(sw, el('div', '', st.name));
      cell.addEventListener('click', () => {
        const unlocked = unlockedStyles(this.progress)[i];
        if (!unlocked) return;
        set(i);
        this.cb.onMenuSound('move');
        refresh();
      });
      cells.push(cell);
      grid.append(cell);
    });
    const refresh = () => {
      const unlocked = unlockedStyles(this.progress);
      cells.forEach((c, i) => {
        c.classList.toggle('selected', get() === i);
        c.classList.toggle('locked', !unlocked[i]);
        const nameEl = c.lastChild as HTMLElement;
        nameEl.textContent = unlocked[i]
          ? BOUNCER_STYLES[i].name
          : `🔒 ${STYLE_UNLOCK_WINS[i]} wins`;
        c.setAttribute('aria-label', unlocked[i]
          ? `Select ${BOUNCER_STYLES[i].name}`
          : `Locked — unlocks after ${STYLE_UNLOCK_WINS[i]} match wins`);
      });
    };
    refresh();
    group.append(grid);
    return { node: group, refresh };
  }

  private buildPlay(): void {
    const s = el('section');
    s.append(el('h2', '', 'Set Up Match'));

    const refreshers: (() => void)[] = [];

    const mode = this.optionRow<'ai' | 'versus'>(
      'Mode',
      [
        { value: 'ai', label: 'Single Player' },
        { value: 'versus', label: 'Local Versus' },
      ],
      () => this.setup.mode,
      (v) => {
        this.setup.mode = v;
        diff.node.style.display = v === 'ai' ? 'flex' : 'none';
      },
    );
    refreshers.push(mode.refresh);

    const diff = this.optionRow<Difficulty>(
      'AI Difficulty',
      [
        { value: 'relaxed', label: 'Relaxed' },
        { value: 'standard', label: 'Standard' },
        { value: 'skilled', label: 'Skilled' },
        { value: 'rival', label: 'Rival' },
      ],
      () => this.setup.difficulty,
      (v) => (this.setup.difficulty = v),
    );
    refreshers.push(diff.refresh);

    const arena = this.optionRow<ArenaId>(
      'Arena',
      ARENA_INFO.map((a) => ({ value: a.id, label: a.name })),
      () => this.setup.arena,
      (v) => (this.setup.arena = v),
    );
    refreshers.push(arena.refresh);

    const pts = this.optionRow<number>(
      'Points to Win',
      RULES.scoreOptions.map((n) => ({ value: n, label: String(n) })),
      () => this.setup.targetScore,
      (v) => (this.setup.targetScore = v),
    );
    refreshers.push(pts.refresh);

    const wb2 = this.optionRow<boolean>(
      'Win by Two',
      [
        { value: true, label: 'On' },
        { value: false, label: 'Off' },
      ],
      () => this.setup.winByTwo,
      (v) => (this.setup.winByTwo = v),
    );
    refreshers.push(wb2.refresh);

    const g1 = this.styleGrid('Player 1 Bouncer', () => this.setup.p1Style, (v) => (this.setup.p1Style = v));
    const g2 = this.styleGrid('Player 2 Bouncer', () => this.setup.p2Style, (v) => (this.setup.p2Style = v));
    refreshers.push(g1.refresh, g2.refresh);

    const chars = el('div', 'row');
    chars.append(g1.node, g2.node);

    const actions = el('div', 'row');
    actions.append(
      btn('Start Match', 'primary', () => {
        this.cb.onMenuSound('select');
        this.persistSetup();
        this.cb.onStartMatch({ ...this.setup });
      }),
      btn('Back', '', () => { this.cb.onMenuSound('select'); this.show('title'); }),
    );

    s.append(mode.node, diff.node, arena.node, pts.node, wb2.node, chars, actions);
    this.addScreen('play', s);
    this.refreshPlayScreen = () => refreshers.forEach((r) => r());
  }

  private persistSetup(): void {
    this.settings.arena = this.setup.arena;
    this.settings.difficulty = this.setup.difficulty;
    this.settings.targetScore = this.setup.targetScore;
    this.settings.winByTwo = this.setup.winByTwo;
    this.settings.p1Style = this.setup.p1Style;
    this.settings.p2Style = this.setup.p2Style;
    this.cb.onSettingsChanged();
  }

  getSetup(): MatchSetup {
    return { ...this.setup };
  }

  private buildSettings(): void {
    const s = el('section');
    s.append(el('h2', '', 'Settings'));

    const tabs = el('div', 'tabs');
    const panels = new Map<string, HTMLElement>();
    const tabBtns = new Map<string, HTMLButtonElement>();
    const showTab = (name: string) => {
      for (const [n, p] of panels) p.style.display = n === name ? 'flex' : 'none';
      for (const [n, b] of tabBtns) b.classList.toggle('selected', n === name);
    };
    for (const name of ['Audio', 'Video', 'Controls', 'Accessibility']) {
      const b = btn(name, '', () => { this.cb.onMenuSound('move'); showTab(name); });
      tabBtns.set(name, b);
      tabs.append(b);
      const p = el('div', 'opt-group');
      p.style.display = 'none';
      p.style.gap = '12px';
      panels.set(name, p);
    }

    // Audio panel.
    const audio = panels.get('Audio')!;
    const slider = (label: string, get: () => number, set: (v: number) => void) => {
      const row = el('label', 'slider-row');
      row.append(el('span', '', label));
      const input = el('input') as HTMLInputElement;
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => {
        set(Number(input.value) / 100);
        this.cb.onSettingsChanged();
      });
      row.append(input);
      this.settingsRefreshers.push(() => { input.value = String(Math.round(get() * 100)); });
      return row;
    };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const row = el('label', 'toggle-row');
      row.append(el('span', '', label));
      const input = el('input') as HTMLInputElement;
      input.type = 'checkbox';
      input.setAttribute('aria-label', label);
      input.addEventListener('change', () => {
        set(input.checked);
        this.cb.onSettingsChanged();
      });
      row.append(input);
      this.settingsRefreshers.push(() => { input.checked = get(); });
      return row;
    };

    audio.append(
      slider('Master Volume', () => this.settings.masterVolume, (v) => (this.settings.masterVolume = v)),
      slider('Music Volume', () => this.settings.musicVolume, (v) => (this.settings.musicVolume = v)),
      slider('Effects Volume', () => this.settings.sfxVolume, (v) => (this.settings.sfxVolume = v)),
      toggle('Mute All', () => this.settings.muted, (v) => (this.settings.muted = v)),
    );

    // Video panel.
    const video = panels.get('Video')!;
    const q = this.optionRow<Settings['quality']>(
      'Visual Quality',
      [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      () => this.settings.quality,
      (v) => {
        this.settings.quality = v;
        this.cb.onSettingsChanged();
      },
    );
    this.settingsRefreshers.push(q.refresh);
    video.append(
      q.node,
      btn('Toggle Fullscreen', '', () => {
        this.cb.onMenuSound('select');
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }),
    );

    // Controls panel.
    const controls = panels.get('Controls')!;
    const bindRows: (() => void)[] = [];
    for (const action of Object.keys(BINDING_LABELS) as BindingAction[]) {
      const row = el('div', 'bind-row');
      row.append(el('span', '', BINDING_LABELS[action]));
      const key = el('span', 'key');
      const rebind = btn('Rebind', 'small', () => {
        key.textContent = 'press a key…';
        this.input.capture(action, () => {
          refreshRow();
          this.cb.onSettingsChanged();
        });
      });
      const refreshRow = () => {
        key.textContent = this.input.bindings[action].map(keyName).join(' / ') || '—';
      };
      bindRows.push(refreshRow);
      refreshRow();
      const right = el('div', 'row');
      right.append(key, rebind);
      row.append(right);
      controls.append(row);
    }
    controls.append(
      btn('Reset to Defaults', 'small', () => {
        this.input.bindings = structuredClone(DEFAULT_BINDINGS);
        this.settings.bindings = this.input.bindings;
        bindRows.forEach((r) => r());
        this.cb.onSettingsChanged();
      }),
      el('div', 'subtitle', 'Gamepads: pad 1 → Player 1, pad 2 → Player 2 (stick/d-pad + A to jump).'),
    );
    this.settingsRefreshers.push(() => bindRows.forEach((r) => r()));

    // Accessibility panel.
    const access = panels.get('Accessibility')!;
    access.append(
      toggle('Reduced Motion', () => this.settings.reducedMotion, (v) => (this.settings.reducedMotion = v)),
      toggle('Ball Outline', () => this.settings.ballOutline, (v) => (this.settings.ballOutline = v)),
      toggle('High-Contrast Court', () => this.settings.highContrastCourt, (v) => (this.settings.highContrastCourt = v)),
      toggle('Background Animation', () => this.settings.backgroundAnimation, (v) => (this.settings.backgroundAnimation = v)),
      toggle('Camera Impulse', () => this.settings.cameraImpulse, (v) => (this.settings.cameraImpulse = v)),
    );

    s.append(tabs);
    for (const p of panels.values()) s.append(p);
    showTab('Audio');
    s.append(btn('Back', '', () => { this.cb.onMenuSound('select'); this.show(this.backFromSettings); }));
    this.addScreen('settings', s);
  }

  /** Where the settings Back button returns to (title or pause). */
  backFromSettings: ScreenName = 'title';

  private buildTraining(): void {
    const s = el('section');
    s.append(el('h2', '', 'Training Lab'), el('div', 'subtitle', 'Pick an exercise. Trajectory preview is on in here.'));
    const list = el('div', 'menu-col');
    list.style.width = '420px';
    for (const ex of TRAINING_EXERCISES) {
      const b = btn(ex.name, '', () => {
        this.cb.onMenuSound('select');
        this.cb.onStartTraining(ex.id);
      });
      b.title = ex.desc;
      b.setAttribute('aria-label', `${ex.name}: ${ex.desc}`);
      list.append(b);
    }
    s.append(list, btn('Back', '', () => { this.cb.onMenuSound('select'); this.show('title'); }));
    this.addScreen('training', s);
  }

  private buildPause(): void {
    const s = el('section');
    s.append(el('h2', '', 'Paused'));
    const col = el('div', 'menu-col');
    col.append(
      btn('Resume', 'primary', () => { this.cb.onMenuSound('select'); this.cb.onResume(); }),
      btn('Restart', '', () => { this.cb.onMenuSound('select'); this.cb.onRestart(); }),
      btn('Settings', '', () => {
        this.cb.onMenuSound('select');
        this.backFromSettings = 'pause';
        this.show('settings');
      }),
      btn('Quit to Menu', '', () => { this.cb.onMenuSound('select'); this.cb.onQuitToMenu(); }),
    );
    s.append(col);
    this.addScreen('pause', s);
  }

  private resultsBody: HTMLElement | null = null;

  private buildResults(): void {
    const s = el('section');
    this.resultsBody = el('div', 'opt-group');
    this.resultsBody.style.gap = '14px';
    s.append(this.resultsBody);
    const row = el('div', 'row');
    row.append(
      btn('Rematch', 'primary', () => { this.cb.onMenuSound('select'); this.cb.onRematch(); }),
      btn('Change Mode', '', () => { this.cb.onMenuSound('select'); this.cb.onChangeMode(); }),
      btn('Main Menu', '', () => { this.cb.onMenuSound('select'); this.cb.onQuitToMenu(); }),
    );
    s.append(row);
    this.addScreen('results', s);
  }

  showResults(data: ResultsData): void {
    const body = this.resultsBody!;
    body.innerHTML = '';
    body.append(
      el('h2', '', data.mode === 'survival' ? 'Survival Over' : `${data.winnerName} Wins!`),
      el('div', 'subtitle', `Final score  ${data.score[0]} : ${data.score[1]}`),
    );
    const grid = el('div', 'results-stats');
    const stat = (k: string, v: string) => {
      grid.append(el('div', '', k), el('div', 'v', v));
    };
    if (data.mode === 'survival') stat('Rounds survived', String(data.survivalRounds ?? 0));
    stat('Longest rally', `${data.stats.longestRally} touches`);
    stat('Fastest shot', `${(data.stats.fastestShot * 3.6).toFixed(0)} km/h`);
    stat('Saves — Player 1', String(data.stats.saves[0]));
    stat('Saves — Player 2', String(data.stats.saves[1]));
    body.append(grid);

    // Survival runs can be submitted to the global leaderboard.
    this.submitStatusEl = null;
    this.submitBtn = null;
    const rounds = data.survivalRounds ?? 0;
    if (data.mode === 'survival' && rounds > 0) {
      const box = el('div', 'opt-group submit-box');
      box.append(el('h3', '', 'Global Leaderboard'));
      const input = this.nameInput();
      this.submitBtn = btn(`Submit ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`, 'small', () => {
        this.settings.playerName = input.value.trim().slice(0, 16);
        this.cb.onSettingsChanged();
        if (this.settings.playerName.length < 2) {
          this.setSubmitStatus('Enter a name (at least 2 characters) first.');
          return;
        }
        this.cb.onMenuSound('select');
        this.cb.onSubmitScore(rounds);
      });
      const inRow = el('div', 'row');
      inRow.append(input, this.submitBtn);
      this.submitStatusEl = el('div', 'subtitle', 'Enter a name and submit your run.');
      box.append(inRow, this.submitStatusEl);
      body.append(box);
    }

    this.refreshTitle();
    this.show('results');
  }

  // --- global leaderboard ----------------------------------------------------

  private lbList: HTMLElement | null = null;
  private lbNameInput: HTMLInputElement | null = null;
  private submitStatusEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;

  private nameInput(): HTMLInputElement {
    const input = el('input') as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 16;
    input.placeholder = 'Your name (2–16 chars)';
    input.className = 'name-input';
    input.setAttribute('aria-label', 'Leaderboard name');
    input.value = this.settings.playerName;
    input.addEventListener('change', () => {
      this.settings.playerName = input.value.trim().slice(0, 16);
      this.cb.onSettingsChanged();
    });
    return input;
  }

  private buildLeaderboard(): void {
    const s = el('section');
    s.append(
      el('h2', '', 'Global Leaderboard'),
      el('div', 'subtitle', 'Survival mode — rounds cleared. One entry per name, best run counts.'),
    );
    const nameRow = el('label', 'slider-row');
    nameRow.append(el('span', '', 'Your name'));
    this.lbNameInput = this.nameInput();
    nameRow.append(this.lbNameInput);
    this.lbList = el('div', 'lb-list');
    this.lbList.setAttribute('role', 'list');
    const row = el('div', 'row');
    row.append(
      btn('Refresh', 'small', () => { this.cb.onMenuSound('move'); this.refreshLeaderboard(); }),
      btn('Play Survival', 'primary', () => { this.cb.onMenuSound('select'); this.cb.onStartSurvival(); }),
      btn('Back', '', () => { this.cb.onMenuSound('select'); this.show('title'); }),
    );
    s.append(nameRow, this.lbList, row);
    this.addScreen('leaderboard', s);
  }

  private lbRequest = 0;

  refreshLeaderboard(): void {
    if (!this.lbList) return;
    if (this.lbNameInput) this.lbNameInput.value = this.settings.playerName;
    const req = ++this.lbRequest;
    this.lbList.textContent = 'Loading…';
    void fetchLeaderboard().then((entries) => {
      if (req !== this.lbRequest || !this.lbList) return; // stale response
      this.lbList.innerHTML = '';
      if (entries === null) {
        this.lbList.append(el('div', 'subtitle',
          'Leaderboard unreachable. It works on the deployed site once a Redis store is connected (see README).'));
        return;
      }
      if (entries.length === 0) {
        this.lbList.append(el('div', 'subtitle', 'No scores yet — survive a round and be the first!'));
        return;
      }
      entries.forEach((e, i) => {
        const row = el('div', 'lb-row');
        row.setAttribute('role', 'listitem');
        const me = this.settings.playerName && e.name === this.settings.playerName;
        if (me) row.classList.add('me');
        row.append(
          el('span', 'lb-rank', `${i + 1}.`),
          el('span', 'lb-name', e.name),
          el('span', 'lb-score', `${e.score} ${e.score === 1 ? 'round' : 'rounds'}`),
        );
        this.lbList!.append(row);
      });
    });
  }

  /** Update the submit status line on the results screen. */
  setSubmitStatus(text: string, done = false): void {
    if (this.submitStatusEl) this.submitStatusEl.textContent = text;
    if (done && this.submitBtn) this.submitBtn.disabled = true;
  }

  private buildHowTo(): void {
    const s = el('section');
    s.append(el('h2', '', 'How to Play'));
    const txt = el('div', 'opt-group');
    txt.style.maxWidth = '520px';
    txt.style.alignItems = 'flex-start';
    txt.style.gap = '10px';
    const lines = [
      'Move left, move right, jump. That is every control — there is no hit button.',
      'The ball leaves your body based on where it touches you and how you are moving. Hit it with your side to angle it, with your top to pop it up, while jumping to spike it.',
      'Ground the ball on the other side to score. Rally scoring: every fault is a point.',
      `Your side may touch the ball at most ${RULES.maxTouches} times in a row.`,
      'Player 1: A / D to move, W or Space to jump.  Player 2: Arrow keys.',
      'Escape pauses. Backquote (`) opens developer tools.',
    ];
    for (const l of lines) txt.append(el('div', '', '• ' + l));
    s.append(txt, btn('Back', '', () => { this.cb.onMenuSound('select'); this.show('title'); }));
    this.addScreen('howto', s);
  }
}
