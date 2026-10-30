/** Design system PayTracking — tokens em CSS vars (src/styles/index.css), modo claro/escuro por classe. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), 'surface-3': v('surface-3'),
        border: v('border'), 'border-strong': v('border-strong'),
        fg: v('fg'), muted: v('muted'), subtle: v('subtle'),
        primary: { DEFAULT: v('primary'), fg: v('primary-fg'), soft: v('primary-soft') },
        accent: v('accent'),
        ok: v('ok'), warn: v('warn'), err: { DEFAULT: v('err'), fg: v('err-fg') }, info: v('info'),
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        lift: '0 2px 4px rgb(16 24 40 / 0.04), 0 12px 32px -12px rgb(16 24 40 / 0.18)',
        pop: '0 24px 64px -16px rgb(10 10 30 / 0.35), 0 4px 12px rgb(10 10 30 / 0.08)',
        glow: '0 0 0 1px rgb(109 74 255 / 0.25), 0 8px 32px -8px rgb(109 74 255 / 0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } },
        'scale-in': { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        drift: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(30px,-20px) scale(1.08)' } },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out both',
        'slide-up': 'slide-up .45s cubic-bezier(.2,.8,.2,1) both',
        'scale-in': 'scale-in .18s cubic-bezier(.2,.8,.2,1) both',
        'slide-in-left': 'slide-in-left .22s cubic-bezier(.2,.8,.2,1) both',
        float: 'float 6s ease-in-out infinite',
        drift: 'drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
