import { NextResponse } from 'next/server'
import { authorizeClassroomReuseActor } from '@/lib/server/contextual-classroom-reuse'
import { contextualClassroomReuseParamsSchema } from '@/lib/validations/contextual-classroom-reuse'
import { withErrorHandler } from '@/lib/api-handler'
import { prepareArchivedClassroomReuse } from '@/lib/server/archived-classroom-reuse'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler(
  'PostTeacherArchivedClassroomUseAgain',
  async (request, context) => {
    const { user, contextual } = await authorizeClassroomReuseActor()
    const params = await context.params
    const { id } = contextual ? contextualClassroomReuseParamsSchema.parse(params) : params
    const result = await prepareArchivedClassroomReuse({
      teacherId: user.id,
      classroomId: id,
      operationId: resolveBlueprintOperationId(
        request.headers.get('idempotency-key'),
      ),
      ...(contextual ? { contextual: true } : {}),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  },
)
