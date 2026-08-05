import { describe, expect, it, vi } from 'vitest'
import { listHotClassroomPurgeEnabledIds } from '@/lib/server/classroom-purge-availability'

const TEACHER_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const OTHER_CLASSROOM_ID = '00000000-0000-4000-8000-000000000003'

function settingsClient(args: {
  managed?: { data: unknown; error: { code?: string } | null }
  purge?: { data: unknown; error: { code?: string } | null }
}) {
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue(
          table === 'managed_storage_settings'
            ? args.managed ?? { data: { mode: 'enforced' }, error: null }
            : args.purge ?? {
              data: {
                rollout_mode: 'disabled',
                canary_teacher_id: null,
                canary_classroom_id: null,
              },
              error: null,
            },
        ),
      })),
    })),
  }))
  return { client: { from } as any, from }
}

describe('hot classroom purge rollout visibility', () => {
  it('fails closed while deletion is disabled', async () => {
    const mock = settingsClient({})

    await expect(listHotClassroomPurgeEnabledIds({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID],
    })).resolves.toEqual([])
  })

  it('returns only the exact teacher and classroom canary', async () => {
    const mock = settingsClient({
      purge: {
        data: {
          rollout_mode: 'canary',
          canary_teacher_id: TEACHER_ID,
          canary_classroom_id: CLASSROOM_ID,
        },
        error: null,
      },
    })

    await expect(listHotClassroomPurgeEnabledIds({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID, OTHER_CLASSROOM_ID],
    })).resolves.toEqual([CLASSROOM_ID])
  })

  it('does not expose a canary assigned to another teacher or an unlisted classroom', async () => {
    const otherTeacher = settingsClient({
      purge: {
        data: {
          rollout_mode: 'canary',
          canary_teacher_id: '00000000-0000-4000-8000-000000000099',
          canary_classroom_id: CLASSROOM_ID,
        },
        error: null,
      },
    })
    const unlistedClassroom = settingsClient({
      purge: {
        data: {
          rollout_mode: 'canary',
          canary_teacher_id: TEACHER_ID,
          canary_classroom_id: OTHER_CLASSROOM_ID,
        },
        error: null,
      },
    })

    await expect(listHotClassroomPurgeEnabledIds({
      supabase: otherTeacher.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID],
    })).resolves.toEqual([])
    await expect(listHotClassroomPurgeEnabledIds({
      supabase: unlistedClassroom.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID],
    })).resolves.toEqual([])
  })

  it('returns all already-owner-scoped hot classrooms when fully enabled', async () => {
    const mock = settingsClient({
      purge: {
        data: {
          rollout_mode: 'enabled',
          canary_teacher_id: null,
          canary_classroom_id: null,
        },
        error: null,
      },
    })

    await expect(listHotClassroomPurgeEnabledIds({
      supabase: mock.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID, OTHER_CLASSROOM_ID],
    })).resolves.toEqual([CLASSROOM_ID, OTHER_CLASSROOM_ID])
  })

  it('hides deletion when migration state is unavailable or ownership is not enforced', async () => {
    const missingMigration = settingsClient({
      purge: { data: null, error: { code: 'PGRST205' } },
    })
    const unenforced = settingsClient({
      managed: { data: { mode: 'audit' }, error: null },
      purge: {
        data: {
          rollout_mode: 'enabled',
          canary_teacher_id: null,
          canary_classroom_id: null,
        },
        error: null,
      },
    })

    await expect(listHotClassroomPurgeEnabledIds({
      supabase: missingMigration.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID],
    })).resolves.toEqual([])
    await expect(listHotClassroomPurgeEnabledIds({
      supabase: unenforced.client,
      teacherId: TEACHER_ID,
      hotClassroomIds: [CLASSROOM_ID],
    })).resolves.toEqual([])
  })
})
