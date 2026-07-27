/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
        display: ['Inter', 'Space Grotesk', 'sans-serif'],
      },
      screens: {
        xs: '400px',
      },
      colors: {
        surface: {
          50:  '#f2f5ff',
          100: '#dce4f7',
          200: '#8d97b8',
          300: '#5b6584',
          600: '#1e2942',   // hover border
          700: '#151d33',
          800: '#070b16',
          850: '#050810',
          900: '#03060e',
          950: '#000000',
        },
        brand: {
          200: '#b9c8ff',
          300: '#7d9bff',
          400: '#4d74ff',
          500: '#2050ff',
          600: '#1a41d9',
          700: '#1432ab',
        },
        // Wider accent set so states stop looking identical
        cyan:   { 400: '#22d3ee', 500: '#06b6d4' },
        violet: { 400: '#a78bfa', 500: '#8b5cf6' },
        buy:     '#10d982',
        sell:    '#ff4d6a',
        danger:  '#ff4d6a',
        success: '#10d982',
        warning: '#ffb020',
        info:    '#4d74ff',
      },
      boxShadow: {
        'glow-sm':  '0 0 8px rgba(32,80,255,0.35)',
        'glow':     '0 0 16px rgba(32,80,255,0.40)',
        'glow-lg':  '0 0 28px rgba(32,80,255,0.45)',
        'glow-buy': '0 0 14px rgba(16,217,130,0.35)',
        'glow-sell':'0 0 14px rgba(255,77,106,0.35)',
        'lift':     '0 6px 24px -8px rgba(0,0,0,0.9), 0 0 0 1px rgba(32,80,255,0.12)',
      },
      backgroundImage: {
        'grad-panel': 'linear-gradient(160deg, rgba(32,80,255,0.06) 0%, rgba(0,0,0,0) 42%)',
        'grad-brand': 'linear-gradient(135deg, #4d74ff 0%, #2050ff 55%, #1432ab 100%)',
      },
      keyframes: {
        shimmer:  { '0%': { backgroundPosition: '-500px 0' }, '100%': { backgroundPosition: '500px 0' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        sheetUp:  { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        pulseRing:{ '0%': { boxShadow: '0 0 0 0 rgba(255,77,106,0.45)' }, '70%': { boxShadow: '0 0 0 8px rgba(255,77,106,0)' }, '100%': { boxShadow: '0 0 0 0 rgba(255,77,106,0)' } },
      },
      animation: {
        shimmer:   'shimmer 1.6s linear infinite',
        'slide-up':'slideUp .22s ease-out',
        'sheet-up':'sheetUp .26s cubic-bezier(.22,1,.36,1)',
        'fade-in': 'fadeIn .18s ease-out',
        'pulse-ring':'pulseRing 2s ease-out infinite',
      },
      borderRadius: { xl: '0.875rem', lg: '0.625rem', md: '0.375rem', sm: '0.25rem' },
    },
  },
  plugins: [],
};
