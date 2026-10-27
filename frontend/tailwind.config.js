/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#080A0E',
        sidebar: '#0B0E13',
        card: '#11151B',
        elevated: '#171C24',
        line: '#252B35',
        primary: {
          DEFAULT: '#F52F43',
          hover: '#FF4658',
        },
        ink: {
          DEFAULT: '#F5F6F8',
          secondary: '#A0A8B5',
          muted: '#737D8C',
        },
        success: {
          DEFAULT: '#27C58A',
          bg: '#103529',
        },
        warning: '#F59E0B',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '10px',
      },
      boxShadow: {
        glow: '0 0 24px rgba(245, 47, 67, 0.25)',
      },
    },
  },
  plugins: [],
};
