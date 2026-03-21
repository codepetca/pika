import { z } from 'zod'

export const repoReviewConfigSchema = z.object({
  provider: z.literal('github').default('github'),
  repo_url: z.string().min(1, 'repo_url is required'),
  default_branch: z.string().trim().min(1, 'default_branch is required').default('main'),
  review_start_at: z.string().datetime().nullable().optional(),
  review_end_at: z.string().datetime().nullable().optional(),
  include_pr_reviews: z.boolean().default(true),
  student_mappings: z.array(
    z.object({
      student_id: z.string().uuid().or(z.string().min(1)),
      github_login: z.string().trim().min(1).nullable().optional(),
      commit_emails: z.array(z.string().email()).default([]),
    })
  ).default([]),
})

export const repoReviewRunSchema = z.object({
  force: z.boolean().optional(),
})
