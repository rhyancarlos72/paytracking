/** Design system PayTracking — tokens em CSS vars (src/styles/index.css), modo claro/escuro por classe. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'),
        fg: v('fg'), muted: v('muted'), subtle: v('subtle'),
        primary: { DEFAULT: v('primary'), fg: v('primary-fg'), soft: v('primary-soft') },
        ok: v('ok'), warn: v('warn'), err: { DEFAULT: v('err'), fg: v('err-fg') }, info: v('info'),
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: { card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)', pop: '0 12px 32px -8px rgb(16 24 40 / 0.18)' },
      keyframes: { 'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } } },
      animation: { 'fade-in': 'fade-in .18s ease-out' },
    },
  },
  plugins: [],
};
