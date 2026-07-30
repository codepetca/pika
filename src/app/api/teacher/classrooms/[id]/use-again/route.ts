import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { prepareArchivedClassroomReuse } from '@/lib/server/archived-classroom-reuse'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler(
  'PostTeacherArchivedClassroomUseAgain',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const result = await prepareArchivedClassroomReuse({
      teacherId: user.id,
      classroomId: id,
      operationId: resolveBlueprintOperationId(
        request.headers.get('idempotency-key'),
      ),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  },
)
