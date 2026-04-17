import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { createCourseBlueprintSchema } from '@/lib/validations/teacher'
import {
  createCourseBlueprint,
  listTeacherCourseBlueprints,
} from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprints', async () => {
  const user = await requireRole('teacher')
  const supabase = getServiceRoleClient()
  const { data, error } = await listTeacherCourseBlueprints(supabase, user.id)

  if (error) {
    console.error('Error listing course blueprints:', error)
    return NextResponse.json({ error: 'Failed to fetch course blueprints' }, { status: 500 })
  }

  return NextResponse.json({ blueprints: data || [] })
})

export const POST = withErrorHandler('PostTeacherCourseBlueprints', async (request) => {
  const user = await requireRole('teacher')
  const input = createCourseBlueprintSchema.parse(await request.json())
  const blueprint = await createCourseBlueprint(user.id, input)
  return NextResponse.json({ blueprint }, { status: 201 })
})
