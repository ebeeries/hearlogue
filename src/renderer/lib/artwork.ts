import { unitHash } from '@shared/utils/hash';

/**
 * Generated cover art.
 *
 * The Spotify export contains no artwork and HEARLOGUE never touches the
 * network, so a page of track rows would otherwise be a wall of text. Instead
 * every artist, album and track gets a deterministic mark derived from its name:
 * the same record always looks the same, different records look different, and
 * nothing is fetched.
 *
 * The palette is drawn from the app's own accents, so generated art reads as
 * part of the product rather than as decoration bolted on.
 */

export interface CoverPalette {
  from: string;
  to: string;
  ink: string;
  accent: string;
}

const PALETTES: CoverPalette[] = [
  { from: '#2A2118', to: '#141110', ink: '#E6C88C', accent: '#D6B06A' },
  { from: '#1B2621', to: '#101413', ink: '#8CA595', accent: '#7E9384' },
  { from: '#1A1F28', to: '#0F1216', ink: '#8B9AB2', accent: '#7C8BA3' },
  { from: '#291D18', to: '#150F0D', ink: '#C08F72', accent: '#B08268' },
  { from: '#241B22', to: '#120E11', ink: '#A6849E', accent: '#96768F' },
  { from: '#22201A', to: '#121210', ink: '#B9B3A5', accent: '#918B7E' },
  { from: '#2A1A17', to: '#160E0D', ink: '#C57A6E', accent: '#B4685E' },
];

export function coverPalette(seed: string): CoverPalette {
  return PALETTES[Math.floor(unitHash(seed, 11) * PALETTES.length) % PALETTES.length];
}

export type CoverShape = 'arc' | 'bars' | 'grid' | 'orbit' | 'wave' | 'split';

const SHAPES: CoverShape[] = ['arc', 'bars', 'grid', 'orbit', 'wave', 'split'];

export function coverShape(seed: string): CoverShape {
  return SHAPES[Math.floor(unitHash(seed, 23) * SHAPES.length) % SHAPES.length];
}

/** The one or two letters shown when a cover is rendered small. */
export function coverInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export interface CoverGeometry {
  palette: CoverPalette;
  shape: CoverShape;
  rotation: number;
  /** Four normalised values the shapes use for their proportions. */
  seeds: [number, number, number, number];
}

export function coverGeometry(seed: string): CoverGeometry {
  return {
    palette: coverPalette(seed),
    shape: coverShape(seed),
    rotation: Math.round(unitHash(seed, 31) * 360),
    seeds: [
      unitHash(seed, 41),
      unitHash(seed, 43),
      unitHash(seed, 47),
      unitHash(seed, 53),
    ],
  };
}
