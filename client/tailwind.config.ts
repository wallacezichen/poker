import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        felt: {
          DEFAULT: '#1a4a2e',
          light: '#235c38',
          dark: '#0f2e1c',
          darker: '#0a1f12',
        },
        gold: {
          DEFAULT: '#d4a847',
          light: '#f0c96a',
          dark: '#8b6914',
        },
        card: {
          white: '#fdf8f0',
        },
      },
      fontFamily: {
        display: ['var(--font-bebas)', 'sans-serif'],
        body: ['var(--font-noto)', 'sans-serif'],
      },
      boxShadow: {
        'table': '0 0 0 4px #8b6914, 0 0 0 8px #3d2a0a, 0 30px 80px rgba(0,0,0,0.8)',
        'card': '0 2px 8px rgba(0,0,0,0.3)',
        'gold-glow': '0 0 12px rgba(212,168,71,0.4)',
        'winner': '0 0 20px rgba(76,175,80,0.6)',
      },
      animation: {
        'winner-pulse': 'winnerPulse 1s ease-in-out infinite',
        'chip-slide': 'chipSlide 0.3s ease-out',
        'card-flip': 'cardFlip 0.4s ease-out',
        'deal': 'dealCard 0.3s ease-out',
      },
      keyframes: {
        winnerPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(76,175,80,0.6)' },
          '50%': { boxShadow: '0 0 40px rgba(76,175,80,1)' },
        },
        chipSlide: {
          from: { opacity: '0', transform: 'translateY(-20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        cardFlip: {
          from: { transform: 'rotateY(90deg)', opacity: '0' },
          to: { transform: 'rotateY(0)', opacity: '1' },
        },
        dealCard: {
          from: { transform: 'translateY(-30px) scale(0.8)', opacity: '0' },
          to: { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
