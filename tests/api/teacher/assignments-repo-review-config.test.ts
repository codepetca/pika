import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/teacher/assignments/[id]/repo-review/config/route'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment: vi.fn(async () => ({
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    evaluation_mode: 'document',
    classrooms: { archived_at: null },
  })),
  parseAndValidateRepoUrl: vi.fn(() => ({ owner: 'codepetca', name: 'pika-student-team' })),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))

const mockSupabaseClient = { from: vi.fn() }

describe('PUT /api/teacher/assignments/[id]/repo-review/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves repo config and student mappings', async () => {
    const calls: Array<{ table: string; payload: unknown }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          update: vi.fn((payload: unknown) => {
            calls.push({ table, payload })
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }

      if (table === 'assignment_repo_reviews') {
        return {
          upsert: vi.fn((payload: unknown) => {
            calls.push({ table, payload })
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { assignment_id: 'assignment-1', repo_owner: 'codepetca', repo_name: 'pika-student-team' },
                  error: null,
                }),
              })),
            }
          }),
        }
      }

      if (table === 'user_github_identities') {
        return {
          upsert: vi.fn((payload: unknown) => {
            calls.push({ table, payload })
            return Promise.resolve({ error: null })
          }),
          delete: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/repo-review/config', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'github',
        repo_url: 'codepetca/pika-student-team',
        default_branch: 'main',
        include_pr_reviews: true,
        student_mappings: [
          {
            student_id: 'student-1',
            github_login: 'alexlee',
            commit_emails: ['student1@example.com'],
          },
        ],
      }),
    })

    const response = await PUT(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(3)
  })
})
