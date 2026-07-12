/**
 * Cosmetic Bouncer styles. Purely visual — every style shares identical
 * collision size and movement stats. Unlocks are cosmetic only.
 */

export type CrestKind =
  | 'sprout'
  | 'fin'
  | 'leaf'
  | 'antenna'
  | 'mohawk'
  | 'ears'
  | 'tuft'
  | 'halo';

export interface BouncerStyle {
  name: string;
  /** Main body color. */
  color: number;
  /** Belly/accent color. */
  accent: number;
  crest: CrestKind;
  /** Short flavor line for the character select screen. */
  blurb: string;
}

export const BOUNCER_STYLES: BouncerStyle[] = [
  { name: 'Pippo',  color: 0xff6b52, accent: 0xffd9a3, crest: 'sprout',  blurb: 'A cheerful coral bouncer with a stubborn little sprout.' },
  { name: 'Marlow', color: 0x3fa0f5, accent: 0xbfe8ff, crest: 'fin',     blurb: 'Cool-headed tide-rider. The fin is purely decorative. Mostly.' },
  { name: 'Bud',    color: 0x6fc832, accent: 0xe0f7b0, crest: 'leaf',    blurb: 'Photosynthesizes confidence between rallies.' },
  { name: 'Zizz',   color: 0x9b5cff, accent: 0xe6d4ff, crest: 'antenna', blurb: 'Receives signals from somewhere. Refuses to say where.' },
  { name: 'Sunno',  color: 0xffc23c, accent: 0xfff2c4, crest: 'mohawk',  blurb: 'Warm-up champion three years running.' },
  { name: 'Minty',  color: 0x2fd8b8, accent: 0xd2fff2, crest: 'ears',    blurb: 'Hears every whisper in the arena. Judges silently.' },
  { name: 'Embra',  color: 0xff4f8e, accent: 0xffd2e2, crest: 'tuft',    blurb: 'Runs hot. Cools down only after match point.' },
  { name: 'Cosmo',  color: 0x5668ff, accent: 0xd0d6ff, crest: 'halo',    blurb: 'Claims to be from the moon league. Unverifiable.' },
];
