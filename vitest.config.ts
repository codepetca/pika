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
      include: [
        'src/lib/**/*.{js,ts,tsx}',
        'src/ui/**/*.{js,ts,tsx}',
        'src/app/api/**/route.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.config.ts',
        'src/types/**',
        'src/components/**', // UI components are not part of coverage targets
        'src/hooks/**', // Tiptap template hooks
        'src/styles/**', // SCSS/CSS variables
        'src/contexts/**', // React contexts
        'src/lib/tiptap-utils.ts', // Tiptap template utilities
      ],
      thresholds: {
        // Global thresholds
        lines: 67,
        functions: 84,
        // API routes are now part of the measured set, so the global floor has
        // to reflect the broader denominator. Higher-value files below still
        // carry stricter per-file thresholds.
        branches: 57,
        statements: 67,
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
        'src/lib/server/classrooms.ts': {
          lines: 80,
          functions: 100,
          branches: 80,
          statements: 80,
        },
        'src/lib/server/quizzes.ts': {
          lines: 75,
          functions: 100,
          branches: 80,
          statements: 75,
        },
        'src/lib/server/tests.ts': {
          lines: 75,
          functions: 100,
          branches: 75,
          statements: 75,
        },
        'src/lib/server/assessment-drafts.ts': {
          lines: 65,
          functions: 90,
          branches: 50,
          statements: 63,
        },
        'src/app/api/cron/cleanup-history/route.ts': {
          lines: 78,
          functions: 100,
          branches: 60,
          statements: 80,
        },
        'src/app/api/feedback/route.ts': {
          lines: 100,
          functions: 100,
          branches: 75,
          statements: 100,
        },
        'src/app/api/snapshots/list/route.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/app/api/snapshots/[filename]/route.ts': {
          lines: 90,
          functions: 100,
          branches: 85,
          statements: 90,
        },
        'src/app/api/student/quizzes/route.ts': {
          lines: 88,
          functions: 100,
          branches: 63,
          statements: 88,
        },
        'src/app/api/student/quizzes/[id]/focus-events/route.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/app/api/student/quizzes/[id]/results/route.ts': {
          lines: 79,
          functions: 100,
          branches: 60,
          statements: 79,
        },
        'src/app/api/classrooms/[classroomId]/class-days/route.ts': {
          lines: 64,
          functions: 100,
          branches: 38,
          statements: 54,
        },
        'src/app/api/cron/nightly-log-summaries/route.ts': {
          lines: 84,
          functions: 90,
          branches: 59,
          statements: 83,
        },
        'src/app/api/teacher/gradebook/quiz-overrides/route.ts': {
          lines: 71,
          functions: 100,
          branches: 72,
          statements: 71,
        },
        'src/app/api/teacher/log-summary/route.ts': {
          lines: 83,
          functions: 100,
          branches: 67,
          statements: 82,
        },
        'src/app/api/teacher/student-history/route.ts': {
          lines: 77,
          functions: 100,
          branches: 71,
          statements: 77,
        },
        'src/app/api/teacher/quizzes/route.ts': {
          lines: 73,
          functions: 100,
          branches: 49,
          statements: 73,
        },
        'src/app/api/teacher/quizzes/[id]/draft/route.ts': {
          lines: 48,
          functions: 100,
          branches: 35,
          statements: 47,
        },
        'src/app/api/teacher/quizzes/[id]/questions/route.ts': {
          lines: 67,
          functions: 100,
          branches: 60,
          statements: 67,
        },
        'src/app/api/teacher/quizzes/[id]/questions/[qid]/route.ts': {
          lines: 55,
          functions: 100,
          branches: 44,
          statements: 55,
        },
        'src/app/api/teacher/quizzes/[id]/results/route.ts': {
          lines: 79,
          functions: 100,
          branches: 50,
          statements: 80,
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
