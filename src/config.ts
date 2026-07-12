/**
 * Bounce Court — central configuration.
 *
 * Every gameplay-relevant tuning value lives here. Physics units are
 * abstract "court units" (cu). The court is ~24 cu wide; 1 cu ≈ 0.5 m of
 * fictional arena. Time is in seconds, velocities in cu/s.
 *
 * The simulation runs at a fixed timestep (SIM.dt) regardless of render
 * frame rate, so these values are frame-rate independent by construction.
 */

export const SIM = {
  /** Fixed simulation timestep (s). 120 Hz keeps fast balls well below
   *  one-radius-per-step travel, which rules out tunneling. */
  dt: 1 / 120,
  /** Max accumulated simulation time consumed per rendered frame (s).
   *  Protects against the "spiral of death" after a tab was hidden. */
  maxFrameTime: 0.25,
} as const;

export const COURT = {
  /** Horizontal half-extent of the playable court (walls at ±halfWidth). */
  halfWidth: 12,
  /** Visible ceiling used only for velocity sanity clamping (no collider). */
  softCeiling: 26,
  /** Net rectangle half-thickness. */
  netHalfWidth: 0.14,
  /** Net height from the floor to the top of the tape. */
  netHeight: 3.35,
} as const;

export const PLAYER = {
  /** Collision circle radius. Identical for every cosmetic style. */
  radius: 0.98,
  /** Ground acceleration (cu/s²). */
  groundAccel: 88,
  /** Ground deceleration when no input is held (cu/s²). */
  groundDecel: 70,
  /** Air acceleration — deliberately weaker than on the ground. */
  airAccel: 34,
  /** Maximum horizontal speed (cu/s). */
  maxSpeed: 9.2,
  /** Upward velocity applied on jump (cu/s). */
  jumpImpulse: 13.2,
  /** Gravity applied to characters (cu/s²). Stronger than ball gravity so
   *  jumps feel snappy while the ball floats. */
  gravity: 34,
  /** Extra gravity multiplier while rising after jump released (snappy hops). */
  jumpCutMultiplier: 2.1,
  /** Jump input buffer window (s). */
  jumpBuffer: 0.1,
  /** Coyote time after leaving the ground (s). */
  coyoteTime: 0.06,
} as const;

export const BALL = {
  radius: 0.44,
  /** Ball gravity (cu/s²) — floatier than the characters. */
  gravity: 15.5,
  /** Restitution against walls. */
  wallRestitution: 0.72,
  /** Restitution against the net body / net top. */
  netRestitution: 0.55,
  /** Restitution used for the decorative post-point floor bounce. */
  floorRestitution: 0.55,
  /** Hard cap on ball speed (cu/s). */
  maxSpeed: 26,
  /** Minimum horizontal damping when rolling on the net tape (anti-jitter). */
  netTangentDamping: 0.985,
  /** Visible spin: angular velocity = spinFactor * tangential slip. */
  spinFactor: 1.6,
} as const;

export const HIT = {
  /** Restitution of the ball against a character body. */
  restitution: 0.52,
  /** Flat outward impulse added along the contact normal (cu/s). This is
   *  what makes even a stationary character pop the ball up usefully. */
  baseImpulse: 9.0,
  /** Fraction of the character's velocity transferred into the ball. */
  momentumTransfer: 0.78,
  /** Fraction of tangential (sliding) relative velocity preserved. */
  tangentKeep: 0.85,
  /** Minimum outgoing normal speed so the ball never sticks to a body. */
  minNormalSpeed: 7.5,
  /** Re-hit lockout: the ball must separate this far (× radii sum) before
   *  the same character can register a new touch. */
  separationFactor: 1.05,
} as const;

export const RULES = {
  /** Selectable score targets. */
  scoreOptions: [5, 11, 15, 21] as number[],
  defaultTarget: 11,
  winByTwoDefault: true,
  /** Absolute score cap — first to reach it wins even without a 2-pt lead. */
  hardCap: 30,
  /** Max consecutive touches for one side before the point is lost. */
  maxTouches: 4,
  /** Freeze frames on the decisive landing (s). */
  pointFreeze: 0.55,
  /** Celebration/reset window between points (s). */
  pointResetDelay: 1.5,
  /** Serve: ball spawns hovering this high above the server. */
  serveDropHeight: 7.2,
  /** Horizontal offset of the serve spot from the court center. */
  serveOffsetX: 6.4,
  /** Countdown before the serve ball is released (s). */
  serveCountdown: 0.9,
} as const;

/** AI difficulty parameter sets. The AI plays through the same input
 *  interface as a human — these knobs only shape its decisions. */
export interface AiParams {
  /** Delay before reacting to a change in ball trajectory (s). */
  reactionDelay: number;
  /** Std-dev of landing prediction error (cu), re-rolled per volley. */
  predictionError: number;
  /** Seconds between re-evaluating intention. */
  decisionCooldown: number;
  /** 0..1 — chance of choosing an attacking shot when one is available. */
  aggression: number;
  /** 0..1 — how precisely it steers to the ideal contact offset. */
  placementSkill: number;
  /** Dead-zone around the target before it stops adjusting (cu). */
  moveThreshold: number;
  /** 0..1 — probability of jumping to intercept when useful. */
  jumpiness: number;
  /** How far into the future trajectory samples are trusted (s). */
  foresight: number;
  /** 0..1 — mixes in awareness of the opponent's court position. */
  targeting: number;
}

export const AI_LEVELS: Record<'relaxed' | 'standard' | 'skilled' | 'rival', AiParams> = {
  relaxed: {
    reactionDelay: 0.42,
    predictionError: 1.7,
    decisionCooldown: 0.5,
    aggression: 0.12,
    placementSkill: 0.35,
    moveThreshold: 0.85,
    jumpiness: 0.25,
    foresight: 0.9,
    targeting: 0.0,
  },
  standard: {
    reactionDelay: 0.24,
    predictionError: 0.95,
    decisionCooldown: 0.32,
    aggression: 0.38,
    placementSkill: 0.6,
    moveThreshold: 0.5,
    jumpiness: 0.5,
    foresight: 1.5,
    targeting: 0.35,
  },
  skilled: {
    reactionDelay: 0.13,
    predictionError: 0.45,
    decisionCooldown: 0.2,
    aggression: 0.66,
    placementSkill: 0.82,
    moveThreshold: 0.3,
    jumpiness: 0.75,
    foresight: 2.2,
    targeting: 0.7,
  },
  rival: {
    reactionDelay: 0.07,
    predictionError: 0.22,
    decisionCooldown: 0.14,
    aggression: 0.85,
    placementSkill: 0.95,
    moveThreshold: 0.18,
    jumpiness: 0.92,
    foresight: 3.0,
    targeting: 0.95,
  },
};

export const FX = {
  /** Camera impulse strength on big spikes (cu). Kept tiny by design. */
  cameraImpulse: 0.14,
  cameraRecovery: 6.5,
  /** Ball speed above which the motion trail fades in (cu/s). */
  trailSpeed: 13,
  /** Ball speed considered a "power hit" for audio/FX scaling. */
  powerHitSpeed: 17,
  /** Hit-stop on exceptional impacts (s of frozen sim). */
  hitStop: 0.045,
  hitStopSpeed: 21,
} as const;

export const STATS = {
  /** A touch counts as a "save" if the ball was below this height and
   *  descending faster than saveFallSpeed when contacted. */
  saveHeight: 1.6,
  saveFallSpeed: 6,
} as const;
