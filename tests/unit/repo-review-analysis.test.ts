import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/repo-review-ai', () => ({
  classifyAmbiguousRepoReviewChanges: vi.fn(async () => ({ commit1: 'bugfix' })),
}))

import { analyzeRepoReviewAssignment } from '@/lib/repo-review'

describe('analyzeRepoReviewAssignment', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.includes('/repos/codepetca/pika-demo/commits?')) {
        return new Response(JSON.stringify([
          {
            sha: 'commit1',
            commit: {
              author: {
                email: 'student1@example.com',
                date: '2026-03-10T12:00:00.000Z',
                name: 'Student One',
              },
              message: 'update auth flow',
            },
            author: { login: 'student1' },
            parents: [{ sha: 'parent-1' }],
          },
        ]), { status: 200 })
      }

      if (url.includes('/repos/codepetca/pika-demo/commits/commit1')) {
        return new Response(JSON.stringify({
          sha: 'commit1',
          commit: {
            author: {
              email: 'student1@example.com',
              date: '2026-03-10T12:00:00.000Z',
              name: 'Student One',
            },
            message: 'update auth flow',
          },
          author: { login: 'student1' },
          parents: [{ sha: 'parent-1' }],
          files: [{
            filename: 'src/app/login/page.tsx',
            status: 'modified',
            additions: 18,
            deletions: 6,
          }],
        }), { status: 200 })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('applies AI overrides for ambiguous change classification', async () => {
    const analysis = await analyzeRepoReviewAssignment({
      config: {
        assignment_id: 'assignment-1',
        provider: 'github',
        repo_owner: 'codepetca',
        repo_name: 'pika-demo',
        default_branch: 'main',
        review_start_at: null,
        review_end_at: null,
        include_pr_reviews: false,
        config_json: {},
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      identities: [{
        studentId: 'student-1',
        email: 'student1@example.com',
        name: 'Student One',
        githubLogin: 'student1',
        commitEmails: ['student1@example.com'],
      }],
      reviewWindow: {
        startAt: '2026-03-01T00:00:00.000Z',
        endAt: '2026-03-20T23:59:59.000Z',
      },
    })

    expect(analysis.students).toHaveLength(1)
    expect(analysis.students[0].semanticBreakdown.bugfix).toBeGreaterThan(0)
    expect(analysis.students[0].semanticBreakdown.feature).toBe(0)
  })
})
