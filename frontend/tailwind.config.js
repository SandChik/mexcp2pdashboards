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
      colors: {
        // Futuristic-minimal palette: pure-black background with a cold blue
        // tint on surfaces/borders. Keys unchanged so every component restyles
        // without edits.
        surface: {
          50:  '#f2f5ff',   // strongest text (cool white)
          100: '#dce4f7',
          200: '#8d97b8',   // secondary text
          300: '#5b6584',   // faint text
          700: '#151d33',   // border — thin, blue-tinted
          800: '#070b16',   // card / panel — near-black with blue cast
          900: '#03060e',   // input / deeper panel
          950: '#000000',   // background — pure black as requested
        },
        brand: {
          // Sampled from the logo's blue (≈ #2050FF)
          300: '#7d9bff',
          400: '#4d74ff',
          500: '#2050ff',
          600: '#1a41d9',
          700: '#1432ab',
        },
        buy:     '#22c55e',
        sell:    '#ef4444',
        danger:  '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
        info:    '#4d74ff',
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(32,80,255,0.35)',
        'glow':    '0 0 16px rgba(32,80,255,0.40)',
        'glow-lg': '0 0 28px rgba(32,80,255,0.45)',
      },
      borderRadius: { lg: '0.5rem', md: '0.375rem', sm: '0.25rem' },
    },
  },
  plugins: [],
};
