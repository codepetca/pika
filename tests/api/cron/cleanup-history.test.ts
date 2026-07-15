import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/cron/cleanup-history/route'

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }
const cleanupMocks = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
  leaseToken: vi.fn(() => '00000000-0000-4000-8000-000000000001'),
  run: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/classroom-archive-object-cleanup', () => ({
  isClassroomArchiveObjectCleanupEnabled: cleanupMocks.enabled,
  resolveClassroomArchiveObjectCleanupLeaseToken: cleanupMocks.leaseToken,
  runClassroomArchiveObjectCleanup: cleanupMocks.run,
}))

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
  deleteCalls: Array<{ table: string; column: string; values: string[] }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], rangeCalls: [], deleteCalls: [] }
}

function createSelectTable(
  table: string,
  rows: Array<Record<string, unknown>>,
  log: QueryLog,
  error: unknown = null
) {
  return {
    select: vi.fn(() => {
      const eqFilters: Array<{ column: string; values: string[] }> = []
      const notNullColumns: string[] = []
      const ltFilters: Array<{ column: string; value: string }> = []
      const filteredRows = () => rows.filter((row) => {
        for (const column of notNullColumns) {
          if (row[column] === null || row[column] === undefined) return false
        }
        for (const filter of ltFilters) {
          const value = row[filter.column]
          if (typeof value !== 'string' || value >= filter.value) return false
        }
        for (const filter of eqFilters) {
          if (!filter.values.includes(String(row[filter.column]))) return false
        }
        return true
      })
      const resolveRows = (from: number, to: number) => {
        if (error) return Promise.resolve({ data: null, error })
        return Promise.resolve({ data: filteredRows().slice(from, to + 1), error: null })
      }
      const query: any = {
        not: vi.fn((column: string) => {
          notNullColumns.push(column)
          return query
        }),
        lt: vi.fn((column: string, value: string) => {
          ltFilters.push({ column, value })
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          const stringValues = values.map(String)
          eqFilters.push({ column, values: stringValues })
          log.inCalls.push({ table, column, values: stringValues })
          return query
        }),
        order: vi.fn(() => query),
        range: vi.fn((from: number, to: number) => {
          log.rangeCalls.push({ table, from, to })
          return resolveRows(from, to)
        }),
        then: vi.fn((resolve: any, reject: any) =>
          resolveRows(0, rows.length - 1).then(resolve, reject)
        ),
      }
      return query
    }),
  }
}

function createDeleteTable(
  table: string,
  parentColumn: string,
  rows: Array<Record<string, unknown>>,
  log: QueryLog,
  error: unknown = null
) {
  return {
    delete: vi.fn(() => ({
      in: vi.fn(async (column: string, values: string[]) => {
        const stringValues = values.map(String)
        log.deleteCalls.push({ table, column, values: stringValues })
        if (error) return { count: null, error }
        const count = rows.filter((row) =>
          column === parentColumn && stringValues.includes(String(row[parentColumn]))
        ).length
        return { count, error: null }
      }),
    })),
  }
}

function createCleanupMock(opts: {
  classrooms?: Array<Record<string, unknown>>
  assignments?: Array<Record<string, unknown>>
  assignmentDocs?: Array<Record<string, unknown>>
  assignmentHistory?: Array<Record<string, unknown>>
  tests?: Array<Record<string, unknown>>
  testAttempts?: Array<Record<string, unknown>>
  testAttemptHistory?: Array<Record<string, unknown>>
  errors?: Record<string, unknown>
  log?: QueryLog
} = {}) {
  const log = opts.log ?? createQueryLog()
  const classrooms = opts.classrooms ?? [
    { id: 'classroom-1', end_date: '2026-01-01' },
  ]
  const assignments = opts.assignments ?? [
    { id: 'assignment-1', classroom_id: 'classroom-1' },
  ]
  const assignmentDocs = opts.assignmentDocs ?? [
    { id: 'doc-1', assignment_id: 'assignment-1' },
  ]
  const assignmentHistory = opts.assignmentHistory ?? [
    { id: 'history-1', assignment_doc_id: 'doc-1' },
  ]
  const tests = opts.tests ?? [
    { id: 'test-1', classroom_id: 'classroom-1' },
  ]
  const testAttempts = opts.testAttempts ?? [
    { id: 'attempt-1', test_id: 'test-1' },
  ]
  const testAttemptHistory = opts.testAttemptHistory ?? [
    { id: 'test-history-1', test_attempt_id: 'attempt-1' },
  ]
  const errors = opts.errors ?? {}

  return {
    log,
    from: vi.fn((table: string) => {
      if (table === 'classrooms') {
        return createSelectTable(table, classrooms, log, errors.classrooms)
      }
      if (table === 'assignments') {
        return createSelectTable(table, assignments, log, errors.assignments)
      }
      if (table === 'assignment_docs') {
        return createSelectTable(table, assignmentDocs, log, errors.assignment_docs)
      }
      if (table === 'assignment_doc_history') {
        return createDeleteTable(
          table,
          'assignment_doc_id',
          assignmentHistory,
          log,
          errors.assignment_doc_history
        )
      }
      if (table === 'tests') {
        return createSelectTable(table, tests, log, errors.tests)
      }
      if (table === 'test_attempts') {
        return createSelectTable(table, testAttempts, log, errors.test_attempts)
      }
      if (table === 'test_attempt_history') {
        return createDeleteTable(
          table,
          'test_attempt_id',
          testAttemptHistory,
          log,
          errors.test_attempt_history
        )
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

function cronRequest(method: 'GET' | 'POST' = 'GET') {
  return new NextRequest('http://localhost:3000/api/cron/cleanup-history', {
    method,
    headers: { authorization: 'Bearer secret' },
  })
}

describe('cron cleanup-history route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    cleanupMocks.enabled.mockReturnValue(false)
    mockSupabaseClient.rpc.mockResolvedValue({ data: 0, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 500 when CRON_SECRET is missing', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/cron/cleanup-history'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'CRON_SECRET not configured' })
  })

  it('returns 401 when the bearer token is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/cleanup-history', {
        headers: { authorization: 'Bearer wrong' },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns deleted=0 when no expired classrooms are found', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const mock = createCleanupMock({ classrooms: [], log })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await POST(cronRequest('POST'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 0 })
    expect(mock.from).toHaveBeenCalledTimes(1)
    expect(log.rangeCalls).toEqual([{ table: 'classrooms', from: 0, to: 999 }])
  })

  it('cleans expired archive staging through the authenticated daily cron when enabled', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('CLASSROOM_ARCHIVE_STAGING_CLEANUP_ENABLED', 'true')
    mockSupabaseClient.rpc.mockResolvedValue({ data: 3, error: null })
    const mock = createCleanupMock({ classrooms: [] })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      deleted: 0,
      archive_staging_cleaned: 3,
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'cleanup_expired_classroom_archive_snapshots',
    )
  })

  it('fails the cron when enabled archive staging cleanup is not authoritative', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.stubEnv('CLASSROOM_ARCHIVE_STAGING_CLEANUP_ENABLED', 'true')
    mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: { message: 'failed' } })

    const response = await GET(cronRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to clean classroom archive staging',
    })
  })

  it('expires stale operations before claiming abandoned uploads', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    cleanupMocks.enabled.mockReturnValue(true)
    cleanupMocks.run.mockResolvedValue({
      ok: true,
      status: 200,
      lease_token: '00000000-0000-4000-8000-000000000001',
      claimed: 1,
      deleted: 1,
      failed: 0,
      retry_recording_failed: 0,
      results: [],
    })
    mockSupabaseClient.rpc.mockResolvedValue({ data: 2, error: null })
    const mock = createCleanupMock({ classrooms: [] })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      deleted: 0,
      archive_staging_cleaned: 2,
      archive_object_cleanup: { claimed: 1, deleted: 1, failed: 0 },
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'cleanup_expired_classroom_archive_snapshots',
    )
    expect(cleanupMocks.run).toHaveBeenCalledWith(expect.objectContaining({
      supabase: mockSupabaseClient,
    }))
  })

  it('fails when abandoned-upload retry evidence is not durable', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    cleanupMocks.enabled.mockReturnValue(true)
    cleanupMocks.run.mockResolvedValue({
      ok: true,
      status: 200,
      lease_token: '00000000-0000-4000-8000-000000000001',
      claimed: 1,
      deleted: 0,
      failed: 1,
      retry_recording_failed: 1,
      results: [],
    })
    mockSupabaseClient.rpc.mockResolvedValue({ data: 1, error: null })

    const response = await GET(cronRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to clean classroom archive objects',
    })
  })

  it('pages and chunks expired classroom assignment and test history cleanup', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const classrooms = Array.from({ length: 1001 }, (_, index) => ({
      id: `classroom-${index + 1}`,
      end_date: '2026-01-01',
    }))
    const assignments = classrooms.map((classroom, index) => ({
      id: `assignment-${index + 1}`,
      classroom_id: classroom.id,
    }))
    const assignmentDocs = assignments.map((assignment, index) => ({
      id: `doc-${index + 1}`,
      assignment_id: assignment.id,
    }))
    const assignmentHistory = assignmentDocs.map((doc, index) => ({
      id: `history-${index + 1}`,
      assignment_doc_id: doc.id,
    }))
    const tests = classrooms.map((classroom, index) => ({
      id: `test-${index + 1}`,
      classroom_id: classroom.id,
    }))
    const testAttempts = tests.map((test, index) => ({
      id: `attempt-${index + 1}`,
      test_id: test.id,
    }))
    const testAttemptHistory = testAttempts.map((attempt, index) => ({
      id: `test-history-${index + 1}`,
      test_attempt_id: attempt.id,
    }))

    const mock = createCleanupMock({
      classrooms,
      assignments,
      assignmentDocs,
      assignmentHistory,
      tests,
      testAttempts,
      testAttemptHistory,
      log,
    })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 2002 })
    expect(log.rangeCalls.filter((call) => call.table === 'classrooms')).toEqual([
      { table: 'classrooms', from: 0, to: 999 },
      { table: 'classrooms', from: 1000, to: 1999 },
    ])
    expect(log.inCalls.filter((call) => call.table === 'assignments')).toHaveLength(21)
    expect(log.inCalls.filter((call) => call.table === 'assignment_docs')).toHaveLength(21)
    expect(log.inCalls.filter((call) => call.table === 'tests')).toHaveLength(21)
    expect(log.inCalls.filter((call) => call.table === 'test_attempts')).toHaveLength(21)
    expect(log.inCalls.find((call) => call.table === 'assignments')?.values).toHaveLength(50)
    expect(log.deleteCalls.filter((call) => call.table === 'assignment_doc_history').map((call) => call.values.length)).toEqual([
      200,
      200,
      200,
      200,
      200,
      1,
    ])
    expect(log.deleteCalls.filter((call) => call.table === 'test_attempt_history').map((call) => call.values.length)).toEqual([
      200,
      200,
      200,
      200,
      200,
      1,
    ])
  })

  it('still deletes test attempt history when expired classrooms have no assignments', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const mock = createCleanupMock({
      assignments: [],
      assignmentDocs: [],
      assignmentHistory: [],
      log,
    })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 1 })
    expect(log.inCalls.some((call) => call.table === 'assignment_docs')).toBe(false)
    expect(log.deleteCalls.filter((call) => call.table === 'test_attempt_history')).toHaveLength(1)
  })

  it('pages assignment docs and test attempts when one parent has more than one result page', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const assignmentDocs = Array.from({ length: 1001 }, (_, index) => ({
      id: `doc-${index + 1}`,
      assignment_id: 'assignment-1',
    }))
    const assignmentHistory = assignmentDocs.map((doc, index) => ({
      id: `history-${index + 1}`,
      assignment_doc_id: doc.id,
    }))
    const testAttempts = Array.from({ length: 1001 }, (_, index) => ({
      id: `attempt-${index + 1}`,
      test_id: 'test-1',
    }))
    const testAttemptHistory = testAttempts.map((attempt, index) => ({
      id: `test-history-${index + 1}`,
      test_attempt_id: attempt.id,
    }))
    const mock = createCleanupMock({
      assignmentDocs,
      assignmentHistory,
      testAttempts,
      testAttemptHistory,
      log,
    })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 2002 })
    expect(log.rangeCalls.filter((call) => call.table === 'assignment_docs')).toEqual([
      { table: 'assignment_docs', from: 0, to: 999 },
      { table: 'assignment_docs', from: 1000, to: 1999 },
    ])
    expect(log.rangeCalls.filter((call) => call.table === 'test_attempts')).toEqual([
      { table: 'test_attempts', from: 0, to: 999 },
      { table: 'test_attempts', from: 1000, to: 1999 },
    ])
  })

  it('retains classrooms ending exactly 30 Toronto days ago and cleans older classrooms only', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T16:00:00.000Z'))
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const mock = createCleanupMock({
      classrooms: [
        { id: 'old-classroom', end_date: '2026-04-30' },
        { id: 'boundary-classroom', end_date: '2026-05-01' },
        { id: 'active-classroom', end_date: null },
      ],
      assignments: [
        { id: 'old-assignment', classroom_id: 'old-classroom' },
        { id: 'boundary-assignment', classroom_id: 'boundary-classroom' },
        { id: 'active-assignment', classroom_id: 'active-classroom' },
      ],
      assignmentDocs: [
        { id: 'old-doc', assignment_id: 'old-assignment' },
        { id: 'boundary-doc', assignment_id: 'boundary-assignment' },
        { id: 'active-doc', assignment_id: 'active-assignment' },
      ],
      assignmentHistory: [
        { id: 'old-history', assignment_doc_id: 'old-doc' },
        { id: 'boundary-history', assignment_doc_id: 'boundary-doc' },
        { id: 'active-history', assignment_doc_id: 'active-doc' },
      ],
      tests: [
        { id: 'old-test', classroom_id: 'old-classroom' },
        { id: 'boundary-test', classroom_id: 'boundary-classroom' },
        { id: 'active-test', classroom_id: 'active-classroom' },
      ],
      testAttempts: [
        { id: 'old-attempt', test_id: 'old-test' },
        { id: 'boundary-attempt', test_id: 'boundary-test' },
        { id: 'active-attempt', test_id: 'active-test' },
      ],
      testAttemptHistory: [
        { id: 'old-test-history', test_attempt_id: 'old-attempt' },
        { id: 'boundary-test-history', test_attempt_id: 'boundary-attempt' },
        { id: 'active-test-history', test_attempt_id: 'active-attempt' },
      ],
      log,
    })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 2 })
    expect(log.inCalls).toContainEqual({
      table: 'assignments',
      column: 'classroom_id',
      values: ['old-classroom'],
    })
    expect(log.inCalls).toContainEqual({
      table: 'tests',
      column: 'classroom_id',
      values: ['old-classroom'],
    })
    expect(log.deleteCalls).toContainEqual({
      table: 'assignment_doc_history',
      column: 'assignment_doc_id',
      values: ['old-doc'],
    })
    expect(log.deleteCalls).toContainEqual({
      table: 'test_attempt_history',
      column: 'test_attempt_id',
      values: ['old-attempt'],
    })
  })

  it.each([
    ['classrooms', 'Failed to fetch classrooms'],
    ['assignments', 'Failed to fetch assignments'],
    ['assignment_docs', 'Failed to fetch assignment docs'],
    ['assignment_doc_history', 'Failed to delete history'],
    ['tests', 'Failed to fetch tests'],
    ['test_attempts', 'Failed to fetch test attempts'],
    ['test_attempt_history', 'Failed to delete history'],
  ])('returns 500 when %s cleanup work fails', async (table, message) => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const mock = createCleanupMock({
      errors: { [table]: { message: `${table} failed` } },
    })
    ;(mockSupabaseClient.from as any) = mock.from

    const response = await GET(cronRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: message })
  })
})
