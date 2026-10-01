/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './*.{js,jsx,ts,tsx}',
    './api/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
    './services/**/*.{js,jsx,ts,tsx}',
    './shared/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    './tests/**/*.{html,js,jsx,ts,tsx}',
    './utils/**/*.{js,jsx,ts,tsx}',
  ],
  // Audit found no utility names assembled from runtime fragments. Complete
  // class strings held in maps/props are visible to the content scanner.
  safelist: [],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        primary: {
          blue: '#3b82f6',
          green: '#22c55e',
        },
      },
    },
  },
  plugins: [],
};
