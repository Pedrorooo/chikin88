/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        chikin: {
          red: '#D62828',
          'red-dark': '#A91D1D',
          'red-light': '#EF4444',
          yellow: '#F4D35E',
          'yellow-dark': '#D4B445',
          black: '#0A0A0A',
          'gray-900': '#111111',
          'gray-800': '#1A1A1A',
          'gray-700': '#252525',
          'gray-600': '#383838',
        },
        status: {
          'fresh-bg': '#DCFCE7',
          'fresh-border': '#16A34A',
          'fresh-text': '#15803D',
          'warn-bg': '#FEF9C3',
          'warn-border': '#CA8A04',
          'warn-text': '#854D0E',
          'late-bg': '#FED7AA',
          'late-border': '#EA580C',
          'late-text': '#9A3412',
          'urgent-bg': '#FECACA',
          'urgent-border': '#DC2626',
          'urgent-text': '#7F1D1D',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', '"Oswald"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'pulse-urgent': 'pulse-urgent 1.5s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'shake': 'shake 0.5s ease-in-out',
      },
      keyframes: {
        'pulse-urgent': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(220, 38, 38, 0.7)' },
          '50%': { boxShadow: '0 0 0 12px rgba(220, 38, 38, 0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
      },
    },
  },
  plugins: [],
}
