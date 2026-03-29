import type { Config } from 'tailwindcss'
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        hub: {
          green: '#1a3d2b',
          'green-mid': '#2d6a4f',
          'green-light': '#40916c',
          amber: '#d4a017',
          'amber-light': '#f4c842',
          cream: '#f8f5ee',
          dark: '#0f1f17',
        }
      },
      fontFamily: {
        display: ['Georgia', 'serif'],
        body: ['system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
export default config
