import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeClassroomCoreRequest, classroomCoreMemberRecord } from '@/lib/server/classroom-core-access'
import { assertStudentCanAccessClassroom, classroomStudentRecord, hydrateClassroomRecord } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import { authorizeSharedClassroomDetailReadActor, readContextualClassroomDetail } from '@/lib/server/contextual-classroom-detail'
import { contextualClassroomDetailParamsSchema } from '@/lib/validations/contextual-classroom-detail'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/classrooms/[id] - Get classroom details
export const GET = withErrorHandler('GetStudentClassroom', async (request, context) => {
  const actor = await authorizeSharedClassroomDetailReadActor()
  if (actor.mode === 'shared') {
    const { id: classroomId } = contextualClassroomDetailParamsSchema.parse(await context.params)
    const classroom = await readContextualClassroomDetail({
      supabase: getServiceRoleClient(), actorId: actor.user.id, classroomId, permission: 'member',
    })
    return NextResponse.json({ classroom })
  }
  const { id: classroomId } = await context.params
  const coreAccess = await authorizeClassroomCoreRequest(classroomId, { legacyRole: 'student', permission: 'member' })
  const { user } = coreAccess
  if (coreAccess.mode === 'contextual') {
    return NextResponse.json({ classroom: hydrateClassroomRecord(classroomCoreMemberRecord(coreAccess.classroom)) })
  }

  const supabase = getServiceRoleClient()

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  // Get classroom details
  const { data: classroom, error: classError } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .single()

  if (classError || !classroom) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({ classroom: hydrateClassroomRecord(classroomStudentRecord(classroom)) })
})
