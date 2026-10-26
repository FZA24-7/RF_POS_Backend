/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dce8ff',
          300: '#93b4ff',
          500: '#3b6fed',
          600: '#2c56c9',
          700: '#2444a1',
        },
      },
    },
  },
  plugins: [],
};
