import type { TileKind } from '@ada/game-core';

/** Palette of the visual direction (GDD "Arayüz ve görsel yön"). */
export const SEA = '#0b2530';
export const PANEL = '#10303f';
export const SHALLOWS = '#174759';
export const INK = '#e8eef0';
export const AMBER = '#ffb347';

export const TERRAIN_COLOR: Record<TileKind, string> = {
  lumber: '#2e6b45',
  brick: '#b4572f',
  wool: '#8fb45a',
  grain: '#d8b342',
  ore: '#77808c',
  desert: '#c9b88a',
};

/** Darker tone of each terrain, used for its pattern strokes. */
export const TERRAIN_DARK: Record<TileKind, string> = {
  lumber: '#1b4429',
  brick: '#7a3519',
  wool: '#5f8433',
  grain: '#a2801c',
  ore: '#4d5560',
  desert: '#a8956a',
};

/**
 * Player colours by seat: the four of the visual direction (orange, purple,
 * white, pink) and a fifth for the 5-player game. Each stands out on the sea
 * and on every terrain pattern (checked by test and by screenshots); buildings
 * also carry the seat number, so colour is never the only cue.
 */
export const PLAYER_COLORS = ['#ff8a3d', '#a66bff', '#f6f6f6', '#ff7ab8', '#2fd4c4'] as const;
/** Team frames of the team mode: neither is a player colour; the letter A / B always goes with them, so colour is never the only cue. */
export const TEAM_COLORS = { A: '#5aa9ff', B: '#d4e157' } as const;
export const PIECE_OUTLINE = '#0b1b22';
export const playerColor = (seat: number): string => PLAYER_COLORS[seat % PLAYER_COLORS.length];

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
