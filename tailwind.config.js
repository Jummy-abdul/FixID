/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dae6ff', 200: '#bdd3ff', 300: '#90b6ff', 400: '#5c8dfd',
          500: '#3766f9', 600: '#2147ee', 700: '#1a35db', 800: '#1c2eb1', 900: '#1d2d8b', 950: '#161d54',
        },
      },
      boxShadow: { card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)' },
      keyframes: {
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        'float-delayed': 'float 7s ease-in-out 1.5s infinite',
      },
    },
  },
  plugins: [],
};
