import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ from }),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(),
}))

function query(data: unknown, error: unknown = null) {
  const result = { data, error }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => result),
  }
  return chain
}

describe('frozen classroom authoring guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects another teacher before reading a Blueprint Version', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
      ok: false, status: 403, error: 'Forbidden',
    })
    expect(await getClassroomAuthoringGuidance('other', 'classroom')).toEqual({
      ok: false, status: 403, error: 'Forbidden',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('reads the classroom source Version and returns private rules to its teacher', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
      ok: true, classroom: { id: 'classroom' } as never,
    })
    const classroomQuery = query({ source_blueprint_id: 'blueprint', source_blueprint_version_id: 'version' })
    const versionQuery = query({
      id: 'version', course_blueprint_id: 'blueprint', version_number: 3,
      source_draft_revision: 9,
      snapshot_json: {
        authoring_guidance: {
          course_expectations_markdown: 'Course rule',
          assignment_guidance_markdown: 'Assignment rule',
          test_guidance_markdown: 'Test rule',
          unit_exceptions: [],
        },
      },
    })
    from.mockImplementation((table: string) => table === 'classrooms' ? classroomQuery : versionQuery)

    const result = await getClassroomAuthoringGuidance('teacher', 'classroom')
    expect(result).toEqual({
      ok: true,
      context: {
        source_blueprint_version_id: 'version',
        source_blueprint_version_number: 3,
        source_draft_revision: 9,
        guidance: {
          course_expectations_markdown: 'Course rule',
          assignment_guidance_markdown: 'Assignment rule',
          test_guidance_markdown: 'Test rule',
          unit_exceptions: [],
        },
      },
    })
    expect(versionQuery.eq).toHaveBeenCalledWith('course_blueprint_id', 'blueprint')
    expect(from).not.toHaveBeenCalledWith('course_blueprints')
  })

  it('provides no guidance when the classroom has no Blueprint lineage', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
      ok: true, classroom: { id: 'classroom' } as never,
    })
    from.mockReturnValue(query({ source_blueprint_id: null, source_blueprint_version_id: null }))
    expect(await getClassroomAuthoringGuidance('teacher', 'classroom')).toEqual({
      ok: true, context: null,
    })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('treats an older capture Version with no guidance field as empty guidance', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
      ok: true, classroom: { id: 'classroom' } as never,
    })
    from.mockImplementation((table: string) => table === 'classrooms'
      ? query({ source_blueprint_id: 'blueprint', source_blueprint_version_id: 'version' })
      : query({
        id: 'version', course_blueprint_id: 'blueprint', version_number: 1,
        source_draft_revision: 1, snapshot_json: { schema_version: 2 },
      }))
    const result = await getClassroomAuthoringGuidance('teacher', 'classroom')
    expect(result.ok).toBe(true)
    if (result.ok && result.context) {
      expect(result.context.guidance).toEqual({
        course_expectations_markdown: '',
        assignment_guidance_markdown: '',
        test_guidance_markdown: '',
        unit_exceptions: [],
      })
    }
  })
})
