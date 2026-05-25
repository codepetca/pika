import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/assignment-docs/[id]/artifacts/[requirementId]/route'

const mocks = vi.hoisted(() => ({
  supabase: null as any,
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mocks.supabase),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })),
}))

vi.mock('@/lib/server/assignments', () => ({
  isAssignmentVisibleToStudents: vi.fn(() => true),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))

function chainSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data, error })),
      })),
    })),
  }
}

function makeArtifactTable(opts: {
  previousStoragePath?: string | null
  upsertError?: unknown
}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: opts.previousStoragePath
              ? { id: 'artifact-old', storage_path: opts.previousStoragePath }
              : null,
            error: null,
          })),
        })),
      })),
    })),
    upsert: vi.fn((row: any) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => opts.upsertError
          ? { data: null, error: opts.upsertError }
          : {
              data: {
                id: 'artifact-new',
                assignment_doc_id: row.assignment_doc_id,
                requirement_id: row.requirement_id,
                student_id: row.student_id,
                type: row.type,
                url: row.url,
                storage_path: row.storage_path,
                metadata_json: row.metadata_json,
                validation_status: row.validation_status,
                validation_message: row.validation_message,
              },
              error: null,
            }),
      })),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  }
}

function makeSupabase(opts: {
  previousStoragePath?: string | null
  upsertError?: unknown
}) {
  const upload = vi.fn(async () => ({ error: null }))
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/image.png' }, error: null }))
  const remove = vi.fn(async () => ({ error: null }))
  const artifactTable = makeArtifactTable({
    previousStoragePath: opts.previousStoragePath,
    upsertError: opts.upsertError,
  })

  return {
    upload,
    createSignedUrl,
    remove,
    from: vi.fn((table: string) => {
      if (table === 'assignments') {
        return chainSingle({ id: 'assignment-1', classroom_id: 'class-1', is_draft: false, released_at: '2026-05-01T00:00:00.000Z' })
      }
      if (table === 'assignment_submission_requirements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: 'req-image',
                    assignment_id: 'assignment-1',
                    type: 'image',
                    label: 'Screenshot',
                    instructions: '',
                    required: true,
                    position: 0,
                    validation_policy_json: {},
                    created_at: '2026-05-01T00:00:00.000Z',
                    updated_at: '2026-05-01T00:00:00.000Z',
                  },
                  error: null,
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: 'doc-1', student_id: 'student-1', is_submitted: false },
                  error: null,
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'assignment_submission_artifacts') return artifactTable
      throw new Error(`Unexpected table ${table}`)
    }),
    storage: {
      from: vi.fn(() => ({
        upload,
        createSignedUrl,
        remove,
      })),
    },
  }
}

async function postImage() {
  const formData = new FormData()
  const buffer = new ArrayBuffer(16)
  const file = new File([buffer], 'screenshot.png', { type: 'image/png' })
  ;(file as any).arrayBuffer = async () => buffer
  formData.append('file', file)
  return POST(
    { formData: async () => formData } as unknown as NextRequest,
    { params: Promise.resolve({ id: 'assignment-1', requirementId: 'req-image' }) }
  )
}

describe('POST /api/assignment-docs/[id]/artifacts/[requirementId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the previous screenshot after a successful replacement', async () => {
    mocks.supabase = makeSupabase({ previousStoragePath: 'student-1/assignment-1/old.png' })

    const response = await postImage()

    expect(response.status).toBe(200)
    expect(mocks.supabase.remove).toHaveBeenCalledWith(['student-1/assignment-1/old.png'])
  })

  it('removes the newly uploaded screenshot if the artifact row cannot be saved', async () => {
    mocks.supabase = makeSupabase({
      previousStoragePath: 'student-1/assignment-1/old.png',
      upsertError: { message: 'database write failed' },
    })

    const response = await postImage()

    expect(response.status).toBe(500)
    expect(mocks.supabase.remove).toHaveBeenCalledWith([
      expect.stringContaining('student-1/assignment-1/req-image-'),
    ])
    expect(mocks.supabase.remove).not.toHaveBeenCalledWith(['student-1/assignment-1/old.png'])
  })
})
