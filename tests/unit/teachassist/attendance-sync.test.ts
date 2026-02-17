import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFrom = vi.fn()
const mockInsertSyncJob = vi.fn()
const mockFinalizeSyncJob = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/attendance', () => ({
  computeAttendanceRecords: vi.fn(() => []),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: vi.fn(() => '2025-01-15'),
}))

vi.mock('@/lib/teachassist/crypto', () => ({
  decryptPassword: vi.fn(() => 'password'),
}))

vi.mock('@/lib/teachassist/planner', () => ({
  planOperations: vi.fn(() => []),
}))

vi.mock('@/lib/teachassist/mapper', () => ({
  mapDatasetToOperations: vi.fn(() => []),
}))

vi.mock('@/lib/teachassist/normalizer', () => ({
  normalizeDataset: vi.fn((value) => value),
}))

vi.mock('@/lib/teachassist/validator', () => ({
  validateDataset: vi.fn(() => []),
}))

vi.mock('@/lib/teachassist/student-matcher', () => ({
  matchStudents: vi.fn(() => []),
}))

vi.mock('@/lib/teachassist/state-store', () => ({
  insertSyncJob: (...args: unknown[]) => mockInsertSyncJob(...args),
  finalizeSyncJob: (...args: unknown[]) => mockFinalizeSyncJob(...args),
  insertSyncJobItems: vi.fn(),
  loadLatestPayloadHashes: vi.fn(() => new Map()),
  buildSyncSummary: vi.fn(() => ({ planned: 0, upserted: 0, skipped: 0, failed: 0 })),
}))

vi.mock('@/lib/teachassist/playwright/ta-browser', () => ({
  launchBrowser: vi.fn(),
  createPage: vi.fn(),
  closeBrowser: vi.fn(),
  resolveFrames: vi.fn(),
}))

vi.mock('@/lib/teachassist/playwright/ta-auth', () => ({
  loginToTeachAssist: vi.fn(),
}))

vi.mock('@/lib/teachassist/playwright/ta-navigation', () => ({
  selectCourse: vi.fn(),
  navigateToAttendance: vi.fn(),
}))

vi.mock('@/lib/teachassist/playwright/ta-attendance', () => ({
  readAttendancePage: vi.fn(),
  recordAttendanceForDate: vi.fn(),
}))

import { runAttendanceSync } from '@/lib/teachassist/attendance-sync'

function makeClassDaysFailureQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'db down' },
          }),
        })),
      })),
    })),
  }
}

describe('runAttendanceSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsertSyncJob.mockResolvedValue({ id: 'job-1' })
    mockFinalizeSyncJob.mockResolvedValue(undefined)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'class_days') return makeClassDaysFailureQuery()
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  it('fails the job when class_days query fails', async () => {
    const result = await runAttendanceSync({
      classroomId: 'class-1',
      mode: 'dry_run',
      createdBy: 'teacher-1',
      dateRange: { from: '2025-01-15', to: '2025-01-15' },
    })

    expect(result.ok).toBe(false)
    expect(result.jobId).toBe('job-1')
    expect(result.errors[0]?.message).toContain('Failed to load class days')
    expect(mockFinalizeSyncJob).toHaveBeenCalledWith(
      'job-1',
      'failed',
      { planned: 0, upserted: 0, skipped: 0, failed: 0 },
      expect.stringContaining('Failed to load class days')
    )
  })
})
