import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            // Ensure TipTap marks render properly
            'strong': { fontWeight: '700' },
            'em': { fontStyle: 'italic' },
            'code': {
              backgroundColor: 'rgb(243 244 246)',
              padding: '0.2em 0.4em',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            'pre': {
              backgroundColor: 'rgb(31 41 55)',
              color: 'rgb(229 231 235)',
            },
            'a': {
              color: 'rgb(37 99 235)',
              textDecoration: 'underline',
              '&:hover': {
                color: 'rgb(29 78 216)',
              },
            },
          },
        },
        invert: {
          css: {
            'code': {
              backgroundColor: 'rgb(31 41 55)',
            },
            'pre': {
              backgroundColor: 'rgb(17 24 39)',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
export default config
