import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.config.ts',
        'src/types/**',
        'src/components/**', // UI components are not part of coverage targets
        'src/app/**', // Exclude Next.js app router files for now
        'src/hooks/**', // Tiptap template hooks
        'src/styles/**', // SCSS/CSS variables
        'src/contexts/**', // React contexts
        'src/lib/tiptap-utils.ts', // Tiptap template utilities
      ],
      thresholds: {
        // Global thresholds
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
        // Specific thresholds for core utilities (100% required)
        'src/lib/auth.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/lib/crypto.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/lib/timezone.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/lib/attendance.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/lib/assignments.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
