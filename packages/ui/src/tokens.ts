/**
 * Synapse design tokens — the single source of truth.
 * Every primitive imports ONLY from this file. No hardcoded values anywhere.
 *
 * Spatial principle: information lives on five floating layers above a white
 * canvas. Depth is communicated through layering and blur — never colour.
 */
import { Easing } from 'react-native-reanimated';
import type { ViewStyle, TextStyle } from 'react-native';

/* ───────────────────────── COLOUR ───────────────────────── */

export const color = {
  // Canvas + surfaces — overwhelmingly white
  canvas: '#FDFDFC',
  surface: '#FFFFFF',
  glassFill: 'rgba(255,255,255,0.62)',
  glassFillHigh: 'rgba(255,255,255,0.48)', // higher translucency (Layer 2+)
  glassBorder: 'rgba(18,20,24,0.07)',
  glassHighlight: 'rgba(255,255,255,0.95)',
  glassEdgeGlow: 'rgba(255,255,255,0.55)',

  // Ink
  ink: '#16181C',
  inkMuted: 'rgba(22,24,28,0.55)',
  inkDim: 'rgba(22,24,28,0.34)',
  inkFaint: 'rgba(22,24,28,0.16)',

  // Accent — burnt earth. CTAs, AI moments, active states only.
  accent: '#C2552B',
  accentPressed: '#A8451F',
  accentSoft: 'rgba(194,85,43,0.09)',
  accentBorder: 'rgba(194,85,43,0.22)',
  onAccent: '#FFFFFF',

  // Status — indicators only, never surfaces
  success: '#2E7D4F',
  successSoft: 'rgba(46,125,79,0.10)',
  successBorder: 'rgba(46,125,79,0.22)',
  pending: '#A8742B',
  pendingSoft: 'rgba(168,116,43,0.10)',
  pendingBorder: 'rgba(168,116,43,0.22)',
  gold: '#9C7A1E',
  goldSoft: 'rgba(156,122,30,0.10)',
  goldBorder: 'rgba(156,122,30,0.30)',
  warning: '#B3541E',

  // Scrim behind Layer 3+
  scrim: 'rgba(22,24,28,0.22)',
} as const;

/* ───────────────────────── DEPTH ───────────────────────── */

export type DepthLayer = 0 | 1 | 2 | 3 | 4;

type DepthSpec = {
  /** expo-blur intensity */
  blur: number;
  /** glass fill colour for this layer */
  fill: string;
  /** z-index hint */
  z: number;
};

/**
 * Layer 0 — background canvas. Pure white, almost invisible.
 * Layer 1 — standard card. Subtle frost, gentle blur.
 * Layer 2 — floating cards (Property, AI). Higher elevation, more translucent.
 * Layer 3 — priority: expanded cards, bottom sheets, active AI.
 * Layer 4 — focus: modals, full previews, scheduling flows.
 */
export const depth: Record<DepthLayer, DepthSpec> = {
  0: { blur: 0, fill: color.canvas, z: 0 },
  1: { blur: 18, fill: color.glassFill, z: 10 },
  2: { blur: 32, fill: color.glassFillHigh, z: 20 },
  3: { blur: 48, fill: 'rgba(255,255,255,0.72)', z: 30 },
  4: { blur: 64, fill: 'rgba(255,255,255,0.82)', z: 40 },
} as const;

/* ───────────────────────── SHADOW ───────────────────────── */

/**
 * Soft atmospheric shadows — light through frosted glass.
 * Large radius, low opacity, diffused. Never heavy.
 * Three levels matching Layers 1, 2, 3 (Layer 4 reuses 3 + scrim).
 */
export type ShadowLevel = 1 | 2 | 3;

export const shadow: Record<ShadowLevel, ViewStyle> = {
  1: {
    shadowColor: '#1A2030',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 3,
  },
  2: {
    shadowColor: '#1A2030',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.09,
    shadowRadius: 36,
    elevation: 7,
  },
  3: {
    shadowColor: '#1A2030',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.13,
    shadowRadius: 52,
    elevation: 14,
  },
} as const;

/* ───────────────────────── MOTION ───────────────────────── */

/**
 * Three durations only. Never exceed 300ms.
 * Micro — presses, icon reactions, selection.
 * Standard — card transitions, navigation, search.
 * Expanded — card expansion, previews, AI workflow transitions.
 */
export const motion = {
  micro: 100,
  standard: 180,
  expanded: 250,
} as const;

/** Physical, responsive springs — not linear, not bouncy. */
export const spring = {
  micro: { damping: 30, stiffness: 480, mass: 0.7 },
  standard: { damping: 26, stiffness: 300, mass: 0.9 },
  expanded: { damping: 24, stiffness: 220, mass: 1 },
} as const;

export const easing = {
  out: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
} as const;

/* ───────────────────────── TYPOGRAPHY ───────────────────────── */

export const fontFamily = {
  display: 'BebasNeue_400Regular',
  light: 'DMSans_300Light',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
} as const;

export type TypeStyle = 'display' | 'title' | 'body' | 'label' | 'caption';

/**
 * Display — Bebas Neue, wide tracking. Prices, hero statements, AI conclusions.
 * Title — DM Sans semibold. Card titles, section headers.
 * Body — DM Sans light. Descriptions, AI reasoning.
 * Label — DM Sans medium, small. Metadata, specs, distances.
 * Caption — DM Sans light, smallest, muted. Timestamps, secondary info.
 */
export const type: Record<TypeStyle, TextStyle> = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: 32,
    letterSpacing: 1.6,
    color: color.ink,
  },
  title: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    letterSpacing: -0.2,
    color: color.ink,
  },
  body: {
    fontFamily: fontFamily.light,
    fontSize: 14.5,
    lineHeight: 23,
    color: color.ink,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    letterSpacing: 0.1,
    color: color.inkMuted,
  },
  caption: {
    fontFamily: fontFamily.light,
    fontSize: 11.5,
    color: color.inkDim,
  },
} as const;

/* ───────────────────────── ICONS ───────────────────────── */

export const iconSize = {
  xs: 14,
  sm: 17,
  md: 20,
  lg: 24,
  xl: 30,
} as const;

export type IconSize = keyof typeof iconSize;

/** SF-style stroke weight — thin, consistent everywhere */
export const iconStroke = 1.6;

/* ───────────────────────── SPACING ───────────────────────── */

/** Aggressively generous. If it feels tight, go up a step. */
export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  xxl: 40,
  section: 56,
} as const;

/* ───────────────────────── RADIUS ───────────────────────── */

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

/* ───────────────────────── HIT TARGETS ───────────────────────── */

export const hit = { slop: 8, minSize: 44 } as const;
