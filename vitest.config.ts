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
          lines: 82,
          functions: 100,
          branches: 80,
          statements: 82,
        },
        'src/lib/server/quizzes.ts': {
          lines: 77,
          functions: 100,
          branches: 80,
          statements: 78,
        },
        'src/lib/server/tests.ts': {
          lines: 75,
          functions: 100,
          branches: 75,
          statements: 75,
        },
        'src/lib/server/assessment-drafts.ts': {
          lines: 65,
          functions: 92,
          branches: 50,
          statements: 63,
        },
        'src/app/api/cron/cleanup-history/route.ts': {
          lines: 79,
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
          lines: 92,
          functions: 100,
          branches: 85,
          statements: 92,
        },
        'src/app/api/student/quizzes/route.ts': {
          lines: 96,
          functions: 100,
          branches: 71,
          statements: 96,
        },
        'src/app/api/student/quizzes/[id]/focus-events/route.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/app/api/student/quizzes/[id]/results/route.ts': {
          lines: 89,
          functions: 100,
          branches: 68,
          statements: 89,
        },
        'src/app/api/classrooms/[classroomId]/class-days/route.ts': {
          lines: 79,
          functions: 100,
          branches: 52,
          statements: 70,
        },
        'src/app/api/cron/nightly-log-summaries/route.ts': {
          lines: 84,
          functions: 92,
          branches: 59,
          statements: 84,
        },
        'src/app/api/teacher/gradebook/quiz-overrides/route.ts': {
          lines: 78,
          functions: 100,
          branches: 76,
          statements: 78,
        },
        'src/app/api/teacher/log-summary/route.ts': {
          lines: 87,
          functions: 100,
          branches: 70,
          statements: 86,
        },
        'src/app/api/teacher/student-history/route.ts': {
          lines: 86,
          functions: 100,
          branches: 78,
          statements: 86,
        },
        'src/app/api/teacher/quizzes/route.ts': {
          lines: 84,
          functions: 100,
          branches: 54,
          statements: 83,
        },
        'src/app/api/teacher/quizzes/[id]/draft/route.ts': {
          lines: 76,
          functions: 100,
          branches: 60,
          statements: 76,
        },
        'src/app/api/teacher/quizzes/[id]/questions/route.ts': {
          lines: 84,
          functions: 100,
          branches: 75,
          statements: 84,
        },
        'src/app/api/teacher/quizzes/[id]/questions/[qid]/route.ts': {
          lines: 68,
          functions: 100,
          branches: 57,
          statements: 68,
        },
        'src/app/api/teacher/quizzes/[id]/results/route.ts': {
          lines: 92,
          functions: 100,
          branches: 55,
          statements: 92,
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
