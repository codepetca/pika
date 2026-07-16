import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, POST, PUT } from '@/app/api/assignment-docs/[id]/artifacts/[requirementId]/route'

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
  upsertThrowsAfterCommit?: boolean
  deleteError?: unknown
  artifactReferenceExists?: boolean
  previousLookupError?: unknown
}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn((column: string) => column === 'storage_path'
        ? {
            maybeSingle: vi.fn(async () => ({
              data: opts.artifactReferenceExists ? { id: 'artifact-new' } : null,
              error: null,
            })),
          }
        : {
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.previousStoragePath
                  ? { id: 'artifact-old', storage_path: opts.previousStoragePath }
                  : null,
                error: opts.previousLookupError ?? null,
              })),
            })),
          }),
    })),
    upsert: vi.fn((row: any) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => {
          if (opts.upsertThrowsAfterCommit) throw new Error('response lost after commit')
          return opts.upsertError ? { data: null, error: opts.upsertError } : {
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
            }
        }),
      })),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: opts.deleteError ?? null })),
      })),
    })),
  }
}

function makeSupabase(opts: {
  previousStoragePath?: string | null
  upsertError?: unknown
  upsertThrowsAfterCommit?: boolean
  deleteError?: unknown
  storageRemoveError?: unknown
  cleanupCompletionData?: boolean
  requirementType?: 'image' | 'link'
  provisionalInsertError?: unknown
  provisionalAdoptError?: unknown
  artifactReferenceExists?: boolean
  uploadError?: unknown
  previousLookupError?: unknown
}) {
  const upload = vi.fn(async () => ({ error: opts.uploadError ?? null }))
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/image.png' }, error: null }))
  const remove = vi.fn(async () => ({ error: opts.storageRemoveError ?? null }))
  const artifactTable = makeArtifactTable({
    previousStoragePath: opts.previousStoragePath,
    upsertError: opts.upsertError,
    upsertThrowsAfterCommit: opts.upsertThrowsAfterCommit,
    deleteError: opts.deleteError,
    artifactReferenceExists: opts.artifactReferenceExists,
    previousLookupError: opts.previousLookupError,
  })
  const cleanupInsert = vi.fn((row: Record<string, unknown>) => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => opts.provisionalInsertError
        ? { data: null, error: opts.provisionalInsertError }
        : {
            data: {
              id: '10000000-0000-4000-8000-000000000001',
              storage_path: row.storage_path,
            },
            error: null,
          }),
    })),
  }))
  const cleanupDelete = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => opts.provisionalAdoptError
              ? { data: null, error: opts.provisionalAdoptError }
              : { data: { id: '10000000-0000-4000-8000-000000000001' }, error: null }),
          })),
        })),
      })),
    })),
  }))
  const cleanupTable = { insert: cleanupInsert, delete: cleanupDelete }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'delete_assignment_submission_artifact_atomic') {
      return {
        data: {
          ok: true,
          deleted: Boolean(opts.previousStoragePath),
          storage_path: opts.previousStoragePath ?? null,
        },
        error: null,
      }
    }
    if (name === 'claim_assignment_artifact_storage_cleanup_path') {
      return {
        data: [{
          id: '10000000-0000-4000-8000-000000000099',
          storage_path: args.p_storage_path,
          lease_token: args.p_lease_token,
        }],
        error: null,
      }
    }
    if (name === 'complete_assignment_artifact_storage_cleanup') {
      return { data: opts.cleanupCompletionData ?? true, error: null }
    }
    if (name === 'fail_assignment_artifact_storage_cleanup') {
      return { data: true, error: null }
    }
    if (name === 'enqueue_assignment_artifact_storage_cleanup_path') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected RPC ${name}: ${JSON.stringify(args)}`)
  })

  return {
    upload,
    createSignedUrl,
    remove,
    artifactTable,
    cleanupDelete,
    cleanupInsert,
    rpc,
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
                    type: opts.requirementType ?? 'image',
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
      if (table === 'assignment_artifact_storage_cleanup') return cleanupTable
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

async function deleteArtifact() {
  return DELETE(
    {} as NextRequest,
    { params: Promise.resolve({ id: 'assignment-1', requirementId: 'req-image' }) }
  )
}

async function putArtifact(body: unknown) {
  return putRawArtifact(JSON.stringify(body))
}

async function putRawArtifact(body: string) {
  return PUT(
    new NextRequest('http://localhost/api/assignment-docs/assignment-1/artifacts/req-image', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    { params: Promise.resolve({ id: 'assignment-1', requirementId: 'req-image' }) }
  )
}

describe('PUT /api/assignment-docs/[id]/artifacts/[requirementId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-object JSON at the strict request boundary', async () => {
    mocks.supabase = makeSupabase({ requirementType: 'link' })

    const response = await putArtifact(null)

    expect(response.status).toBe(400)
    expect(mocks.supabase.from).not.toHaveBeenCalled()
  })

  it('maps a raw malformed JSON body to 400 through the shared handler', async () => {
    mocks.supabase = makeSupabase({ requirementType: 'link' })

    const response = await putRawArtifact('{"url":')
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Malformed JSON body' })
    expect(mocks.supabase.from).not.toHaveBeenCalled()
  })

  it('accepts a strict link artifact payload', async () => {
    mocks.supabase = makeSupabase({ requirementType: 'link' })

    const response = await putArtifact({ url: 'https://example.com/evidence' })

    expect(response.status).toBe(200)
  })
})

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

  it('records delayed provisional evidence before upload and adopts it after row commit', async () => {
    mocks.supabase = makeSupabase({})

    const response = await postImage()

    expect(response.status).toBe(200)
    expect(mocks.supabase.cleanupInsert).toHaveBeenCalledWith(expect.objectContaining({
      storage_path: expect.stringContaining('student-1/assignment-1/req-image-'),
      status: 'pending',
      next_attempt_at: expect.any(String),
    }))
    expect(mocks.supabase.upload.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.supabase.cleanupInsert.mock.invocationCallOrder[0]
    )
    expect(mocks.supabase.artifactTable.upsert.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.supabase.upload.mock.invocationCallOrder[0]
    )
    expect(mocks.supabase.cleanupDelete.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.supabase.artifactTable.upsert.mock.invocationCallOrder[0]
    )
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

  it('does not upload when provisional cleanup evidence cannot be created', async () => {
    mocks.supabase = makeSupabase({
      provisionalInsertError: { message: 'provisional write failed' },
    })

    const response = await postImage()

    expect(response.status).toBe(500)
    expect(mocks.supabase.upload).not.toHaveBeenCalled()
    expect(mocks.supabase.remove).not.toHaveBeenCalled()
  })

  it('does not replace an artifact when the previous-path lookup fails', async () => {
    mocks.supabase = makeSupabase({
      previousLookupError: { message: 'lookup unavailable' },
    })

    const response = await postImage()

    expect(response.status).toBe(500)
    expect(mocks.supabase.cleanupInsert).not.toHaveBeenCalled()
    expect(mocks.supabase.upload).not.toHaveBeenCalled()
    expect(mocks.supabase.artifactTable.upsert).not.toHaveBeenCalled()
  })

  it('retains provisional cleanup evidence when the upload response is an error', async () => {
    mocks.supabase = makeSupabase({
      uploadError: { message: 'upload response lost' },
    })

    const response = await postImage()

    expect(response.status).toBe(500)
    expect(mocks.supabase.upload).toHaveBeenCalled()
    expect(mocks.supabase.cleanupDelete).not.toHaveBeenCalled()
    expect(mocks.supabase.remove).not.toHaveBeenCalled()
  })

  it('returns a conflict and keeps the previous artifact when submission wins the race', async () => {
    mocks.supabase = makeSupabase({
      previousStoragePath: 'student-1/assignment-1/old.png',
      upsertError: {
        code: '23514',
        message: 'assignment_artifact_submitted_document_immutable',
      },
    })

    const response = await postImage()
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Cannot edit a submitted document')
    expect(mocks.supabase.remove).toHaveBeenCalledWith([
      expect.stringContaining('student-1/assignment-1/req-image-'),
    ])
    expect(mocks.supabase.remove).not.toHaveBeenCalledWith(['student-1/assignment-1/old.png'])
  })

  it('does not compensate a committed artifact when the upsert response is lost', async () => {
    mocks.supabase = makeSupabase({
      upsertThrowsAfterCommit: true,
      artifactReferenceExists: true,
    })

    const response = await postImage()

    expect(response.status).toBe(500)
    expect(mocks.supabase.remove).not.toHaveBeenCalled()
    expect(mocks.supabase.cleanupDelete).toHaveBeenCalled()
  })
})

describe('DELETE /api/assignment-docs/[id]/artifacts/[requirementId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the artifact row atomically before cleaning up Storage', async () => {
    mocks.supabase = makeSupabase({ previousStoragePath: 'student-1/assignment-1/old.png' })

    const response = await deleteArtifact()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ ok: true, cleanup_pending: false })
    const deleteCallOrder = mocks.supabase.rpc.mock.invocationCallOrder[0]
    expect(mocks.supabase.remove.mock.invocationCallOrder[0]).toBeGreaterThan(deleteCallOrder)
    expect(mocks.supabase.rpc).toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.objectContaining({ p_cleanup_id: '10000000-0000-4000-8000-000000000099' })
    )
  })

  it('returns accepted with durable cleanup pending when Storage deletion fails', async () => {
    mocks.supabase = makeSupabase({
      previousStoragePath: 'student-1/assignment-1/old.png',
      storageRemoveError: { message: 'storage unavailable' },
    })

    const response = await deleteArtifact()
    const data = await response.json()

    expect(response.status).toBe(202)
    expect(data).toEqual({ ok: true, cleanup_pending: true })
    expect(mocks.supabase.rpc).toHaveBeenCalledWith(
      'delete_assignment_submission_artifact_atomic',
      expect.objectContaining({ p_requirement_id: 'req-image' })
    )
    expect(mocks.supabase.rpc).not.toHaveBeenCalledWith(
      'complete_assignment_artifact_storage_cleanup',
      expect.anything()
    )
  })

  it('returns accepted while durable cleanup completion evidence is still pending', async () => {
    mocks.supabase = makeSupabase({
      previousStoragePath: 'student-1/assignment-1/old.png',
      cleanupCompletionData: false,
    })

    const response = await deleteArtifact()
    const data = await response.json()

    expect(response.status).toBe(202)
    expect(data).toEqual({ ok: true, cleanup_pending: true })
  })
})
