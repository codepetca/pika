import { describe, expect, it } from 'vitest'
import { repoReviewConfigSchema, repoReviewRunSchema } from '@/lib/validations/repo-review'

describe('repo review validation schemas', () => {
  it('applies defaults for omitted repo review config fields', () => {
    const parsed = repoReviewConfigSchema.parse({ repo_url: 'https://github.com/acme/pika-demo' })

    expect(parsed).toMatchObject({
      provider: 'github',
      default_branch: 'main',
      include_pr_reviews: true,
      student_mappings: [],
    })
  })

  it('accepts nullable mapping values and mixed student id formats', () => {
    const parsed = repoReviewConfigSchema.parse({
      repo_url: 'https://github.com/acme/pika-demo',
      student_mappings: [
        {
          student_id: 'f9318894-e454-4b42-8a17-7ad31090d4f7',
          github_login: null,
          commit_emails: [],
        },
        {
          student_id: 'internal-student-id',
          github_login: 'student-login',
          commit_emails: ['student@example.com'],
        },
      ],
    })

    expect(parsed.student_mappings).toHaveLength(2)
    expect(parsed.student_mappings[1]?.commit_emails).toEqual(['student@example.com'])
  })

  it('rejects blank repo_url values', () => {
    expect(() => repoReviewConfigSchema.parse({ repo_url: '' })).toThrow('repo_url is required')
  })

  it('defaults commit_emails to an empty list when omitted', () => {
    const parsed = repoReviewConfigSchema.parse({
      repo_url: 'https://github.com/acme/pika-demo',
      student_mappings: [{ student_id: 'student-123' }],
    })

    expect(parsed.student_mappings[0]?.commit_emails).toEqual([])
  })

  it('rejects invalid commit email addresses in mappings', () => {
    expect(() =>
      repoReviewConfigSchema.parse({
        repo_url: 'https://github.com/acme/pika-demo',
        student_mappings: [
          {
            student_id: 'student-123',
            commit_emails: ['not-an-email'],
          },
        ],
      })
    ).toThrow()
  })

  it('allows optional force flag in run schema', () => {
    expect(repoReviewRunSchema.parse({})).toEqual({})
    expect(repoReviewRunSchema.parse({ force: true })).toEqual({ force: true })
  })
})
