import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { codePetPalLookupQuerySchema, isCodePetPalRuntimeConfigured, lookupCodePetPalWorld } from '@/lib/codepetpal'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetCodePetPalWorld', async (request: NextRequest) => {
  const user = await requireRole('student')
  const { searchParams } = new URL(request.url)
  const query = codePetPalLookupQuerySchema.parse({
    classroom_id: searchParams.get('classroom_id') || '',
  })

  const access = await assertStudentCanAccessClassroom(user.id, query.classroom_id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .select('codepetpal_enabled')
    .eq('id', query.classroom_id)
    .single()

  if (error || !classroom?.codepetpal_enabled || !isCodePetPalRuntimeConfigured()) {
    return NextResponse.json({ enabled: false })
  }

  const view = await lookupCodePetPalWorld({
    classroomId: query.classroom_id,
    studentId: user.id,
  })

  return NextResponse.json(view)
})
