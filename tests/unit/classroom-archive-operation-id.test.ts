import { describe, expect, it } from 'vitest'
import { classroomArchiveOperationId } from '@/lib/classroom-archive-operation-id'

describe('classroom archive operation ids', () => {
  it('is stable across tabs for one archived lifecycle', async () => {
    const args = {
      classroomId: '00000000-0000-4000-8000-000000000010',
      archivedAt: '2026-08-20T12:00:00.000Z',
    }

    const [first, second] = await Promise.all([
      classroomArchiveOperationId(args),
      classroomArchiveOperationId(args),
    ])

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('changes after a classroom is unarchived and archived again', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000010'

    await expect(classroomArchiveOperationId({
      classroomId,
      archivedAt: '2026-08-20T12:00:00.000Z',
    })).resolves.not.toBe(await classroomArchiveOperationId({
      classroomId,
      archivedAt: '2026-08-21T12:00:00.000Z',
    }))
  })
})
