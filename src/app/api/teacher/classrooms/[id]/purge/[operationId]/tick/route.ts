import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { tickClassroomPurge } from '@/lib/server/classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()
const emptyRequestSchema = z.object({}).strict()

export const POST = withErrorHandler(
  'TickTeacherClassroomPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id, operationId } = await context.params
    const text = await request.text()
    if (text.trim()) {
      try {
        emptyRequestSchema.parse(JSON.parse(text))
      } catch (error) {
        if (error instanceof z.ZodError) throw error
        throw new ApiError(400, 'Request body must be valid JSON')
      }
    }
    const operation = await tickClassroomPurge(
      user.id,
      uuidSchema.parse(operationId),
    )
    if (operation.classroom_id !== uuidSchema.parse(id)) {
      return NextResponse.json({ error: 'Permanent deletion not found' }, { status: 404 })
    }
    return NextResponse.json({ operation }, {
      status: operation.status === 'completed' ? 200 : 202,
    })
  },
)
