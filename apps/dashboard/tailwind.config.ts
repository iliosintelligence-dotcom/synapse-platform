import type { Config } from 'tailwindcss';

/**
 * Dashboard Tailwind config — maps the @synapse/ui token values into
 * Tailwind so web surfaces share the exact palette/spacing of mobile.
 * (Values mirror packages/ui/src/tokens.ts — keep in sync; see docs.)
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FDFDFC',
        surface: '#FFFFFF',
        ink: '#16181C',
        'ink-muted': 'rgba(22,24,28,0.55)',
        'ink-dim': 'rgba(22,24,28,0.34)',
        'glass-border': 'rgba(18,20,24,0.07)',
        accent: '#C2552B',
        'accent-soft': 'rgba(194,85,43,0.09)',
        gold: '#9C7A1E',
        trust: '#2E7D4F',
      },
      borderRadius: {
        card: '24px',
        inner: '18px',
      },
      boxShadow: {
        'depth-1': '0 8px 24px rgba(26,32,48,0.06)',
        'depth-2': '0 16px 36px rgba(26,32,48,0.09)',
        'depth-3': '0 24px 52px rgba(26,32,48,0.13)',
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
