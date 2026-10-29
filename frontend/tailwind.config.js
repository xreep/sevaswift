/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // The device's own UI font (San Francisco, Roboto, Segoe UI): nothing to download,
        // native on every phone. Headings use the same family, set heavier and tighter.
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#17202B', soft: '#3A4656', muted: '#6B7686' },
        paper: '#F4F6F8',
        line: '#DCE1E7',
        signal: { DEFAULT: '#FFB000', soft: '#FFF3D1', deep: '#8A5A00' },
        go: { DEFAULT: '#1E8E5A', soft: '#E3F4EB' },
        alert: { DEFAULT: '#C8322B', soft: '#FBE7E5' },
        route: { DEFAULT: '#2F5DA8', soft: '#E6EEF9' },
      },
      borderRadius: { panel: '12px' },
    },
  },
  plugins: [],
};
