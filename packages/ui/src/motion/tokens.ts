/**
 * Synapse motion tokens — every animation in the app (Lottie and Reanimated)
 * imports its timing from here. No hardcoded millisecond values in components.
 *
 * Division of motion:
 *  - Lottie: illustrative / presence (typing, orb, badges, empty states)
 *  - Reanimated: gesture-driven / scroll-linked / layout (cards, sheets, press)
 *  If either could work, default to Reanimated — Lottie adds bundle weight.
 */
export const MotionTokens = {
  // Durations — these three values govern the entire motion system
  micro: 100,    // Button press, icon react, selection tap
  standard: 180, // Card transition, nav change, search interaction
  expanded: 250, // Card expansion, bottom sheet, AI workflow transition

  // Lottie-specific playback speeds
  lottie: {
    normal: 1.0,
    gentle: 0.8, // Slower for ambient/presence animations
    snappy: 1.3, // Faster for success/confirmation moments
  },

  // Spring configs for Reanimated (kept here for unity)
  spring: {
    gentle: { damping: 20, stiffness: 100, mass: 0.8 },
    snappy: { damping: 15, stiffness: 200, mass: 0.6 },
    bouncy: { damping: 10, stiffness: 180, mass: 0.5 },
  },

  // Colour tokens available to Lottie runtime colour replacement
  colors: {
    accent: '#C1622A',   // Burnt terracotta — primary brand
    gold: '#C9A84C',     // Verified states (reserved — rare and earned)
    green: '#2E7D55',    // Success, trust
    navy: '#0A1628',     // Deep background fills
    white: '#FFFFFF',
    offWhite: '#F8F6F2',
    dim: '#888888',
  },
} as const;

export type MotionDuration = 'micro' | 'standard' | 'expanded';
