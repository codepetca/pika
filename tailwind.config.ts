import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class', // Enable class-based dark mode
  safelist: [
    'animate-notification-pulse',
    // Assignment status dot colors
    'bg-gray-400',
    'bg-yellow-400',
    'bg-lime-600',
    // Avatar colors - dynamically generated based on user name/email hash
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic background colors
        page: 'var(--color-page)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          2: 'var(--color-surface-2)',
          hover: 'var(--color-surface-hover)',
        },
        // Semantic border colors
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        // Semantic text colors
        text: {
          default: 'var(--color-text-default)',
          muted: 'var(--color-text-muted)',
          inverse: 'var(--color-text-inverse)',
        },
        // Accent colors
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          hover: 'var(--color-success-hover)',
          bg: {
            DEFAULT: 'var(--color-success-bg)',
            muted: 'var(--color-success-bg-muted)',
            hover: 'var(--color-success-bg-hover)',
          },
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          hover: 'var(--color-danger-hover)',
          bg: {
            DEFAULT: 'var(--color-danger-bg)',
            hover: 'var(--color-danger-bg-hover)',
          },
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          bg: 'var(--color-warning-bg)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          bg: {
            DEFAULT: 'var(--color-info-bg)',
            hover: 'var(--color-info-bg-hover)',
          },
        },
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        dialog: 'var(--radius-dialog)',
        badge: 'var(--radius-badge)',
      },
      spacing: {
        dialog: 'var(--space-dialog)',
        card: 'var(--space-card)',
        section: 'var(--space-section)',
        field: 'var(--space-field)',
        control: 'var(--space-control)',
      },
      boxShadow: {
        elevated: 'var(--shadow-elevated)',
        dialog: 'var(--shadow-dialog)',
      },
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
