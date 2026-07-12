/**
 * Bounce Court — application bootstrap and mode orchestration.
 *
 * Owns the singletons (renderer, loop, input, audio, UI, settings) and the
 * current session (menu demo / match / training). All simulation runs in
 * the fixed-timestep loop; rendering interpolates between the last two
 * physics states.
 */

import './style.css';
import { AI_LEVELS, AiParams, FX, SIM } from './config';
import { AiController } from './ai/ai';
import { AudioEngine } from './audio/audio';
import { GameLoop } from './core/loop';
import { DebugPanel } from './debug';
import { Match } from './game/match';
import { TRAINING_META, TrainingSession } from './game/training';
import { InputSystem as Input } from './input/input';
import { World, PlayerInput as PIn } from './physics/world';
import { GameRenderer } from './render/renderer';
import { BOUNCER_STYLES } from './render/styles';
import {
  loadProgress, loadSettings, saveProgress, saveSettings, Settings,
} from './settings';
import { MatchSetup, ResultsData, TRAINING_EXERCISES, UI } from './ui/ui';
import { lerp, clamp } from './util/math';

type AppMode = 'menu' | 'match' | 'training';

class App {
  settings: Settings = loadSettings();
  progress = loadProgress();
  input = new Input(this.settings.bindings);
  audio = new AudioEngine();
  loop = new GameLoop();
  renderer: GameRenderer;
  ui: UI;
  debug = new DebugPanel();

  world = new World();
  match: Match | null = null;
  training: TrainingSession | null = null;
  ais: [AiController | null, AiController | null] = [null, null];

  mode: AppMode = 'menu';
  matchMode: 'ai' | 'versus' | 'survival' = 'ai';
  currentSetup: MatchSetup | null = null;
  currentTrainingId: string | null = null;
  paused = false;
  hitStopT = 0;
  resultsTimer = 0;
  pendingResults: ResultsData | null = null;
  survivalRound = 0;
  survivalAdvance = false;
  prevPhase = '';
  aiSeed = 1;
  menuDemoT = 0;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(canvas);
    this.renderer.setArena(this.settings.arena);
    this.renderer.setBouncers(this.settings.p1Style, this.settings.p2Style);

    this.ui = new UI(this.settings, this.progress, this.input, {
      onQuickMatch: () => this.startMatch({ ...this.ui.getSetup(), mode: 'ai' }, false),
      onStartMatch: (setup) => this.startMatch(setup, false),
      onStartTraining: (id) => this.startTraining(id),
      onStartSurvival: () => this.startSurvival(),
      onResume: () => this.setPaused(false),
      onRestart: () => this.restartSession(),
      onQuitToMenu: () => this.quitToMenu(),
      onRematch: () => this.rematch(),
      onChangeMode: () => {
        this.quitToMenu();
        this.ui.show('play');
      },
      onSettingsChanged: () => this.applySettings(),
      onMenuSound: (k) => (k === 'select' ? this.audio.menuSelect() : this.audio.menuMove()),
    });

    this.applySettings();
    this.setupMenuScene();

    // Audio requires a user gesture; unlock on the first interaction.
    const unlock = () => {
      this.audio.unlock();
      this.audio.setMusic(true);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    this.input.onPause = () => this.handleEscape();
    this.input.onDebugToggle = () => {
      const v = this.debug.toggle();
      this.renderer.setDebug(v);
    };
    this.debug.onResetRally = () => {
      if (this.match && this.match.phase !== 'over') this.match.beginServe(this.match.server, true);
    };
    this.debug.onSlowMo = (on) => {
      this.loop.timeScale = on ? 0.25 : 1;
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode !== 'menu' && !this.paused) this.setPaused(true);
    });

    this.loop.onUpdate = (dt) => this.update(dt);
    this.loop.onRender = (alpha, frameDt) => this.render(alpha, frameDt);
    this.loop.start();
  }

  /** Dev/test hook: put an AI on a player slot (used by automated tests). */
  __setAi(side: 0 | 1, difficulty: keyof typeof AI_LEVELS | null): void {
    this.ais[side] = difficulty
      ? new AiController(side, AI_LEVELS[difficulty], this.aiSeed++)
      : null;
  }

  // --- settings -----------------------------------------------------------

  applySettings(): void {
    const s = this.settings;
    this.audio.masterVolume = s.masterVolume;
    this.audio.musicVolume = s.musicVolume;
    this.audio.sfxVolume = s.sfxVolume;
    this.audio.muted = s.muted;
    this.audio.applyVolumes();
    this.renderer.setQuality(s.quality);
    this.renderer.setHighContrast(s.highContrastCourt);
    this.renderer.ballVis.setOutline(s.ballOutline);
    this.renderer.cameraImpulseEnabled = s.cameraImpulse && !s.reducedMotion;
    this.settings.bindings = this.input.bindings;
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    saveSettings(s);
  }

  // --- sessions -----------------------------------------------------------

  private setupMenuScene(): void {
    // The title screen shows a live court: two Bouncers warming up and a
    // ball hovering over the left server — the whole game at a glance.
    this.mode = 'menu';
    this.world = new World();
    this.world.ball.x = -6.4;
    this.world.ball.y = 7.2;
    this.world.ball.prevX = -6.4;
    this.world.ball.prevY = 7.2;
    this.world.ball.state = 'held';
    this.match = null;
    this.training = null;
    this.ais = [null, null];
    this.input.swallowKeys = false;
    this.ui.setHudVisible(false);
    this.ui.setTrainingPanel(null);
    this.renderer.showTrajectory(null, null);
  }

  private aiParamsForSurvival(round: number): AiParams {
    const order: AiParams[] = [
      AI_LEVELS.relaxed, AI_LEVELS.standard, AI_LEVELS.skilled, AI_LEVELS.rival,
    ];
    if (round < order.length) return order[round];
    // Beyond Rival: tighten decision knobs asymptotically. Physics and
    // movement stats never change — only reaction quality.
    const k = round - order.length + 1;
    const r = AI_LEVELS.rival;
    return {
      ...r,
      reactionDelay: Math.max(0.04, r.reactionDelay * Math.pow(0.9, k)),
      predictionError: Math.max(0.12, r.predictionError * Math.pow(0.88, k)),
      decisionCooldown: Math.max(0.1, r.decisionCooldown * Math.pow(0.92, k)),
      aggression: Math.min(0.95, r.aggression + 0.02 * k),
    };
  }

  startMatch(setup: MatchSetup, survival: boolean, survivalRound = 0): void {
    this.currentSetup = setup;
    this.matchMode = survival ? 'survival' : setup.mode;
    this.survivalRound = survivalRound;
    this.mode = 'match';
    this.paused = false;
    this.hitStopT = 0;
    this.resultsTimer = 0;
    this.pendingResults = null;
    this.survivalAdvance = false;
    this.training = null;

    this.world = new World();
    this.renderer.setArena(setup.arena);
    this.renderer.setBouncers(setup.p1Style, setup.p2Style);
    this.renderer.showTrajectory(null, null);

    const p1Name = BOUNCER_STYLES[setup.p1Style].name;
    const p2Name = BOUNCER_STYLES[setup.p2Style].name;
    const aiSuffix = (d: string) => ` (${d[0].toUpperCase()}${d.slice(1)} AI)`;

    if (survival) {
      const params = this.aiParamsForSurvival(survivalRound);
      this.ais = [null, new AiController(1, params, this.aiSeed++)];
      this.ui.setNames(p1Name, `Round ${survivalRound + 1}`);
    } else if (setup.mode === 'ai') {
      this.ais = [null, new AiController(1, AI_LEVELS[setup.difficulty], this.aiSeed++)];
      this.ui.setNames(p1Name, p2Name + aiSuffix(setup.difficulty));
    } else {
      this.ais = [null, null];
      this.ui.setNames(p1Name, p2Name);
    }

    const target = survival ? 5 : setup.targetScore;
    const winByTwo = survival ? false : setup.winByTwo;

    this.match = new Match(this.world, { targetScore: target, winByTwo }, {
      onServeStart: (server) => {
        this.audio.countdownTick(false);
        this.refreshScore();
        this.ui.banner(`${server === 0 ? this.leftName() : this.rightName()} serves`, 0.8);
      },
      onPoint: (scorer, landX, fault) => {
        this.audio.point();
        this.renderer.effects.showLanding(landX);
        this.refreshScore();
        const name = scorer === 0 ? this.leftName() : this.rightName();
        this.ui.banner(fault === 'touches' ? `Too many touches!\nPoint — ${name}` : `Point — ${name}`, 1.1);
        if (this.renderer.bouncers) {
          this.renderer.bouncers[scorer].setEmotion('happy', 1.5);
          this.renderer.bouncers[1 - scorer].setEmotion('sad', 1.5);
        }
      },
      onMatchOver: (winner) => this.handleMatchOver(winner),
    });

    this.prevPhase = this.match.phase;
    this.input.swallowKeys = true;
    this.ui.show('none');
    this.ui.setHudVisible(true);
    this.ui.setScoreboardVisible(true);
    this.ui.setTrainingPanel(null);
    this.refreshScore();
    this.ui.setHint(survival
      ? `Survival — Round ${survivalRound + 1} · first to ${target} · Esc to pause`
      : 'Esc — pause');
    if (survival) this.ui.banner(`Round ${survivalRound + 1}`, 1.4);
  }

  private leftName(): string {
    return this.currentSetup ? BOUNCER_STYLES[this.currentSetup.p1Style].name : 'Player 1';
  }

  private rightName(): string {
    if (this.matchMode === 'survival') return `Round ${this.survivalRound + 1} AI`;
    return this.currentSetup ? BOUNCER_STYLES[this.currentSetup.p2Style].name : 'Player 2';
  }

  startSurvival(): void {
    const setup = { ...this.ui.getSetup(), mode: 'ai' as const };
    this.startMatch(setup, true, 0);
  }

  startTraining(id: string): void {
    const meta = TRAINING_EXERCISES.find((e) => e.id === id);
    if (!meta) return;
    this.currentTrainingId = id;
    this.mode = 'training';
    this.paused = false;
    this.match = null;
    this.ais = [null, null];
    this.world = new World();
    this.renderer.setArena(this.settings.arena);
    this.renderer.setBouncers(this.settings.p1Style, this.settings.p2Style);
    this.training = new TrainingSession(this.world, id, meta.name, meta.desc);
    this.input.swallowKeys = true;
    this.ui.show('none');
    this.ui.setHudVisible(true);
    this.ui.setScoreboardVisible(false);
    this.ui.setTrainingPanel(meta.name, TRAINING_META[id]?.hint ?? meta.desc, '');
    this.ui.setHint('Esc — pause / exit');
  }

  quitToMenu(): void {
    this.setupMenuScene();
    this.ui.show('title');
    this.ui.refreshTitle();
    this.paused = false;
  }

  rematch(): void {
    if (this.matchMode === 'survival') {
      this.startSurvival();
    } else if (this.currentSetup) {
      this.startMatch(this.currentSetup, false);
    }
  }

  restartSession(): void {
    this.paused = false;
    if (this.mode === 'training' && this.currentTrainingId) {
      this.startTraining(this.currentTrainingId);
    } else if (this.currentSetup) {
      if (this.matchMode === 'survival') this.startSurvival();
      else this.startMatch(this.currentSetup, false);
    }
  }

  private handleMatchOver(winner: 0 | 1): void {
    if (!this.match || !this.currentSetup) return;
    this.audio.matchWin();
    const humanWon =
      winner === 0 || (this.matchMode === 'versus' /* both human */);

    if (this.matchMode === 'survival') {
      if (winner === 0) {
        this.survivalRound++;
        this.progress.matchWins++;
        if (this.survivalRound > this.progress.bestSurvivalRound) {
          this.progress.bestSurvivalRound = this.survivalRound;
        }
        this.survivalAdvance = true;
        this.ui.banner(`Round ${this.survivalRound} cleared!`, 1.6);
      } else {
        this.ui.banner('Survival over!', 1.4);
      }
    } else {
      if (humanWon) this.progress.matchWins++;
      const name = winner === 0 ? this.leftName() : this.rightName();
      this.ui.banner(`${name} wins the match!`, 1.8);
    }

    if (this.match.stats.longestRally > this.progress.longestRallyEver) {
      this.progress.longestRallyEver = this.match.stats.longestRally;
    }
    if (this.match.stats.fastestShot > this.progress.fastestShotEver) {
      this.progress.fastestShotEver = this.match.stats.fastestShot;
    }
    saveProgress(this.progress);

    if (this.renderer.bouncers) {
      this.renderer.bouncers[winner].setEmotion('happy', 3);
      this.renderer.bouncers[1 - winner].setEmotion('sad', 3);
    }

    this.pendingResults = {
      winnerName: winner === 0 ? this.leftName() : this.rightName(),
      winnerSide: winner,
      score: [...this.match.score] as [number, number],
      stats: this.match.stats,
      mode: this.matchMode,
      survivalRounds: this.survivalRound,
    };
    this.resultsTimer = 2.0;
  }

  // --- pause --------------------------------------------------------------

  private handleEscape(): void {
    if (this.mode === 'menu') {
      if (this.ui.currentScreen !== 'title' && this.ui.currentScreen !== 'results') {
        this.ui.show('title');
      }
      return;
    }
    if (this.ui.currentScreen === 'settings') {
      this.ui.show(this.ui.backFromSettings);
      return;
    }
    if (this.ui.currentScreen === 'results') return;
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    if (this.mode === 'menu') return;
    this.paused = paused;
    this.input.swallowKeys = !paused;
    this.ui.show(paused ? 'pause' : 'none');
  }

  // --- fixed update -------------------------------------------------------

  private getInput(side: 0 | 1, dt: number): PIn {
    const ai = this.ais[side];
    if (ai) return ai.update(this.world, dt);
    return this.input.getPlayerInput(side);
  }

  private update(dt: number): void {
    if (this.paused) return;

    if (this.resultsTimer > 0 && this.pendingResults) {
      this.resultsTimer -= dt;
      if (this.resultsTimer <= 0) {
        if (this.survivalAdvance && this.currentSetup) {
          this.startMatch(this.currentSetup, true, this.survivalRound);
        } else {
          const r = this.pendingResults;
          this.pendingResults = null;
          this.input.swallowKeys = false;
          this.ui.showResults(r);
        }
        return;
      }
    }

    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      return;
    }

    if (this.mode === 'menu') {
      // Idle warm-up scene behind the title.
      this.menuDemoT += dt;
      const hopL = Math.sin(this.menuDemoT * 2.2) > 0.93;
      const hopR = Math.sin(this.menuDemoT * 1.7 + 2) > 0.96;
      const inputs: [PIn, PIn] = [
        { left: false, right: false, jump: hopL },
        { left: Math.sin(this.menuDemoT * 0.8) > 0.4, right: Math.sin(this.menuDemoT * 0.8) < -0.4, jump: hopR },
      ];
      this.world.step(inputs);
      this.processWorldEvents(true);
      return;
    }

    if (this.mode === 'match' && this.match) {
      const inputs: [PIn, PIn] = [this.getInput(0, dt), this.getInput(1, dt)];
      if (!this.match.simFrozen) {
        this.world.step(inputs);
        this.processWorldEvents(false);
      }
      const before = this.match.phase;
      this.match.update(dt);
      if (before === 'countdown' && this.match.phase === 'serving') {
        this.audio.countdownTick(true);
      }
      // Match-point badge may change mid-rally as scores change.
      if (before !== this.match.phase) this.refreshScore();
      return;
    }

    if (this.mode === 'training' && this.training) {
      const inputs: [PIn, PIn] = [
        this.input.getPlayerInput(0),
        { left: false, right: false, jump: false },
      ];
      this.world.step(inputs);
      this.processWorldEvents(false);
      const st = this.training.update(dt);
      this.renderer.showTrajectory(st.trajectory, st.landingX);
      if (st.successFlash) {
        this.audio.point();
        this.ui.banner('Nice!', 0.6);
      }
      this.ui.setTrainingPanel(st.title, TRAINING_META[this.training.id]?.hint ?? st.desc, st.progressText);
    }
  }

  private processWorldEvents(quiet: boolean): void {
    for (const e of this.world.events) {
      switch (e.type) {
        case 'jump':
          if (!quiet) this.audio.jump();
          break;
        case 'land':
          if (!quiet) this.audio.land(e.impact);
          this.renderer.bouncers?.[e.side].kickWobble(-clamp(e.impact * 0.02, 0.1, 0.5));
          break;
        case 'playerHit': {
          this.audio.ballHit(e.speed);
          const power = clamp(e.speed / FX.powerHitSpeed, 0, 1.4);
          this.renderer.effects.ring(e.x, e.y, power);
          if (power > 0.7) this.renderer.effects.burst(e.x, e.y, power);
          this.renderer.bouncers?.[e.side].kickWobble(clamp(power * 0.5, 0.15, 0.7));
          if (e.speed > FX.hitStopSpeed && this.mode === 'match') {
            this.hitStopT = FX.hitStop;
            this.renderer.impulse(FX.cameraImpulse * power);
          }
          break;
        }
        case 'net':
          if (!quiet) this.audio.netHit(e.speed);
          this.renderer.effects.ring(e.x, e.y, clamp(e.speed / 16, 0, 0.7), 0xd9e6ff);
          break;
        case 'wall':
          if (!quiet) this.audio.wallHit(e.speed);
          this.renderer.effects.ring(e.x, e.y, clamp(e.speed / 18, 0, 0.8), 0xcfe2ff);
          break;
        case 'ground':
          if (!quiet) this.audio.groundHit(e.speed);
          this.renderer.effects.ring(e.x, 0.3, clamp(e.speed / 16, 0, 1), 0xffd75e);
          this.renderer.effects.burst(e.x, 0.4, clamp(e.speed / 16, 0, 1));
          break;
      }
    }
  }

  private refreshScore(): void {
    if (!this.match) return;
    this.ui.updateScore(
      this.match.score[0],
      this.match.score[1],
      this.match.phase === 'over' ? null : this.match.server,
      this.match.isMatchPoint(),
    );
  }

  // --- render -------------------------------------------------------------

  private render(alpha: number, frameDt: number): void {
    const s = this.settings;
    this.ui.tick(frameDt);
    this.audio.update(frameDt);

    const w = this.world;
    if (this.renderer.bouncers) {
      for (const side of [0, 1] as const) {
        const p = w.players[side];
        const ix = lerp(p.prevX, p.x, alpha);
        const iy = lerp(p.prevY, p.y, alpha);
        this.renderer.bouncers[side].update(
          ix, iy, p.vx, p.vy, p.grounded,
          w.ball.x, w.ball.y, frameDt, s.reducedMotion,
        );
      }
    }
    const b = w.ball;
    const bx = lerp(b.prevX, b.x, alpha);
    const by = lerp(b.prevY, b.y, alpha);
    this.renderer.ballVis.update(bx, by, b.vx, b.vy, b.angle, true, s.reducedMotion);

    // Off-screen indicator while the ball flies above the visible area.
    if (this.mode !== 'menu' && b.state !== 'dead') {
      const ndc = this.renderer.project(bx, by);
      if (ndc.y > 1.0) {
        const sx = clamp((ndc.x * 0.5 + 0.5) * window.innerWidth, 26, window.innerWidth - 26);
        this.ui.setBallMarker(sx);
      } else {
        this.ui.setBallMarker(null);
      }
    } else {
      this.ui.setBallMarker(null);
    }

    if (this.debug.visible) {
      this.renderer.updateDebug(
        w.players[0].x, w.players[0].y,
        w.players[1].x, w.players[1].y,
        b.x, b.y, b.vx, b.vy,
      );
      const ai = this.ais[1];
      this.debug.update({
        fps: 0,
        fixedDt: SIM.dt,
        phase: this.mode === 'match' ? this.match?.phase ?? '—' : this.mode,
        ballV: [b.vx, b.vy],
        ballPos: [b.x, b.y],
        aiIntent: ai ? ai.intention : '—',
        aiTarget: ai ? ai.targetX : 0,
      timeScale: this.loop.timeScale,
      }, frameDt);
    }

    this.renderer.render(frameDt, s.backgroundAnimation && !s.reducedMotion);
  }
}

const app = new App();
// Exposed for the debug console and automated smoke tests only.
(window as unknown as { __bounceCourt: App }).__bounceCourt = app;
