import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertStudentCanAccessTest,
  assertTeacherOwnsTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityMap,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'

const mockSupabaseClient = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

const testRow = {
  id: 'test-1',
  title: 'Practice Test',
  status: 'active',
  classroom_id: 'classroom-1',
  show_results: false,
  documents: null,
  position: 0,
  points_possible: 10,
  include_in_final: true,
  created_by: 'teacher-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  classrooms: {
    id: 'classroom-1',
    teacher_id: 'teacher-1',
    archived_at: null,
  },
}

function mockSingleQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    eq: vi.fn(() => query),
    single: vi.fn(async () => result),
  }
  return {
    select: vi.fn(() => query),
  }
}

function mockAvailabilityClient(result: {
  data?: Array<{ student_id: string; state: unknown }> | null
  error?: unknown
  throws?: unknown
}) {
  const query: any = {
    eq: vi.fn(() => query),
    in: vi.fn(async () => {
      if (result.throws) throw result.throws
      return {
        data: result.data ?? null,
        error: result.error ?? null,
      }
    }),
  }
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => query),
    })),
  }
}

describe('getEffectiveStudentTestAccess', () => {
  it('keeps draft tests inaccessible even with a student open override', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'draft',
      accessState: 'open',
    })).toMatchObject({
      effective_access: 'closed',
      can_start_or_continue: false,
      can_view_submitted: false,
    })
  })

  it('inherits open access from active tests without an override', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: null,
    })).toMatchObject({
      access_source: 'test',
      effective_access: 'open',
      can_start_or_continue: true,
    })
  })

  it('lets a student override close access on an active test', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: 'closed',
    })).toMatchObject({
      access_source: 'student',
      effective_access: 'closed',
      can_start_or_continue: false,
    })
  })

  it('lets a student override open access on a closed test', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'closed',
      accessState: 'open',
    })).toMatchObject({
      access_source: 'student',
      effective_access: 'open',
      can_start_or_continue: true,
    })
  })

  it('keeps submitted, returned, and locked work viewable but not editable', () => {
    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: 'open',
      hasSubmitted: true,
    })).toMatchObject({
      effective_access: 'open',
      can_start_or_continue: false,
      can_view_submitted: true,
    })

    expect(getEffectiveStudentTestAccess({
      testStatus: 'closed',
      accessState: null,
      returnedAt: '2026-04-01T12:00:00.000Z',
    })).toMatchObject({
      effective_access: 'closed',
      can_start_or_continue: false,
      can_view_submitted: true,
    })

    expect(getEffectiveStudentTestAccess({
      testStatus: 'active',
      accessState: 'open',
      isLockedForGrading: true,
    })).toMatchObject({
      effective_access: 'open',
      can_start_or_continue: false,
      can_view_submitted: true,
    })
  })
})

describe('test access migration shims', () => {
  it('detects missing teacher-close attempt columns', () => {
    expect(isMissingTestAttemptClosureColumnsError(null)).toBe(false)
    expect(isMissingTestAttemptClosureColumnsError({ code: '42703', message: 'closed_for_grading_at' })).toBe(true)
    expect(isMissingTestAttemptClosureColumnsError({ code: 'PGRST204', details: 'closed_for_grading_by' })).toBe(true)
    expect(isMissingTestAttemptClosureColumnsError({ code: '42703', message: 'returned_at' })).toBe(false)
  })

  it('detects missing selected-student availability table states', () => {
    expect(isMissingTestStudentAvailabilityError(undefined)).toBe(false)
    expect(isMissingTestStudentAvailabilityError({ code: 'PGRST205', message: 'missing table' })).toBe(true)
    expect(isMissingTestStudentAvailabilityError({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingTestStudentAvailabilityError({
      code: 'PGRST204',
      message: 'test_student_availability not found in schema cache',
    })).toBe(true)
    expect(isMissingTestStudentAvailabilityError({ code: 'PGRST204', message: 'different table' })).toBe(false)
  })
})

describe('student availability helpers', () => {
  it('returns an empty map without querying when no student ids are present', async () => {
    const supabase = mockAvailabilityClient({ data: [] })

    const result = await getTestStudentAvailabilityMap(supabase, 'test-1', ['', ''])

    expect(result).toMatchObject({ missingTable: false, error: null })
    expect(result.stateByStudentId.size).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('deduplicates student ids and maps only valid availability states', async () => {
    const supabase = mockAvailabilityClient({
      data: [
        { student_id: 'student-1', state: 'open' },
        { student_id: 'student-2', state: 'closed' },
        { student_id: 'student-3', state: 'paused' },
      ],
    })

    const result = await getTestStudentAvailabilityMap(supabase, 'test-1', [
      'student-1',
      'student-1',
      'student-2',
      'student-3',
    ])

    expect(result.missingTable).toBe(false)
    expect(result.error).toBeNull()
    expect(result.stateByStudentId.get('student-1')).toBe('open')
    expect(result.stateByStudentId.get('student-2')).toBe('closed')
    expect(result.stateByStudentId.has('student-3')).toBe(false)
  })

  it('reports missing availability table errors without throwing', async () => {
    const supabase = mockAvailabilityClient({
      error: { code: 'PGRST205', message: 'missing table' },
    })

    const result = await getTestStudentAvailabilityMap(supabase, 'test-1', ['student-1'])

    expect(result.missingTable).toBe(true)
    expect(result.stateByStudentId.size).toBe(0)
    expect(result.error).toMatchObject({ code: 'PGRST205' })
  })

  it('treats route-test unexpected table throws as missing migration shims', async () => {
    const supabase = mockAvailabilityClient({
      throws: new Error('Unexpected table: test_student_availability'),
    })

    const result = await getTestStudentAvailabilityMap(supabase, 'test-1', ['student-1'])

    expect(result.missingTable).toBe(true)
    expect(result.error).toBeInstanceOf(Error)
  })

  it('returns one selected student availability state', async () => {
    const supabase = mockAvailabilityClient({
      data: [{ student_id: 'student-1', state: 'closed' }],
    })

    await expect(getTestStudentAvailabilityState(supabase, 'test-1', 'student-1')).resolves.toMatchObject({
      state: 'closed',
      missingTable: false,
      error: null,
    })
  })
})

describe('assertTeacherOwnsTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the test when the teacher owns it', async () => {
    mockSupabaseClient.from.mockReturnValueOnce(mockSingleQuery({ data: testRow, error: null }))

    await expect(assertTeacherOwnsTest('teacher-1', 'test-1')).resolves.toMatchObject({
      ok: true,
      test: expect.objectContaining({ id: 'test-1' }),
    })
  })

  it('returns not found when the test query fails', async () => {
    mockSupabaseClient.from.mockReturnValueOnce(mockSingleQuery({ data: null, error: { message: 'no rows' } }))

    await expect(assertTeacherOwnsTest('teacher-1', 'missing-test')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Test not found',
    })
  })

  it('rejects tests owned by a different teacher', async () => {
    mockSupabaseClient.from.mockReturnValueOnce(mockSingleQuery({
      data: {
        ...testRow,
        classrooms: { ...testRow.classrooms, teacher_id: 'teacher-2' },
      },
      error: null,
    }))

    await expect(assertTeacherOwnsTest('teacher-1', 'test-1')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
  })

  it('rejects archived classrooms when requested', async () => {
    mockSupabaseClient.from.mockReturnValueOnce(mockSingleQuery({
      data: {
        ...testRow,
        classrooms: { ...testRow.classrooms, archived_at: '2026-01-02T00:00:00.000Z' },
      },
      error: null,
    }))

    await expect(assertTeacherOwnsTest('teacher-1', 'test-1', { checkArchived: true })).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })
  })
})

describe('assertStudentCanAccessTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the test when the student is enrolled', async () => {
    mockSupabaseClient.from
      .mockReturnValueOnce(mockSingleQuery({ data: testRow, error: null }))
      .mockReturnValueOnce(mockSingleQuery({ data: { id: 'enrollment-1' }, error: null }))

    await expect(assertStudentCanAccessTest('student-1', 'test-1')).resolves.toMatchObject({
      ok: true,
      test: expect.objectContaining({ id: 'test-1' }),
    })
  })

  it('rejects archived classrooms', async () => {
    mockSupabaseClient.from.mockReturnValueOnce(mockSingleQuery({
      data: {
        ...testRow,
        classrooms: { ...testRow.classrooms, archived_at: '2026-01-02T00:00:00.000Z' },
      },
      error: null,
    }))

    await expect(assertStudentCanAccessTest('student-1', 'test-1')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })
  })

  it('rejects students who are not enrolled in the classroom', async () => {
    mockSupabaseClient.from
      .mockReturnValueOnce(mockSingleQuery({ data: testRow, error: null }))
      .mockReturnValueOnce(mockSingleQuery({ data: null, error: { message: 'no enrollment' } }))

    await expect(assertStudentCanAccessTest('student-1', 'test-1')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })
  })
})
