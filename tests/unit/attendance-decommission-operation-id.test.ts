import { describe, expect, it } from 'vitest'
import { attendanceDecommissionOperationId } from '@/lib/attendance-decommission-operation-id'

describe('attendance decommission operation ids', () => {
  it('is stable for one classroom across browser sessions', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000010'

    const [first, second] = await Promise.all([
      attendanceDecommissionOperationId(classroomId),
      attendanceDecommissionOperationId(classroomId.toUpperCase()),
    ])

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('does not reuse an operation across classrooms', async () => {
    await expect(attendanceDecommissionOperationId(
      '00000000-0000-4000-8000-000000000010',
    )).resolves.not.toBe(await attendanceDecommissionOperationId(
      '00000000-0000-4000-8000-000000000011',
    ))
  })
})
